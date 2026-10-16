import path from "node:path";
import { stat, rm } from "node:fs/promises";
import { PluginIdSchema, } from "@getpaseo/protocol/messages";
import { parsePluginSourceReference } from "@getpaseo/protocol/plugin-source-reference";
import { assertPluginCompatibility } from "@getpaseo/protocol/plugin-requirements";
import { BUILTIN_PROVIDER_IDS } from "@getpaseo/protocol/provider-manifest";
import { readPluginManifest } from "./manifest.js";
import { expandTilde } from "../../utils/path.js";
import { runPluginBuild } from "./preparation.js";
import { PluginRuntime } from "./runtime.js";
import { BuiltinPluginLoader } from "./builtin/index.js";
import { readPluginProviderIcon } from "./provider-icon.js";
import { UsageSourceRegistry, } from "./usage-sources/index.js";
const BUILTIN_PROVIDER_ID_SET = new Set(BUILTIN_PROVIDER_IDS);
function resolvePluginStatus(input) {
    if (!input.enabled || !input.globallyEnabled)
        return "disabled";
    return input.running ? "running" : "failed";
}
export class PluginService {
    constructor(logger, configStore, daemonVersion, dependencies = {}) {
        this.configStore = configStore;
        this.daemonVersion = daemonVersion;
        this.dependencies = dependencies;
        this.errors = new Map();
        this.listeners = new Set();
        this.providers = new Map();
        this.usageSourceIdsByPlugin = new Map();
        this.providerIdsByPlugin = new Map();
        this.providerListeners = new Set();
        this.lifecycle = Promise.resolve();
        this.globalStartsBlocked = true;
        this.started = false;
        this.settingsListeners = new Set();
        this.emit = (name, event) => {
            this.runtime.emit?.(name, event);
        };
        this.before = async (name, request) => {
            if (this.runtime.before) {
                return this.runtime.before(name, request);
            }
            return request;
        };
        this.logger = logger.child({ module: "plugin-service" });
        this.usageSources = new UsageSourceRegistry(Date.now, 300000, this.logger, dependencies.usageAgents);
        this.runtime =
            dependencies.runtime ??
                new PluginRuntime(logger, daemonVersion, {
                    settingsDirectory: dependencies.settingsDirectory,
                    onSettingsChanged: (pluginId, settingsId) => {
                        for (const listener of this.settingsListeners)
                            listener(pluginId, settingsId);
                    },
                });
        this.managedSources = dependencies.managedSources ?? null;
        this.builtinPlugins = dependencies.builtinPlugins ?? new BuiltinPluginLoader(undefined, []);
        this.builtinPluginIds = this.builtinPlugins.ids;
        this.runtime.subscribe((pluginId, error) => {
            this.removeProviderRegistrations(pluginId);
            this.removeUsageSources(pluginId);
            if (error)
                this.errors.set(pluginId, error);
            this.notify(pluginId);
        });
    }
    async drainEvents() {
        await this.runtime.drainEvents?.();
    }
    subscribeSettings(listener) {
        this.settingsListeners.add(listener);
        return () => this.settingsListeners.delete(listener);
    }
    subscribe(listener) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }
    bindPaseoSessionHost(sessionHost) {
        this.runtime.bindPaseoSessionHost(sessionHost);
    }
    getProviderRegistrations() {
        return [...this.providers.values()].sort((left, right) => left.id.localeCompare(right.id));
    }
    listUsageReports(options) {
        return this.usageSources.listReports(options);
    }
    listLegacyUsage() {
        return this.usageSources.listLegacyUsage();
    }
    subscribeProviderRegistrations(listener) {
        this.providerListeners.add(listener);
        return () => this.providerListeners.delete(listener);
    }
    async start() {
        if (this.started)
            return;
        this.started = true;
        const config = this.configStore.get();
        this.globalStartsBlocked = config.pluginsEnabled !== true;
        await this.builtinPlugins.load(async (plugin) => {
            try {
                await this.runtime.startBuiltinPlugin?.(plugin);
                await this.publishProviderRegistrations(plugin.id, plugin.directory);
                this.publishUsageSources(plugin.id);
            }
            catch (error) {
                this.logger.error({ err: error, pluginId: plugin.id }, "Failed to start built-in plugin");
            }
        });
        if (config.pluginsEnabled === true) {
            for (const [pluginId, source] of Object.entries(config.plugins ?? {})) {
                if (source.enabled === false)
                    continue;
                await this.startConfigured(pluginId);
                this.notify(pluginId);
            }
        }
        this.configStore.onFieldChange("pluginsEnabled", (value) => {
            this.handleGlobalSwitch(value === true);
        });
    }
    async listPlugins() {
        const config = this.configStore.get();
        const running = new Set(this.runtime.catalog().map((plugin) => plugin.id));
        const plugins = await Promise.all(Object.entries(config.plugins ?? {}).map(async ([id, source]) => {
            const enabled = source.enabled !== false;
            const item = {
                id,
                path: source.path,
                enabled,
                status: resolvePluginStatus({
                    enabled,
                    globallyEnabled: config.pluginsEnabled === true,
                    running: running.has(id),
                }),
            };
            const manifest = await readPluginManifest(path.resolve(source.path)).catch(() => null);
            if (manifest) {
                item.name = manifest.name;
                item.description = manifest.description;
                item.icon = manifest.icon;
                item.media = manifest.media;
            }
            item.installation = await this.managedSources
                ?.describe(id, source.path)
                .catch(() => undefined);
            if (!this.managedSources)
                item.installation = { identity: { kind: "directory", path: path.resolve(source.path) } };
            if (item.installation?.identity.kind === "git") {
                item.source = "git";
                item.remote = item.installation.identity.remote;
                item.commit = item.installation.currentRevision;
            }
            const error = this.errors.get(id);
            if (error && item.status === "failed")
                item.error = error;
            return item;
        }));
        return plugins.sort((left, right) => left.id.localeCompare(right.id));
    }
    getLogs(pluginId) {
        if (!this.builtinPluginIds.has(pluginId)) {
            this.requireSource(pluginId);
        }
        return this.runtime.getLogs(pluginId);
    }
    catalog() {
        return this.runtime.catalog();
    }
    async installDirectory(input) {
        return this.enqueue(async () => {
            const directory = path.resolve(input.path);
            const manifest = await readPluginManifest(directory);
            assertPluginCompatibility({ ...manifest, version: this.daemonVersion, runtime: "daemon" });
            const pluginId = PluginIdSchema.parse(input.id ?? manifest.id);
            if (this.builtinPluginIds.has(pluginId)) {
                throw new Error(`Plugin ID "${pluginId}" is reserved for a built-in plugin`);
            }
            if (this.configStore.get().plugins?.[pluginId]) {
                throw new Error(`Plugin ID "${pluginId}" is already configured; choose another ID with --id`);
            }
            const sources = {
                ...this.configStore.get().plugins,
                [pluginId]: { source: "directory", path: directory, enabled: true },
            };
            this.configStore.patch({ plugins: sources });
            if (this.canPublish(pluginId))
                await this.startConfigured(pluginId);
            this.notify(pluginId);
            const installed = await this.requireItem(pluginId);
            if (installed.status === "failed") {
                throw new Error(installed.error ?? `Plugin failed to start: ${pluginId}`);
            }
            return installed;
        });
    }
    async inspectDirectory(configuredPath) {
        return readPluginManifest(path.resolve(configuredPath));
    }
    async installSource(input) {
        if (input.id && this.builtinPluginIds.has(input.id)) {
            throw new Error(`Plugin ID "${input.id}" is reserved for a built-in plugin`);
        }
        const reference = parsePluginSourceReference(input.source);
        if (reference.kind === "directory") {
            const directory = path.resolve(expandTilde(reference.source));
            const info = await stat(directory).catch(() => null);
            if (!info?.isDirectory())
                throw new Error(`Plugin directory does not exist: ${directory}`);
            if (input.ref)
                throw new Error("Plugin --ref is only valid for Git sources");
            const pluginDirectory = resolveLocalPluginPath(directory, reference.pluginPath);
            return this.installDirectory({ path: pluginDirectory, id: input.id });
        }
        const managedSources = this.requireManagedSources();
        return this.enqueue(async () => {
            let candidate = await managedSources.prepareInstall({
                ...input,
                source: reference.source,
                pluginPath: reference.pluginPath,
            });
            let pluginId;
            try {
                await this.checkRequirements(candidate.directory);
                pluginId = PluginIdSchema.parse(input.id ?? candidate.defaultId);
                if (this.builtinPluginIds.has(pluginId)) {
                    throw new Error(`Plugin ID "${pluginId}" is reserved for a built-in plugin`);
                }
                if (this.configStore.get().plugins?.[pluginId]) {
                    throw new Error(`Plugin ID "${pluginId}" is already configured; choose another ID with --id`);
                }
                await runPluginBuild(candidate.directory, candidate.build, this.logger);
                candidate = await managedSources.place(pluginId, candidate);
                await this.validateCandidate(candidate);
                await managedSources.verifyCandidate(pluginId, candidate);
            }
            catch (error) {
                await managedSources.discard(candidate);
                throw error;
            }
            this.patchSource(pluginId, { source: "directory", path: candidate.directory, enabled: true });
            try {
                if (this.canPublish(pluginId))
                    await this.startExplicit(pluginId, candidate.directory);
                managedSources.commit(pluginId, candidate.record);
            }
            catch (error) {
                await this.stopPlugin(pluginId);
                const sources = { ...this.configStore.get().plugins };
                delete sources[pluginId];
                this.configStore.patch({ plugins: sources });
                await managedSources.discard(candidate);
                this.errors.delete(pluginId);
                this.notify(pluginId);
                throw error;
            }
            this.notify(pluginId);
            return this.requireItem(pluginId);
        });
    }
    async statusSources(pluginId) {
        return this.enqueue(async () => {
            const sources = this.configStore.get().plugins ?? {};
            const selected = pluginId
                ? [[pluginId, this.requireSource(pluginId)]]
                : Object.entries(sources);
            const managedSources = this.requireManagedSources();
            const statuses = [];
            for (const [id, source] of selected) {
                statuses.push(await managedSources.status(id, source.path));
            }
            return statuses.sort((left, right) => left.id.localeCompare(right.id));
        });
    }
    // COMPAT(plugin-immediate-update): added in v0.8.0; remove after 2027-03-16 when clients use reviewed targets.
    async updateSources(_pluginId) {
        throw new Error("Update the client to review plugin updates before applying them.");
    }
    async previewUpdates(input) {
        if (input.target && !input.pluginId)
            throw new Error("An explicit update target requires one plugin ID");
        const sources = this.configStore.get().plugins ?? {};
        const ids = input.pluginId ? [input.pluginId] : Object.keys(sources).sort();
        return Promise.all(ids.map(async (id) => {
            try {
                return await this.requireManagedSources().preview(id, this.requireSource(id).path, input.target);
            }
            catch (error) {
                return {
                    id,
                    outcome: "error",
                    links: [],
                    error: error instanceof Error ? error.message : String(error),
                };
            }
        }));
    }
    async applyUpdates(proposals) {
        return this.enqueue(async () => {
            const results = [];
            for (const proposal of proposals) {
                try {
                    results.push(await this.updateSource(proposal));
                }
                catch (error) {
                    results.push({
                        id: proposal.id,
                        outcome: "error",
                        error: error instanceof Error ? error.message : String(error),
                    });
                }
            }
            return results;
        });
    }
    async reloadPlugin(pluginId) {
        return this.enqueue(async () => {
            const source = this.requireEnabledSource(pluginId);
            if (this.configStore.get().pluginsEnabled !== true) {
                throw new Error("Plugins are globally disabled");
            }
            this.errors.delete(pluginId);
            await this.stopPlugin(pluginId);
            await this.startExplicit(pluginId, source.path);
            this.notify(pluginId);
            return this.requireItem(pluginId);
        });
    }
    async enablePlugin(pluginId) {
        const source = this.requireSource(pluginId);
        this.patchSource(pluginId, { ...source, enabled: true });
        this.errors.delete(pluginId);
        return this.enqueue(async () => {
            const current = this.requireSource(pluginId);
            if (current.enabled !== false && this.configStore.get().pluginsEnabled === true) {
                await this.startExplicit(pluginId, current.path);
            }
            this.notify(pluginId);
            return this.requireItem(pluginId);
        });
    }
    async disablePlugin(pluginId) {
        const source = this.requireSource(pluginId);
        this.patchSource(pluginId, { ...source, enabled: false });
        const stopping = this.stopPlugin(pluginId);
        return this.enqueue(async () => {
            await stopping;
            this.errors.delete(pluginId);
            this.notify(pluginId);
            return this.requireItem(pluginId);
        });
    }
    async removePlugin(pluginId) {
        this.requireSource(pluginId);
        const stopping = this.stopPlugin(pluginId);
        const sources = { ...this.configStore.get().plugins };
        delete sources[pluginId];
        this.configStore.patch({ plugins: sources });
        await this.enqueue(async () => {
            await stopping;
            this.runtime.clearLogs(pluginId);
            this.errors.delete(pluginId);
            this.notify(pluginId);
            await this.managedSources?.remove(pluginId);
            if (this.dependencies.settingsDirectory)
                await rm(path.join(this.dependencies.settingsDirectory, pluginId), {
                    recursive: true,
                    force: true,
                });
        });
    }
    invokePluginRpc(pluginId, method, input) {
        return this.runtime.invoke(pluginId, method, input);
    }
    async stopAllPlugins() {
        this.globalStartsBlocked = true;
        const stopping = this.stopAll();
        await this.enqueue(async () => {
            await stopping;
            await this.stopAll();
        });
    }
    handleGlobalSwitch(enabled) {
        if (!enabled) {
            this.globalStartsBlocked = true;
            const stopping = this.stopConfiguredPlugins();
            for (const id of Object.keys(this.configStore.get().plugins ?? {}))
                this.notify(id);
            void this.enqueue(async () => {
                await stopping;
            }).catch((error) => this.logger.error({ err: error }, "Failed to disable plugins"));
            return;
        }
        void this.enqueue(async () => {
            this.globalStartsBlocked = false;
            for (const [pluginId, source] of Object.entries(this.configStore.get().plugins ?? {})) {
                if (source.enabled !== false)
                    await this.startConfigured(pluginId);
                this.notify(pluginId);
            }
        }).catch((error) => this.logger.error({ err: error }, "Failed to enable plugins"));
    }
    async startConfigured(pluginId) {
        const source = this.configStore.get().plugins?.[pluginId];
        if (!source || source.enabled === false || !this.canPublish(pluginId))
            return;
        this.errors.delete(pluginId);
        try {
            await this.startPlugin(pluginId, source.path);
        }
        catch (error) {
            if (this.canPublish(pluginId))
                this.recordFailure(pluginId, error);
        }
    }
    async startExplicit(pluginId, sourcePath) {
        try {
            await this.startPlugin(pluginId, sourcePath);
        }
        catch (error) {
            if (this.canPublish(pluginId)) {
                this.recordFailure(pluginId, error);
                this.notify(pluginId);
            }
            throw error;
        }
    }
    canPublish(pluginId) {
        const config = this.configStore.get();
        return (!this.globalStartsBlocked &&
            config.pluginsEnabled === true &&
            config.plugins?.[pluginId]?.enabled !== false &&
            config.plugins?.[pluginId] !== undefined);
    }
    async startPlugin(pluginId, sourcePath) {
        await this.runtime.startPlugin(pluginId, sourcePath, () => this.canPublish(pluginId));
        try {
            await this.publishProviderRegistrations(pluginId, sourcePath);
            this.publishUsageSources(pluginId);
        }
        catch (error) {
            try {
                this.removeProviderRegistrations(pluginId);
                this.removeUsageSources(pluginId);
            }
            finally {
                await this.runtime.stopPluginById(pluginId);
            }
            throw error;
        }
    }
    stopPlugin(pluginId) {
        this.removeProviderRegistrations(pluginId);
        this.removeUsageSources(pluginId);
        return this.runtime.stopPluginById(pluginId);
    }
    async stopConfiguredPlugins() {
        const stopping = Object.keys(this.configStore.get().plugins ?? {}).map((id) => this.stopPlugin(id));
        await Promise.all(stopping);
    }
    async stopAll() {
        for (const pluginId of this.providerIdsByPlugin.keys()) {
            this.removeProviderRegistrations(pluginId);
        }
        for (const pluginId of this.usageSourceIdsByPlugin.keys())
            this.removeUsageSources(pluginId);
        await this.runtime.stopAll();
    }
    publishUsageSources(pluginId) {
        const metadata = this.runtime.getUsageSourceRegistrations(pluginId);
        const registered = [];
        try {
            for (const source of metadata) {
                this.usageSources.register({
                    id: source.id,
                    label: source.label,
                    icon: source.icon,
                    discover: async (scope) => {
                        const result = await this.runtime.discoverUsage(pluginId, source.id, scope);
                        if (!Array.isArray(result))
                            throw new Error(`Invalid usage discovery from ${source.id}`);
                        return result;
                    },
                    fetch: (input) => {
                        return this.runtime.fetchUsage(pluginId, source.id, input);
                    },
                });
                registered.push(source.id);
            }
        }
        catch (error) {
            for (const id of registered)
                this.usageSources.unregister(id);
            throw error;
        }
        this.usageSourceIdsByPlugin.set(pluginId, registered);
    }
    removeUsageSources(pluginId) {
        for (const id of this.usageSourceIdsByPlugin.get(pluginId) ?? [])
            this.usageSources.unregister(id);
        this.usageSourceIdsByPlugin.delete(pluginId);
    }
    async publishProviderRegistrations(pluginId, pluginDirectory) {
        const metadata = this.runtime.getProviderRegistrations?.(pluginId) ?? [];
        for (const provider of metadata) {
            if (BUILTIN_PROVIDER_ID_SET.has(provider.id)) {
                throw new Error(`Plugin ${pluginId} cannot register builtin provider ID "${provider.id}"`);
            }
            if (this.providers.has(provider.id)) {
                throw new Error(`Plugin ${pluginId} cannot register provider ID "${provider.id}" twice`);
            }
        }
        const registrations = await Promise.all(metadata.map(async (provider) => ({
            id: provider.id,
            label: provider.label,
            description: provider.description,
            command: provider.command,
            status: provider.hasStatus
                ? (request) => {
                    if (!this.runtime.getProviderStatus)
                        throw new Error("Plugin runtime cannot resolve provider status");
                    return this.runtime.getProviderStatus(pluginId, provider.id, request);
                }
                : undefined,
            getCatalogCacheKey: provider.hasCatalogCacheKey
                ? (options) => {
                    if (!this.runtime.getProviderCatalogCacheKey)
                        throw new Error("Plugin runtime cannot resolve catalogue keys");
                    return this.runtime.getProviderCatalogCacheKey(pluginId, provider.id, options);
                }
                : undefined,
            icon: provider.iconPath
                ? await readPluginProviderIcon(pluginDirectory, provider.iconPath)
                : undefined,
            connect: (request) => this.runtime.connectProvider(pluginId, provider.id, request),
        })));
        const ids = registrations.map((provider) => provider.id);
        for (const provider of registrations) {
            this.providers.set(provider.id, {
                ...provider,
            });
        }
        if (ids.length > 0) {
            this.providerIdsByPlugin.set(pluginId, ids);
            this.notifyProviderRegistrations();
        }
    }
    removeProviderRegistrations(pluginId) {
        const ids = this.providerIdsByPlugin.get(pluginId);
        if (!ids)
            return;
        this.providerIdsByPlugin.delete(pluginId);
        for (const id of ids)
            this.providers.delete(id);
        this.notifyProviderRegistrations();
    }
    notifyProviderRegistrations() {
        for (const listener of this.providerListeners)
            listener();
    }
    enqueue(operation) {
        const result = this.lifecycle.then(operation, operation);
        this.lifecycle = result.then(() => undefined, () => undefined);
        return result;
    }
    recordFailure(pluginId, error) {
        this.errors.set(pluginId, error instanceof Error ? error.message : String(error));
    }
    async checkRequirements(directory) {
        const manifest = await readPluginManifest(directory);
        assertPluginCompatibility({ ...manifest, version: this.daemonVersion, runtime: "daemon" });
    }
    async updateSource(proposal) {
        const pluginId = proposal.id;
        const managedSources = this.requireManagedSources();
        const source = this.requireSource(pluginId);
        let candidate = await managedSources.prepareUpdate(proposal, source.path);
        try {
            await this.checkRequirements(candidate.directory);
            await runPluginBuild(candidate.directory, candidate.build, this.logger);
            candidate = await managedSources.place(pluginId, candidate);
            await this.validateCandidate(candidate);
            await managedSources.verifyCandidate(pluginId, candidate, proposal.target);
            await managedSources.assertCurrent(proposal, this.requireSource(pluginId).path);
        }
        catch (error) {
            await managedSources.discard(candidate);
            throw error;
        }
        const current = this.requireSource(pluginId);
        const isRunning = this.runtime.catalog().some((plugin) => plugin.id === pluginId);
        const shouldActivate = current.enabled !== false && this.configStore.get().pluginsEnabled === true;
        if (shouldActivate) {
            if (isRunning)
                await this.stopPlugin(pluginId);
            try {
                await this.startExplicit(pluginId, candidate.directory);
            }
            catch (error) {
                let recoveryError;
                try {
                    this.errors.delete(pluginId);
                    if (isRunning && this.canPublish(pluginId))
                        await this.startExplicit(pluginId, source.path);
                }
                catch (restoreError) {
                    recoveryError = restoreError;
                }
                finally {
                    await managedSources.discard(candidate);
                    this.notify(pluginId);
                }
                if (recoveryError)
                    throw new Error(`Update failed: ${error instanceof Error ? error.message : String(error)}; restoring previous plugin also failed: ${recoveryError instanceof Error ? recoveryError.message : String(recoveryError)}`, { cause: error });
                throw error;
            }
        }
        const activatedSource = this.configStore.get().plugins?.[pluginId];
        if (!activatedSource) {
            await this.stopPlugin(pluginId);
            await managedSources.discard(candidate);
            throw new Error(`Plugin is no longer configured: ${pluginId}`);
        }
        this.patchSource(pluginId, { ...activatedSource, path: candidate.directory });
        this.errors.delete(pluginId);
        this.notify(pluginId);
        let warning;
        try {
            await managedSources.removeVersion(pluginId, source.path);
        }
        catch (error) {
            warning = `Plugin updated, but previous installation cleanup failed: ${error instanceof Error ? error.message : String(error)}`;
        }
        return {
            id: pluginId,
            outcome: "updated",
            plugin: await this.requireItem(pluginId),
            ...(warning ? { warning } : {}),
        };
    }
    validateCandidate(candidate) {
        if (!this.runtime.validatePlugin) {
            throw new Error("Plugin runtime cannot validate managed sources");
        }
        return this.runtime.validatePlugin(candidate.directory);
    }
    requireManagedSources() {
        if (!this.managedSources)
            throw new Error("Plugin source management is unavailable");
        return this.managedSources;
    }
    requireSource(pluginId) {
        PluginIdSchema.parse(pluginId);
        const source = this.configStore.get().plugins?.[pluginId];
        if (!source)
            throw new Error(`Plugin is not configured: ${pluginId}`);
        return source;
    }
    requireEnabledSource(pluginId) {
        const source = this.requireSource(pluginId);
        if (source.enabled === false)
            throw new Error(`Plugin is disabled: ${pluginId}`);
        return source;
    }
    patchSource(pluginId, source) {
        this.configStore.patch({
            plugins: { ...this.configStore.get().plugins, [pluginId]: source },
        });
    }
    async requireItem(pluginId) {
        const item = (await this.listPlugins()).find((plugin) => plugin.id === pluginId);
        if (!item)
            throw new Error(`Plugin is not configured: ${pluginId}`);
        return item;
    }
    notify(pluginId) {
        for (const listener of this.listeners)
            listener(pluginId);
    }
}
function resolveLocalPluginPath(directory, pluginPath) {
    if (!pluginPath)
        return directory;
    if (path.isAbsolute(pluginPath))
        throw new Error("Plugin path must be relative to the source");
    const pluginDirectory = path.resolve(directory, pluginPath);
    const relative = path.relative(directory, pluginDirectory);
    const escapesSource = relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
    if (escapesSource)
        throw new Error("Plugin path must stay inside the source directory");
    return pluginDirectory;
}
//# sourceMappingURL=index.js.map