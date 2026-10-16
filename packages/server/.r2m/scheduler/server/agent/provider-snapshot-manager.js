import { normalizeAgentModelCatalog } from "@getpaseo/protocol/agent-types";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import pLimit from "p-limit";
import { expandTilde } from "../../utils/path.js";
import { withTimeout } from "../../utils/promise-timeout.js";
import { filterSelectableAgentModels, } from "./agent-sdk-types.js";
import { raceProviderRefreshAbort, runProviderRefreshWithDeadline, } from "./provider-refresh-deadline.js";
import { buildProviderRegistry, shutdownAgentClients, } from "./provider-registry.js";
import { BUILTIN_PROVIDER_IDS } from "@getpaseo/protocol/provider-manifest";
import { applyMutableProviderConfigToOverrides } from "../daemon-config-store.js";
import { formatProviderDiagnostic, formatProviderDiagnosticError, } from "./providers/diagnostic-utils.js";
import { validateAgentConfigurationAgainstProvider, } from "./agent-configuration-validator.js";
import { PluginAgentClientRegistry } from "./plugin-provider.js";
const DEFAULT_REFRESH_TIMEOUT_MS = 120000;
const MAX_REFRESH_TIMEOUT_MS = 2147483647;
const DEFAULT_DIAGNOSTIC_TIMEOUT_MS = 120000;
const PROVIDER_REFRESH_DEADLINE_ENV = "PASEO_PROVIDER_REFRESH_TIMEOUT_MS";
export const GLOBAL_PROVIDER_SNAPSHOT_KEY = "paseo:global";
function validRefreshDeadline(value) {
    return typeof value === "number" &&
        Number.isSafeInteger(value) &&
        value > 0 &&
        value <= MAX_REFRESH_TIMEOUT_MS
        ? value
        : undefined;
}
function providerRefreshDeadline(configured) {
    const explicit = validRefreshDeadline(configured);
    if (explicit !== undefined)
        return explicit;
    return (validRefreshDeadline(Number(process.env[PROVIDER_REFRESH_DEADLINE_ENV])) ??
        DEFAULT_REFRESH_TIMEOUT_MS);
}
function resolveDiagnosticTimeoutMs(option, refreshTimeoutMs) {
    if (typeof option === "number" && Number.isFinite(option) && option > 0) {
        return option;
    }
    return Math.max(refreshTimeoutMs, DEFAULT_DIAGNOSTIC_TIMEOUT_MS);
}
function omitProviderOverrides(overrides, providers) {
    if (!overrides || providers.length === 0)
        return overrides;
    const nextOverrides = { ...overrides };
    for (const provider of providers)
        delete nextOverrides[provider];
    return Object.keys(nextOverrides).length > 0 ? nextOverrides : undefined;
}
export class ProviderSnapshotManager {
    constructor(options) {
        this.catalogs = new Map();
        this.targets = new Map();
        this.events = new EventEmitter();
        this.destroyed = false;
        this.ownedClients = new Set();
        this.pluginProvidersSettled = false;
        this.logger = options.logger;
        this.pluginProviders = new PluginAgentClientRegistry(options.logger.child({ module: "plugin-providers" }));
        this.workspaceGitService = options.workspaceGitService;
        this.managedProcesses = options.managedProcesses;
        this.openCodeBridge = options.openCodeBridge;
        this.isDev = options.isDev === true;
        this.extraClients = options.extraClients ?? {};
        this.runtimeSettings = options.runtimeSettings;
        this.providerOverrides = options.providerOverrides;
        this.baseProviderOverrides = options.providerOverrides;
        this.refreshTimeoutMs = providerRefreshDeadline(options.refreshTimeoutMs);
        this.diagnosticTimeoutMs = resolveDiagnosticTimeoutMs(options.diagnosticTimeoutMs, this.refreshTimeoutMs);
        this.generation = this.createGeneration(this.buildRegistry(this.runtimeSettings, this.providerOverrides), this.providerOverrides);
        this.providerClients = {
            ...this.extraClients,
        };
        for (const client of Object.values(this.providerClients))
            this.ownedClients.add(client);
    }
    getSnapshot(cwd) {
        const target = resolveProviderSnapshotTarget(cwd);
        return this.getSnapshotForTarget(target);
    }
    async refreshSnapshotForCwd(options) {
        const snapshotCwd = resolveSnapshotCwd(options.cwd);
        const target = createWorkspaceSnapshotTarget(snapshotCwd);
        const providers = this.resolveRefreshProviders(options.providers);
        const providersToRefresh = providers ?? this.getProviderIds();
        await this.refreshProviders(target, providersToRefresh);
    }
    async refreshSettingsSnapshot(options = {}) {
        const target = createGlobalSnapshotTarget();
        const homeCwd = target.snapshotCwd;
        const providers = this.resolveRefreshProviders(options.providers);
        const providersToRefresh = providers ?? this.getProviderIds();
        this.getOrCreateTarget(homeCwd);
        for (const catalogs of this.catalogs.values()) {
            for (const provider of providersToRefresh) {
                const catalog = catalogs.get(provider);
                if (catalog)
                    catalogs.set(provider, { result: catalog.result, stale: true });
            }
        }
        // Refresh each known target: provider keys coalesce reads, while target-scoped
        // providers must discover again in their own execution context.
        await this.refreshProviders(target, providersToRefresh);
        await Promise.all([...this.targets.keys()]
            .filter((cwd) => cwd !== homeCwd)
            .map((cwd) => this.warmUp(createWorkspaceSnapshotTarget(cwd), providersToRefresh)));
    }
    async warmUpSnapshotForCwd(options) {
        const target = resolveProviderSnapshotTarget(options.cwd);
        const snapshotCwd = target.snapshotCwd;
        const providers = this.resolveRefreshProviders(options.providers);
        if (options.providers && providers?.length === 0) {
            return;
        }
        const providersToWarm = this.resolveProvidersToWarm(snapshotCwd, providers);
        if (providersToWarm.length === 0) {
            return;
        }
        await this.warmUp(target, providersToWarm);
    }
    async refresh(options) {
        await this.refreshSnapshotForCwd(options);
    }
    listRegisteredProviderIds() {
        return this.getProviderIds();
    }
    hasProvider(provider) {
        return Object.prototype.hasOwnProperty.call(this.generation.definitions, provider);
    }
    getProviderLabel(provider) {
        return this.generation.definitions[provider]?.label ?? provider;
    }
    getAgentManagerProviderState() {
        return this.createAgentManagerState(this.generation.definitions, this.providerClients);
    }
    createAgentManagerState(definitions, providerClients) {
        const providerDefinitions = {};
        const clients = {};
        for (const [provider, definition] of Object.entries(definitions)) {
            providerDefinitions[provider] = {
                enabled: definition.enabled,
                derivedFromProviderId: definition.derivedFromProviderId,
                applyToolPolicy: definition.applyToolPolicy,
            };
            if (definition.enabled) {
                clients[provider] = this.ensureClient(provider, definition, providerClients);
            }
        }
        for (const [provider, client] of Object.entries(this.extraClients)) {
            if (client) {
                clients[provider] = client;
            }
        }
        return { providerDefinitions, clients };
    }
    /** Called after built-in and configured plugin startup has completed, including disabled plugins. */
    settlePluginProviders() {
        if (this.pluginProvidersSettled)
            return;
        this.pluginProvidersSettled = true;
        this.warnUnknownProviderOverrides();
    }
    warnUnknownProviderOverrides() {
        if (!this.pluginProvidersSettled)
            return;
        for (const [provider, override] of Object.entries(this.providerOverrides ?? {})) {
            if (!override.extends && !this.generation.definitions[provider]) {
                this.logger.warn({ provider }, "Provider override matches no registered provider");
            }
        }
    }
    replacePluginProviders(registrations) {
        for (const registration of registrations) {
            if (BUILTIN_PROVIDER_IDS.includes(registration.id) || this.extraClients[registration.id]) {
                throw new Error(`Plugin provider '${registration.id}' conflicts with a built-in provider`);
            }
        }
        const previousPlugins = this.pluginProviders.definitions();
        const clients = { ...this.providerClients };
        // Materialize fallible installed clients before retiring any plugin runtime.
        this.createAgentManagerState(this.generation.definitions, clients);
        this.pluginProviders.replace(registrations);
        const plugins = this.pluginProviders.definitions();
        const retiredProviders = Object.keys(previousPlugins).filter((provider) => previousPlugins[provider] !== plugins[provider] &&
            !this.providerOverrides?.[provider]?.extends);
        const definitions = this.buildRegistry(this.runtimeSettings, this.providerOverrides);
        const changed = new Set();
        for (const provider of new Set([...this.generation.order, ...Object.keys(definitions)])) {
            const before = this.generation.definitions[provider];
            const after = definitions[provider];
            const registrationChanged = previousPlugins[provider] !== plugins[provider] &&
                !this.providerOverrides?.[provider]?.extends;
            if (registrationChanged ||
                !before ||
                !after ||
                !isDeepStrictEqual(before.configuration, after.configuration)) {
                changed.add(provider);
                delete clients[provider];
            }
            else {
                definitions[provider] = before;
            }
        }
        for (const client of Object.values(clients))
            this.ownedClients.add(client);
        const generation = this.createGeneration(definitions, this.providerOverrides);
        const state = this.createAgentManagerState(definitions, clients);
        this.installGeneration(generation, clients, changed);
        return { ...state, retiredProviders };
    }
    ensureClient(provider, definition, clients = this.providerClients) {
        const existing = clients[provider];
        if (existing) {
            return existing;
        }
        const client = definition.createClient(this.logger);
        clients[provider] = client;
        this.ownedClients.add(client);
        return client;
    }
    async listProviders(input = {}) {
        const target = resolveProviderSnapshotTarget(input.cwd);
        if (input.wait) {
            await this.warmUpSnapshotForCwd({ cwd: input.cwd, providers: input.providers });
        }
        const providerFilter = input.providers ? new Set(input.providers) : null;
        const snapshot = input.wait
            ? this.getOrCreateTarget(target.snapshotCwd).snapshot
            : this.getSnapshotForTarget(target, input.providers);
        const entries = snapshot.records.map(({ entry }) => entry);
        return providerFilter ? entries.filter((entry) => providerFilter.has(entry.provider)) : entries;
    }
    async getProvider(input) {
        const entry = (await this.listProviders({ ...input, providers: [input.provider] })).find((candidate) => candidate.provider === input.provider);
        if (!entry) {
            throw new Error(`Provider ${input.provider} is not configured`);
        }
        return entry;
    }
    async validateAgentConfiguration(input) {
        if (!this.hasProvider(input.provider)) {
            return [
                {
                    path: ["provider"],
                    message: `Provider '${input.provider}' is not configured`,
                },
            ];
        }
        const provider = await this.getProvider({
            provider: input.provider,
            wait: true,
        });
        if (!provider.enabled) {
            return [{ path: ["provider"], message: `Provider '${input.provider}' is disabled` }];
        }
        if (provider.status !== "ready") {
            return [
                {
                    path: ["provider"],
                    message: provider.status === "error" && provider.error
                        ? provider.error
                        : `Provider '${input.provider}' is not available`,
                },
            ];
        }
        return validateAgentConfigurationAgainstProvider({
            input,
            provider,
        });
    }
    async listModels(input) {
        const entry = await this.getReadyProvider(input);
        return filterSelectableAgentModels(entry.models);
    }
    async listModes(input) {
        const entry = await this.getReadyProvider(input);
        return entry.modes ?? [];
    }
    async resolveDefaultModel(input) {
        try {
            const trimmed = input.requestedModel?.trim();
            if (trimmed) {
                return trimmed;
            }
            const models = await this.listModels({
                provider: input.provider,
                cwd: input.cwd ? expandTilde(input.cwd) : undefined,
                wait: true,
            });
            const preferred = models.find((model) => model.isDefault) ?? models[0];
            return preferred?.id;
        }
        catch (error) {
            this.logger.warn({ err: error, provider: input.provider }, "Failed to resolve default model");
            return undefined;
        }
    }
    async resolveCreateConfig(input) {
        const entry = await this.getReadyProvider({
            cwd: input.cwd,
            provider: input.provider,
            wait: true,
        });
        const definition = this.requireProvider(input.provider);
        const parent = input.parent ? this.resolveParent(input.parent) : null;
        return definition.resolveCreateConfig({
            provider: input.provider,
            requestedMode: input.requestedMode,
            featureValues: input.featureValues,
            parent,
            unattended: input.unattended || parent?.isUnattended === true,
            availableModes: entry.modes ?? [],
        });
    }
    async getProviderDiagnostic(provider) {
        const definition = this.generation.definitions[provider];
        if (!definition) {
            return {
                provider,
                diagnostic: formatProviderDiagnostic(provider, [
                    { label: "Error", value: `Provider ${provider} is not configured` },
                ]),
            };
        }
        const baseDiagnosticPromise = this.getBaseProviderDiagnostic(provider, definition);
        const snapshotEntryPromise = this.refreshDiagnosticSnapshotEntry(provider);
        const [baseDiagnostic, entry] = await Promise.all([
            baseDiagnosticPromise,
            snapshotEntryPromise,
        ]);
        const modelCount = entry.status === "ready" ? String(entry.models?.length ?? 0) : "—";
        const status = formatProviderStatus(entry);
        const diagnostic = `${baseDiagnostic}\n  Models: ${modelCount}\n  Status: ${status}`;
        return { provider, diagnostic };
    }
    applyMutableProviderConfig(mutableProviders, options = {}) {
        const prepared = this.prepareMutableProviderConfig(mutableProviders, options);
        prepared.commit();
        return prepared.agentManagerState;
    }
    prepareMutableProviderConfig(mutableProviders, options = {}) {
        const baseProviderOverrides = options.replace
            ? undefined
            : omitProviderOverrides(this.baseProviderOverrides, options.removeProviders ?? []);
        const runtimeSettings = options.replace ? undefined : this.runtimeSettings;
        const providerOverrides = applyMutableProviderConfigToOverrides(baseProviderOverrides, mutableProviders);
        const definitions = this.buildRegistry(runtimeSettings, providerOverrides);
        const changed = new Set();
        const clients = { ...this.providerClients };
        for (const provider of new Set([...this.generation.order, ...Object.keys(definitions)])) {
            const before = this.generation.definitions[provider];
            const after = definitions[provider];
            if (!before || !after || !isDeepStrictEqual(before.configuration, after.configuration)) {
                changed.add(provider);
                delete clients[provider];
            }
            else {
                definitions[provider] = before;
            }
        }
        Object.assign(clients, this.extraClients);
        const generation = this.createGeneration(definitions, providerOverrides);
        const agentManagerState = this.createAgentManagerState(definitions, clients);
        return {
            agentManagerState,
            commit: () => {
                this.baseProviderOverrides = baseProviderOverrides;
                this.runtimeSettings = runtimeSettings;
                this.providerOverrides = providerOverrides;
                this.installGeneration(generation, clients, changed);
            },
        };
    }
    installGeneration(generation, clients, changed) {
        for (const provider of changed) {
            this.generation.providerStates.get(provider)?.discoveryLimit.clearQueue();
        }
        this.generation = generation;
        this.providerClients = clients;
        this.warnUnknownProviderOverrides();
        for (const [key, catalogs] of this.catalogs) {
            for (const provider of changed)
                catalogs.delete(provider);
            if (catalogs.size === 0)
                this.catalogs.delete(key);
        }
        for (const target of this.targets.values()) {
            for (const provider of changed)
                target.bindings.delete(provider);
        }
        this.publishTargets(this.targets.keys());
        const providers = [...changed].filter((provider) => generation.definitions[provider]);
        if (providers.length === 0)
            return;
        for (const cwd of this.targets.keys()) {
            void this.warmUp(resolveProviderSnapshotTarget(cwd === GLOBAL_PROVIDER_SNAPSHOT_KEY ? undefined : cwd), providers);
        }
    }
    setRefreshTimeoutMs(refreshTimeoutMs) {
        this.refreshTimeoutMs = providerRefreshDeadline(refreshTimeoutMs);
        this.diagnosticTimeoutMs = resolveDiagnosticTimeoutMs(undefined, this.refreshTimeoutMs);
    }
    on(event, listener) {
        this.events.on(event, listener);
        return this;
    }
    off(event, listener) {
        this.events.off(event, listener);
        return this;
    }
    async shutdown() {
        this.destroyed = true;
        for (const state of this.generation.providerStates.values())
            state.discoveryLimit.clearQueue();
        // Materialize a client per enabled provider so provider-owned resources
        // (background processes, sockets, etc.) get a chance to release even when
        // a given provider hasn't been touched yet during this daemon's lifetime.
        this.getAgentManagerProviderState();
        await shutdownAgentClients(this.ownedClients, this.logger);
    }
    destroy() {
        this.destroyed = true;
        for (const state of this.generation.providerStates.values())
            state.discoveryLimit.clearQueue();
        this.catalogs.clear();
        this.targets.clear();
        this.events.removeAllListeners();
    }
    buildRegistry(runtimeSettings, providerOverrides) {
        const registry = buildProviderRegistry(this.logger, {
            runtimeSettings,
            providerOverrides,
            pluginProviders: this.pluginProviders.definitions(),
            workspaceGitService: this.workspaceGitService,
            managedProcesses: this.managedProcesses,
            openCodeBridge: this.openCodeBridge,
            isDev: this.isDev,
        });
        for (const [provider, client] of Object.entries(this.extraClients)) {
            const definition = registry[provider];
            if (!definition)
                continue;
            registry[provider] = {
                ...definition,
                createClient: () => client,
                resolveCreateConfig: client.resolveCreateConfig?.bind(client) ?? definition.resolveCreateConfig,
                isCreateConfigUnattended: client.isCreateConfigUnattended?.bind(client) ?? definition.isCreateConfigUnattended,
                fetchCatalog: (options, _client, context) => client.fetchCatalog(options, context),
            };
        }
        return registry;
    }
    resolveParent(parent) {
        const definition = this.requireProvider(parent.provider);
        return {
            provider: parent.provider,
            modeId: parent.currentModeId,
            isUnattended: definition.isCreateConfigUnattended({
                modeId: parent.currentModeId,
                config: parent.config,
                features: parent.features,
                availableModes: parent.availableModes ?? definition.modes ?? [],
            }),
        };
    }
    getSnapshotForTarget(target, providers) {
        const providersToWarm = this.resolveProvidersToWarm(target.snapshotCwd, providers);
        if (providersToWarm.length > 0) {
            void this.warmUp(target, providersToWarm);
        }
        return this.getOrCreateTarget(target.snapshotCwd).snapshot;
    }
    async getReadyProvider(input) {
        const entry = await this.getProvider(input);
        if (!entry.enabled) {
            throw new Error(`Provider '${entry.provider}' is disabled`);
        }
        if (entry.status === "ready") {
            return entry;
        }
        if (entry.status === "error") {
            throw new Error(entry.error ?? `Failed to load provider '${entry.provider}'`);
        }
        throw new Error(`Provider '${entry.provider}' is not available`);
    }
    requireProvider(provider) {
        const definition = this.generation.definitions[provider];
        if (!definition) {
            throw new Error(`Provider ${provider} is not configured`);
        }
        return definition;
    }
    async refreshDiagnosticSnapshotEntry(provider) {
        try {
            const target = createGlobalSnapshotTarget();
            await this.refreshProviders(target, [provider]);
            return await this.getProvider({ provider, wait: false });
        }
        catch (error) {
            return {
                ...this.generation.providerStates.get(provider).initial.entry,
                status: "error",
                error: toErrorMessage(error),
            };
        }
    }
    async getBaseProviderDiagnostic(provider, definition) {
        try {
            const client = this.ensureClient(provider, definition);
            if (client.getDiagnostic) {
                return (await withTimeout(client.getDiagnostic(), this.diagnosticTimeoutMs, `Timed out collecting ${definition.label ?? provider} diagnostic after ${this.diagnosticTimeoutMs}ms`)).diagnostic;
            }
            return formatProviderDiagnostic(definition.label ?? provider, [
                { label: "Diagnostic", value: "No diagnostic available" },
            ]);
        }
        catch (error) {
            return formatProviderDiagnosticError(definition.label ?? provider, error);
        }
    }
    createGeneration(definitions, overrides) {
        const order = Object.keys(definitions);
        const providerStates = new Map();
        for (const provider of order) {
            const definition = definitions[provider];
            const previous = this.generation?.providerStates.get(provider);
            if (this.generation?.definitions[provider] === definition) {
                providerStates.set(provider, previous);
                continue;
            }
            const custom = this.pluginProviders.has(provider) ||
                (!BUILTIN_PROVIDER_IDS.includes(provider) && !!overrides?.[provider]?.extends);
            providerStates.set(provider, {
                discoveryLimit: previous?.discoveryLimit ?? pLimit({ concurrency: 4, rejectOnClear: true }),
                initial: identifyEntry({
                    provider,
                    status: definition.enabled ? "loading" : "unavailable",
                    enabled: definition.enabled,
                    source: custom ? "custom" : "builtin",
                    label: definition.label,
                    description: definition.description,
                    iconSvg: definition.iconSvg,
                    defaultModeId: definition.defaultModeId ?? null,
                }),
            });
        }
        return { definitions, order, providerStates };
    }
    async warmUp(target, providers) {
        const providersToRefresh = providers ?? this.getProviderIds();
        await this.loadProviders({
            snapshotCwd: target.snapshotCwd,
            catalogScope: target.catalogScope,
            providers: providersToRefresh,
            force: false,
        });
    }
    async refreshProviders(target, providers) {
        await this.loadProviders({
            snapshotCwd: target.snapshotCwd,
            catalogScope: target.catalogScope,
            providers,
            force: true,
        });
    }
    resolveProvidersToWarm(cwd, providers) {
        this.getOrCreateTarget(cwd);
        // Identity is provider-owned and may change without a daemon config reload.
        return providers ?? this.getProviderIds();
    }
    async loadProviders(options) {
        await Promise.allSettled(options.providers.map((provider) => this.loadProvider({ ...options, provider })));
    }
    loadProvider(options) {
        if (this.destroyed || !this.generation.definitions[options.provider])
            return Promise.resolve();
        const { bindings } = this.getOrCreateTarget(options.snapshotCwd);
        const binding = {
            key: bindings.get(options.provider)?.key,
            failure: bindings.get(options.provider)?.failure,
            force: options.force || bindings.get(options.provider)?.force === true,
            promise: Promise.resolve(),
        };
        bindings.set(options.provider, binding);
        binding.promise = this.resolveCatalog({ ...options, force: binding.force }, binding);
        return binding.promise;
    }
    async resolveCatalog(options, binding) {
        const { provider, snapshotCwd, force } = options;
        const definition = this.generation.definitions[provider];
        const initial = this.generation.providerStates.get(provider).initial.entry;
        this.getOrCreateTarget(snapshotCwd);
        if (!definition.enabled)
            return;
        const currentBinding = () => this.targets.get(snapshotCwd)?.bindings.get(provider);
        const client = this.ensureClient(provider, definition);
        const catalogOptions = createFetchCatalogOptions(options.catalogScope, force);
        let key;
        try {
            const sharedKey = client.getCatalogCacheKey
                ? await withTimeout(client.getCatalogCacheKey(catalogOptions), this.refreshTimeoutMs, `Timed out resolving ${provider} catalogue key`)
                : await Promise.resolve(undefined);
            key = JSON.stringify(sharedKey === undefined ? ["target", snapshotCwd] : ["provider", sharedKey]);
        }
        catch (error) {
            if (currentBinding() !== binding)
                return currentBinding()?.promise;
            binding.force = false;
            binding.key = undefined;
            binding.failure = identifyEntry({
                ...this.generation.providerStates.get(provider).initial.entry,
                status: "error",
                error: toErrorMessage(error),
            });
            this.publishTargets([snapshotCwd]);
            return;
        }
        // Only the latest key resolution for this target may bind it to a catalogue.
        if (currentBinding() !== binding)
            return currentBinding()?.promise;
        binding.force = false;
        binding.key = key;
        binding.failure = undefined;
        let catalogs = this.catalogs.get(key);
        if (!catalogs) {
            catalogs = new Map();
            this.catalogs.set(key, catalogs);
        }
        let catalog = catalogs.get(provider);
        if (!catalog) {
            catalog = {};
            catalogs.set(provider, catalog);
        }
        this.publishTargets([snapshotCwd]);
        if (!force && (catalog.load || (catalog.result && !catalog.stale)))
            return catalog.load;
        catalog.stale = false;
        const current = catalog;
        const isCurrent = () => !this.destroyed && this.catalogs.get(key)?.get(provider) === current && current.load === load;
        const load = this.generation.providerStates
            .get(provider)
            .discoveryLimit(() => {
            if (!isCurrent())
                return;
            return this.refreshProvider({
                catalogOptions,
                provider,
                definition,
                initial,
                client,
                publish: (entry) => {
                    if (!isCurrent())
                        return false;
                    current.result = identifyEntry(structuredClone(entry));
                    const boundTargets = [...this.targets].flatMap(([cwd, target]) => target.bindings.get(provider)?.key === key ? [cwd] : []);
                    this.publishTargets(boundTargets);
                    return true;
                },
            });
        })
            .finally(() => {
            if (current.load === load)
                current.load = undefined;
        });
        current.load = load;
        return load;
    }
    async refreshProvider(options) {
        const { catalogOptions, provider, definition, initial: base, client, publish: setEntry, } = options;
        try {
            const catalog = await runProviderRefreshWithDeadline({
                label: definition.label,
                timeoutMs: this.refreshTimeoutMs,
                operation: async (context) => {
                    const available = await context.runActivity("availability", () => raceProviderRefreshAbort(context.signal, client.isAvailable(context.signal, catalogOptions)));
                    if (!available) {
                        return null;
                    }
                    return await definition.fetchCatalog(catalogOptions, client, context);
                },
            });
            if (!catalog) {
                setEntry({ ...base, status: "unavailable", enabled: true });
                return;
            }
            const models = normalizeAgentModelCatalog(catalog.models);
            if (models.length !== catalog.models.length) {
                this.logger.warn({ provider, discardedRows: catalog.models.length - models.length }, "Provider catalog contains repeated model IDs; retaining the first definition");
            }
            setEntry({
                ...base,
                defaultModeId: catalog.defaultModeId === undefined ? base.defaultModeId : catalog.defaultModeId,
                status: "ready",
                enabled: true,
                models,
                modes: catalog.modes,
                fetchedAt: new Date().toISOString(),
            });
        }
        catch (error) {
            const emitted = setEntry({
                ...base,
                status: "error",
                enabled: true,
                error: toErrorMessage(error),
            });
            if (emitted) {
                this.logger.warn({ err: error, provider, target: catalogOptions }, "Failed to refresh provider snapshot");
            }
        }
    }
    publishTargets(cwds) {
        if (this.destroyed)
            return;
        const transitions = [];
        for (const cwd of cwds) {
            const target = this.targets.get(cwd);
            const records = this.generation.order.map((provider) => {
                const binding = target.bindings.get(provider);
                const result = binding?.key
                    ? this.catalogs.get(binding.key)?.get(provider)?.result
                    : undefined;
                return binding?.failure ?? result ?? this.generation.providerStates.get(provider).initial;
            });
            const previous = target.snapshot;
            if (sameSnapshotRecords(previous.records, records))
                continue;
            const current = { cwd, records };
            target.snapshot = current;
            transitions.push({ previous, current });
        }
        for (const transition of transitions) {
            for (const listener of this.events.listeners("change")) {
                try {
                    listener(transition);
                }
                catch (error) {
                    this.logger.error({ err: error, cwd: transition.current.cwd }, "Provider snapshot subscriber failed");
                }
            }
        }
    }
    getOrCreateTarget(cwd) {
        let target = this.targets.get(cwd);
        if (!target) {
            target = {
                bindings: new Map(),
                snapshot: {
                    cwd,
                    records: this.generation.order.map((provider) => this.generation.providerStates.get(provider).initial),
                },
            };
            this.targets.set(cwd, target);
        }
        return target;
    }
    getProviderIds() {
        return [...this.generation.order];
    }
    resolveRefreshProviders(providers) {
        if (!providers || providers.length === 0) {
            return undefined;
        }
        const providerIds = new Set(this.getProviderIds());
        return Array.from(new Set(providers)).filter((provider) => providerIds.has(provider));
    }
}
export function resolveSnapshotCwd(cwd) {
    const trimmed = cwd?.trim();
    if (!trimmed) {
        return homedir();
    }
    let expanded = trimmed === "~" || trimmed.startsWith("~/") ? `${homedir()}${trimmed.slice(1)}` : trimmed;
    if (process.platform === "win32" && /^[A-Za-z]:$/.test(expanded)) {
        expanded = `${expanded}\\`;
    }
    let resolved = resolve(expanded);
    if (process.platform === "win32" && /^[A-Za-z]:$/.test(resolved)) {
        resolved = `${resolved}\\`;
    }
    return resolved;
}
function resolveProviderSnapshotTarget(cwd) {
    const trimmed = cwd?.trim();
    if (!trimmed) {
        return createGlobalSnapshotTarget();
    }
    return createWorkspaceSnapshotTarget(resolveSnapshotCwd(trimmed));
}
function createGlobalSnapshotTarget() {
    return {
        snapshotCwd: GLOBAL_PROVIDER_SNAPSHOT_KEY,
        catalogScope: { scope: "global" },
    };
}
function createWorkspaceSnapshotTarget(cwd) {
    const snapshotCwd = resolveSnapshotCwd(cwd);
    return {
        snapshotCwd,
        catalogScope: { scope: "workspace", cwd: snapshotCwd },
    };
}
function createFetchCatalogOptions(scope, force) {
    return scope.scope === "global"
        ? { scope: "global", force }
        : { scope: "workspace", cwd: scope.cwd, force };
}
export function isGlobalProviderSnapshotKey(cwd) {
    return cwd === GLOBAL_PROVIDER_SNAPSHOT_KEY;
}
function identifyEntry(entry) {
    const { fetchedAt: _fetchedAt, ...content } = entry;
    const contentHash = createHash("sha256")
        .update(JSON.stringify(["paseo.provider-result/1", content]))
        .digest("base64url");
    return { entry, contentHash };
}
function toErrorMessage(error) {
    if (error instanceof Error && error.message) {
        return error.message;
    }
    if (typeof error === "string" && error) {
        return error;
    }
    return "Unknown error";
}
function formatProviderStatus(entry) {
    if (entry.status === "ready")
        return "Ready";
    if (entry.status === "error")
        return `Error: ${entry.error ?? "Unknown error"}`;
    if (entry.status === "unavailable")
        return "Unavailable";
    return "Loading";
}
export function sameSnapshotRecords(previous, current) {
    return (previous.length === current.length &&
        previous.every((before, index) => {
            const after = current[index];
            return (before === after ||
                (before.entry.provider === after.entry.provider &&
                    before.contentHash === after.contentHash &&
                    before.entry.fetchedAt === after.entry.fetchedAt));
        }));
}
//# sourceMappingURL=provider-snapshot-manager.js.map