import { loadPersistedConfig, savePersistedConfig, } from "./persisted-config.js";
import { ProviderOverrideSchema } from "./agent/provider-launch-config.js";
import { MutableDaemonConfigSchema, MutableDaemonConfigPatchSchema, } from "@getpaseo/protocol/messages";
function getLogger(logger) {
    return logger?.child({ module: "daemon-config-store" });
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function deepMerge(current, patch) {
    const next = { ...current };
    for (const [key, patchValue] of Object.entries(patch)) {
        if (patchValue === undefined) {
            continue;
        }
        const currentValue = next[key];
        if (isRecord(currentValue) && isRecord(patchValue)) {
            next[key] = deepMerge(currentValue, patchValue);
            continue;
        }
        next[key] = patchValue;
    }
    return next;
}
function omitProvidersFromConfig(config, providers) {
    if (providers.length === 0 || !config.providers) {
        return config;
    }
    let changed = false;
    const nextProviders = { ...config.providers };
    for (const provider of providers) {
        if (provider in nextProviders) {
            delete nextProviders[provider];
            changed = true;
        }
    }
    return changed ? { ...config, providers: nextProviders } : config;
}
function omitMetadataGenerationProvidersFromConfig(config, providers) {
    if (providers.length === 0 || !config.metadataGeneration?.providers) {
        return config;
    }
    const removedProviderIds = new Set(providers);
    const nextProviders = config.metadataGeneration.providers.filter((entry) => {
        return typeof entry.provider !== "string" || !removedProviderIds.has(entry.provider);
    });
    if (nextProviders.length === config.metadataGeneration.providers.length) {
        return config;
    }
    return {
        ...config,
        metadataGeneration: {
            ...config.metadataGeneration,
            providers: nextProviders,
        },
    };
}
function omitProvidersFromOverrides(overrides, providers) {
    if (!overrides) {
        return undefined;
    }
    const nextOverrides = { ...overrides };
    for (const provider of providers) {
        delete nextOverrides[provider];
    }
    return Object.keys(nextOverrides).length > 0 ? nextOverrides : undefined;
}
function getValueAtPath(config, path) {
    return path
        .split(".")
        .reduce((value, segment) => (isRecord(value) ? value[segment] : undefined), config);
}
function isEqualValue(a, b) {
    return JSON.stringify(a) === JSON.stringify(b);
}
const RELOADABLE_PATHS = [
    "daemon.relay.enabled",
    "daemon.mcp.enabled",
    "daemon.mcp.injectIntoAgents",
    "daemon.browserTools.enabled",
    "daemon.hostnames",
    "daemon.cors.allowedOrigins",
    "daemon.trustedProxies",
    "daemon.git.maxProcessesPerSecond",
    "daemon.git.maxProcessConcurrency",
    "daemon.git.maxQueueDepth",
    "daemon.autoArchiveAfterMerge",
    "daemon.enableTerminalAgentHooks",
    "daemon.appendSystemPrompt",
    "daemon.terminalProfiles",
    "daemon.agentProfiles",
    "app.baseUrl",
    "agents.providers",
    "agents.catalogRefreshTimeoutMs",
    "agents.metadataGeneration",
    "agents.skills.selection",
    "pluginsEnabled",
];
const PERSISTED_TO_MUTABLE_PATH = new Map([
    ["daemon.relay.enabled", "relay.enabled"],
    ["daemon.mcp.enabled", "mcp.enabled"],
    ["daemon.mcp.injectIntoAgents", "mcp.injectIntoAgents"],
    ["daemon.browserTools.enabled", "browserTools.enabled"],
    ["daemon.hostnames", "hostnames"],
    ["daemon.cors.allowedOrigins", "cors.allowedOrigins"],
    ["daemon.trustedProxies", "trustedProxies"],
    ["daemon.git.maxProcessesPerSecond", "git.maxProcessesPerSecond"],
    ["daemon.git.maxProcessConcurrency", "git.maxProcessConcurrency"],
    ["daemon.git.maxQueueDepth", "git.maxQueueDepth"],
    ["daemon.autoArchiveAfterMerge", "autoArchiveAfterMerge"],
    ["daemon.enableTerminalAgentHooks", "enableTerminalAgentHooks"],
    ["daemon.appendSystemPrompt", "appendSystemPrompt"],
    ["daemon.terminalProfiles", "terminalProfiles"],
    ["daemon.agentProfiles", "agentProfiles"],
    ["app.baseUrl", "app.baseUrl"],
    ["agents.providers", "providers"],
    ["agents.catalogRefreshTimeoutMs", "catalogRefreshTimeoutMs"],
    ["agents.metadataGeneration", "metadataGeneration"],
    ["agents.skills.selection", "skills.selection"],
    ["pluginsEnabled", "pluginsEnabled"],
]);
function pathBelongsTo(path, owner) {
    return path === owner || path.startsWith(`${owner}.`);
}
function diffPaths(previous, next, prefix = "") {
    if (isEqualValue(previous, next))
        return [];
    if (!isRecord(previous) || !isRecord(next)) {
        if (isRecord(previous))
            return leafPaths(previous, prefix);
        if (isRecord(next))
            return leafPaths(next, prefix);
        return prefix ? [prefix] : [];
    }
    const keys = new Set([...Object.keys(previous), ...Object.keys(next)]);
    return Array.from(keys).flatMap((key) => {
        const path = prefix ? `${prefix}.${key}` : key;
        return diffPaths(previous[key], next[key], path);
    });
}
function leafPaths(record, prefix) {
    return Object.entries(record).flatMap(([key, value]) => {
        const path = prefix ? `${prefix}.${key}` : key;
        return isRecord(value) ? leafPaths(value, path) : [path];
    });
}
function compactOwnedPaths(paths, owners) {
    const compacted = new Set();
    for (const path of paths) {
        const owner = owners.find((candidate) => pathBelongsTo(path, candidate));
        compacted.add(owner ?? path);
    }
    return Array.from(compacted).sort();
}
function pickSupportedPatchFields(patch) {
    return {
        ...(patch.relay?.enabled !== undefined ? { relay: { enabled: patch.relay.enabled } } : {}),
        ...(patch.mcp?.injectIntoAgents !== undefined
            ? { mcp: { injectIntoAgents: patch.mcp.injectIntoAgents } }
            : {}),
        ...(patch.browserTools?.enabled !== undefined
            ? { browserTools: { enabled: patch.browserTools.enabled } }
            : {}),
        ...(patch.providers !== undefined ? { providers: patch.providers } : {}),
        ...(patch.removeProviders !== undefined ? { removeProviders: patch.removeProviders } : {}),
        ...(patch.metadataGeneration?.providers !== undefined
            ? { metadataGeneration: { providers: patch.metadataGeneration.providers } }
            : {}),
        ...(patch.autoArchiveAfterMerge !== undefined
            ? { autoArchiveAfterMerge: patch.autoArchiveAfterMerge }
            : {}),
        ...(patch.enableTerminalAgentHooks !== undefined
            ? { enableTerminalAgentHooks: patch.enableTerminalAgentHooks }
            : {}),
        ...(patch.appendSystemPrompt !== undefined
            ? { appendSystemPrompt: patch.appendSystemPrompt }
            : {}),
        ...(patch.terminalProfiles !== undefined ? { terminalProfiles: patch.terminalProfiles } : {}),
        ...(patch.agentProfiles !== undefined ? { agentProfiles: patch.agentProfiles } : {}),
        ...(patch.pluginsEnabled !== undefined ? { pluginsEnabled: patch.pluginsEnabled } : {}),
        ...(patch.plugins !== undefined ? { plugins: patch.plugins } : {}),
    };
}
export function applyMutableProviderConfigToOverrides(baseOverrides, mutableProviders) {
    if (!baseOverrides && (!mutableProviders || Object.keys(mutableProviders).length === 0)) {
        return undefined;
    }
    const nextOverrides = { ...baseOverrides };
    for (const [providerId, providerConfig] of Object.entries(mutableProviders ?? {})) {
        const previousOverride = nextOverrides[providerId];
        const parsedOverride = ProviderOverrideSchema.strip().parse(providerConfig);
        nextOverrides[providerId] = {
            ...previousOverride,
            ...parsedOverride,
            ...(parsedOverride.paseoTools
                ? {
                    paseoTools: {
                        ...previousOverride?.paseoTools,
                        ...parsedOverride.paseoTools,
                    },
                }
                : {}),
        };
    }
    return nextOverrides;
}
export class DaemonConfigStore {
    constructor(paseoHome, initial, logger, options = {}) {
        this.changeListeners = new Set();
        this.applyListeners = new Set();
        this.fieldChangeHandlers = new Map();
        this.paseoHome = paseoHome;
        this.logger = getLogger(logger);
        this.current = MutableDaemonConfigSchema.parse({
            ...initial,
            relay: initial.relay ?? { enabled: true },
        });
        this.relayEnabledMutable = options.relayEnabledMutable ?? true;
        this.reloadSource = options.reloadSource;
        this.startupPersisted = options.startupPersisted ?? loadPersistedConfig(paseoHome, this.logger);
        this.lastKnownPersisted = this.startupPersisted;
    }
    get() {
        return this.current;
    }
    patch(partial) {
        const parsedPatch = pickSupportedPatchFields(MutableDaemonConfigPatchSchema.parse(partial));
        return this.applySupportedPatch(parsedPatch);
    }
    setAgentSkillSelection(selection) {
        return this.applySupportedPatch({ skills: { selection } });
    }
    applySupportedPatch(parsedPatch) {
        if (parsedPatch.relay?.enabled !== undefined && !this.relayEnabledMutable) {
            throw new Error("Relay is controlled by a daemon launch override. Remove PASEO_RELAY_ENABLED or the relay CLI flag before changing it here.");
        }
        const { removeProviders = [], ...configPatch } = parsedPatch;
        const removedProviders = Array.from(new Set(removeProviders));
        const merged = deepMerge(this.current, configPatch);
        if (parsedPatch.skills?.selection !== undefined) {
            merged.skills = { selection: parsedPatch.skills.selection };
        }
        if (parsedPatch.plugins !== undefined)
            merged.plugins = parsedPatch.plugins;
        const next = MutableDaemonConfigSchema.parse(omitMetadataGenerationProvidersFromConfig(omitProvidersFromConfig(merged, removedProviders), removedProviders));
        const configChanged = !isEqualValue(this.current, next);
        if (!configChanged && removedProviders.length === 0) {
            return this.current;
        }
        const { previous: persistedBeforePatch, knownNext } = this.persistConfig(configPatch, removedProviders);
        if (!configChanged) {
            this.lastKnownPersisted = knownNext;
            return this.current;
        }
        try {
            this.applyReplacement(next, { removedProviders });
            this.lastKnownPersisted = knownNext;
        }
        catch (error) {
            savePersistedConfig(this.paseoHome, persistedBeforePatch, this.logger);
            throw error;
        }
        return this.current;
    }
    reload() {
        if (!this.reloadSource) {
            throw new Error("Daemon config reload is unavailable for this daemon instance");
        }
        const persisted = loadPersistedConfig(this.paseoHome, this.logger);
        const resolved = this.reloadSource.resolve(persisted);
        // Plugin source changes require the plugin lifecycle operation or a daemon
        // restart. The global switch is independently reloadable.
        const desired = MutableDaemonConfigSchema.parse({
            ...resolved.mutable,
            plugins: this.current.plugins,
        });
        const changedSinceLastApply = diffPaths(this.lastKnownPersisted, persisted);
        const overrideControlledPaths = compactOwnedPaths(changedSinceLastApply.filter((path) => resolved.overrideControlledPaths.some((owner) => pathBelongsTo(path, owner))), resolved.overrideControlledPaths);
        const appliedPaths = RELOADABLE_PATHS.filter((persistedPath) => {
            if (resolved.overrideControlledPaths.some((owner) => pathBelongsTo(persistedPath, owner))) {
                return false;
            }
            const mutablePath = PERSISTED_TO_MUTABLE_PATH.get(persistedPath);
            return (mutablePath !== undefined &&
                !isEqualValue(getValueAtPath(this.current, mutablePath), getValueAtPath(desired, mutablePath)));
        });
        const restartRequiredPaths = compactOwnedPaths(diffPaths(this.startupPersisted, persisted).filter((path) => {
            if (path === "$schema" || path === "version")
                return false;
            if (RELOADABLE_PATHS.some((owner) => pathBelongsTo(path, owner)))
                return false;
            return !resolved.overrideControlledPaths.some((owner) => pathBelongsTo(path, owner));
        }), []);
        const removedProviders = Object.keys(this.current.providers).filter((provider) => !(provider in desired.providers));
        this.applyReplacement(desired, { removedProviders });
        this.lastKnownPersisted = persisted;
        return {
            appliedPaths: [...appliedPaths].sort(),
            restartRequiredPaths,
            overrideControlledPaths,
        };
    }
    applyReplacement(next, changeDetails) {
        const changedFieldPaths = Array.from(this.fieldChangeHandlers.keys()).filter((path) => {
            return !isEqualValue(getValueAtPath(this.current, path), getValueAtPath(next, path));
        });
        if (isEqualValue(this.current, next) && changeDetails.removedProviders.length === 0)
            return;
        const previous = this.current;
        const appliedFieldChanges = [];
        const applyRollbacks = [];
        this.current = next;
        try {
            for (const path of changedFieldPaths) {
                const handlers = this.fieldChangeHandlers.get(path);
                if (!handlers) {
                    continue;
                }
                const value = getValueAtPath(next, path);
                const previousValue = getValueAtPath(previous, path);
                for (const handler of handlers) {
                    appliedFieldChanges.push({ handler, previousValue });
                    handler(value);
                }
            }
            for (const listener of this.applyListeners) {
                applyRollbacks.push(listener(next, previous, changeDetails));
            }
        }
        catch (error) {
            this.current = previous;
            const rollbackErrors = [];
            for (const rollback of applyRollbacks.toReversed()) {
                try {
                    rollback();
                }
                catch (rollbackError) {
                    rollbackErrors.push(rollbackError);
                }
            }
            for (const change of appliedFieldChanges.toReversed()) {
                try {
                    change.handler(change.previousValue);
                }
                catch (rollbackError) {
                    rollbackErrors.push(rollbackError);
                }
            }
            if (rollbackErrors.length > 0) {
                const rollbackFailure = new Error("Daemon config apply failed and one or more live owners could not roll back", { cause: error });
                Object.assign(rollbackFailure, { rollbackErrors });
                throw rollbackFailure;
            }
            throw error;
        }
        for (const listener of this.changeListeners) {
            try {
                listener(next, changeDetails);
            }
            catch (error) {
                this.logger?.info({ error }, "Daemon config change notification failed");
            }
        }
    }
    onFieldChange(path, handler) {
        const handlers = this.fieldChangeHandlers.get(path) ?? new Set();
        handlers.add(handler);
        this.fieldChangeHandlers.set(path, handlers);
        return () => {
            const currentHandlers = this.fieldChangeHandlers.get(path);
            if (!currentHandlers) {
                return;
            }
            currentHandlers.delete(handler);
            if (currentHandlers.size === 0) {
                this.fieldChangeHandlers.delete(path);
            }
        };
    }
    onChange(listener) {
        this.changeListeners.add(listener);
        return () => {
            this.changeListeners.delete(listener);
        };
    }
    onApply(listener) {
        // A live owner must either throw before changing its state or return a
        // rollback that restores the previous config. Notifications belong in
        // onChange so they run only after every live owner commits.
        this.applyListeners.add(listener);
        return () => {
            this.applyListeners.delete(listener);
        };
    }
    persistConfig(patch, removeProviders) {
        const persisted = loadPersistedConfig(this.paseoHome, this.logger);
        const merge = (source) => mergeMutablePatchIntoPersistedConfig({
            persisted: source,
            patch,
            removeProviders,
            persistRelayEnabled: this.relayEnabledMutable,
        });
        const nextPersisted = merge(persisted);
        const knownNext = merge(this.lastKnownPersisted);
        savePersistedConfig(this.paseoHome, nextPersisted, this.logger);
        return { previous: persisted, knownNext };
    }
}
function mergeMutablePatchIntoPersistedConfig(params) {
    const { persisted, patch, removeProviders, persistRelayEnabled } = params;
    const daemon = mergeMutableDaemonPatch(persisted.daemon, patch, persistRelayEnabled);
    const agents = mergeMutableAgentPatch(persisted.agents, patch, removeProviders);
    return {
        ...persisted,
        ...(patch.pluginsEnabled !== undefined ? { pluginsEnabled: patch.pluginsEnabled } : {}),
        ...(patch.plugins !== undefined ? { plugins: patch.plugins } : {}),
        ...(daemon ? { daemon } : { daemon: undefined }),
        ...(agents ? { agents } : { agents: undefined }),
    };
}
function mergeMutableAgentPatch(persistedAgents, patch, removeProviders) {
    if (patch.providers === undefined &&
        patch.metadataGeneration === undefined &&
        patch.skills === undefined &&
        removeProviders.length === 0) {
        return persistedAgents;
    }
    const next = { ...persistedAgents };
    const persistedProviderOverrides = omitProvidersFromOverrides(persistedAgents?.providers, removeProviders);
    const providerOverrides = applyMutableProviderConfigToOverrides(persistedProviderOverrides, patch.providers);
    if (providerOverrides)
        next["providers"] = providerOverrides;
    else
        delete next["providers"];
    if (patch.metadataGeneration?.providers !== undefined) {
        next["metadataGeneration"] = { providers: patch.metadataGeneration.providers };
    }
    else if (removeProviders.length > 0 && persistedAgents?.metadataGeneration?.providers) {
        const removed = new Set(removeProviders);
        next["metadataGeneration"] = {
            providers: persistedAgents.metadataGeneration.providers.filter((entry) => !removed.has(entry.provider)),
        };
    }
    if (patch.skills?.selection !== undefined) {
        next["skills"] = { selection: patch.skills.selection };
    }
    return Object.keys(next).length > 0 ? next : undefined;
}
function mergeMutableDaemonPatch(persistedDaemon, patch, persistRelayEnabled) {
    const next = { ...persistedDaemon };
    if (persistRelayEnabled && patch.relay?.enabled !== undefined) {
        next.relay = { ...next.relay, enabled: patch.relay.enabled };
    }
    if (patch.mcp?.injectIntoAgents !== undefined) {
        next.mcp = { ...next.mcp, injectIntoAgents: patch.mcp.injectIntoAgents };
    }
    if (patch.browserTools?.enabled !== undefined) {
        next.browserTools = { ...next.browserTools, enabled: patch.browserTools.enabled };
    }
    if (patch.autoArchiveAfterMerge !== undefined) {
        next.autoArchiveAfterMerge = patch.autoArchiveAfterMerge;
    }
    if (patch.enableTerminalAgentHooks !== undefined) {
        next.enableTerminalAgentHooks = patch.enableTerminalAgentHooks;
    }
    if (patch.appendSystemPrompt !== undefined)
        next.appendSystemPrompt = patch.appendSystemPrompt;
    if (patch.terminalProfiles !== undefined)
        next.terminalProfiles = patch.terminalProfiles;
    if (patch.agentProfiles !== undefined)
        next.agentProfiles = patch.agentProfiles;
    return Object.keys(next).length > 0 ? next : undefined;
}
//# sourceMappingURL=daemon-config-store.js.map