import type { PluginLifecycle } from "./lifecycle/index.js";
import type pino from "pino";
import type { ProviderRegistration } from "@getpaseo/plugin/server/provider";
import { type PluginLogEntry, type PluginListItem, type PluginSourceStatusItem, type PluginSourceUpdateItem, type PluginUpdateSelection, type PluginUpdateProposal, type PluginUpdatePreview, type PluginUpdateResult } from "@getpaseo/protocol/messages";
import type { DaemonConfigStore } from "../daemon-config-store.js";
import { ManagedPluginSources } from "./managed-source.js";
import { PluginRuntime } from "./runtime.js";
import { BuiltinPluginLoader, type BuiltinPlugin } from "./builtin/index.js";
import type { PluginProviderMetadata } from "./plugin-process-protocol.js";
import { type AgentUsageLookup, type ListUsageReportsOptions } from "./usage-sources/index.js";
import type { PluginUsageSourceMetadata } from "./plugin-process-protocol.js";
interface PluginRuntimePort {
    emit?: PluginLifecycle["emit"];
    drainEvents?: PluginRuntime["drainEvents"];
    before?: PluginLifecycle["before"];
    catalog: PluginRuntime["catalog"];
    invoke(pluginId: string, method: string, input: unknown): Promise<unknown>;
    getLogs(pluginId: string): PluginLogEntry[];
    clearLogs(pluginId: string): void;
    getProviderRegistrations?(pluginId: string): readonly PluginProviderMetadata[];
    getUsageSourceRegistrations(pluginId: string): readonly PluginUsageSourceMetadata[];
    fetchUsage: PluginRuntime["fetchUsage"];
    discoverUsage: PluginRuntime["discoverUsage"];
    connectProvider: PluginRuntime["connectProvider"];
    getProviderCatalogCacheKey?: PluginRuntime["getProviderCatalogCacheKey"];
    getProviderStatus?: PluginRuntime["getProviderStatus"];
    validatePlugin?(path: string): Promise<void>;
    startPlugin(pluginId: string, path: string, canPublish: () => boolean): Promise<void>;
    startBuiltinPlugin?(plugin: BuiltinPlugin): Promise<void>;
    stopPluginById(pluginId: string): Promise<boolean>;
    stopAll(): Promise<void>;
    subscribe(listener: (pluginId: string, error?: string) => void): () => void;
    bindPaseoSessionHost(sessionHost: Parameters<PluginRuntime["bindPaseoSessionHost"]>[0]): void;
}
interface PluginServiceDependencies {
    usageAgents?: AgentUsageLookup;
    settingsDirectory?: string;
    runtime?: PluginRuntimePort;
    managedSources?: ManagedPluginSources;
    builtinPlugins?: BuiltinPluginLoader;
}
export declare class PluginService {
    private readonly configStore;
    private readonly daemonVersion;
    private readonly dependencies;
    private readonly runtime;
    private readonly managedSources;
    private readonly builtinPluginIds;
    private readonly builtinPlugins;
    private readonly logger;
    private readonly errors;
    private readonly listeners;
    private readonly providers;
    private readonly usageSources;
    private readonly usageSourceIdsByPlugin;
    private readonly providerIdsByPlugin;
    private readonly providerListeners;
    private lifecycle;
    private globalStartsBlocked;
    private started;
    private readonly settingsListeners;
    constructor(logger: pino.Logger, configStore: DaemonConfigStore, daemonVersion: string, dependencies?: PluginServiceDependencies);
    readonly emit: PluginLifecycle["emit"];
    drainEvents(): Promise<void>;
    readonly before: PluginLifecycle["before"];
    subscribeSettings(listener: (pluginId: string, settingsId: string) => void): () => void;
    subscribe(listener: (pluginId: string) => void): () => void;
    bindPaseoSessionHost(sessionHost: Parameters<PluginRuntime["bindPaseoSessionHost"]>[0]): void;
    getProviderRegistrations(): readonly ProviderRegistration[];
    listUsageReports(options?: ListUsageReportsOptions): Promise<{
        id: string;
        account: {
            label?: string | undefined;
        };
        fetchedAt: string;
        sourceId: string;
        sourceLabel: string;
        report: {
            status: "available";
            windows: {
                id: string;
                label: string;
                shortLabel?: string | undefined;
                summary?: boolean | undefined;
                usedPct?: number | null | undefined;
                remainingPct?: number | null | undefined;
                resetsAt?: string | null | undefined;
                runsOutAt?: string | null | undefined;
                shortfallPct?: number | null | undefined;
                tone?: "default" | "warning" | "danger" | "ok" | undefined;
            }[];
            planLabel?: string | undefined;
            balances?: {
                id: string;
                label: string;
                unit: "tokens" | "requests" | "usd" | "credits";
                used?: number | null | undefined;
                remaining?: number | null | undefined;
                limit?: number | null | undefined;
                resetsAt?: string | null | undefined;
                tone?: "default" | "warning" | "danger" | "ok" | undefined;
            }[] | undefined;
            details?: {
                id: string;
                label: string;
                value: string;
                tone?: "default" | "warning" | "danger" | "ok" | undefined;
            }[] | undefined;
        } | {
            status: "unavailable";
            problem: {
                kind: "expired";
                expiresAt: string;
                refreshedBy?: string | undefined;
            } | {
                kind: "rejected";
                status: number;
                refreshedBy?: string | undefined;
            } | {
                kind: "no_quota";
                detail: string;
            };
        } | {
            status: "error";
            error: string;
        };
        icon?: string | undefined;
        loginErrors?: {
            harness: string;
            report: {
                status: "unavailable";
                problem: {
                    kind: "expired";
                    expiresAt: string;
                    refreshedBy?: string | undefined;
                } | {
                    kind: "rejected";
                    status: number;
                    refreshedBy?: string | undefined;
                } | {
                    kind: "no_quota";
                    detail: string;
                };
            } | {
                status: "error";
                error: string;
            };
        }[] | undefined;
    }[]>;
    listLegacyUsage(): Promise<{
        fetchedAt: string;
        providers: import("@getpaseo/protocol/messages").ProviderUsage[];
    }>;
    subscribeProviderRegistrations(listener: () => void): () => void;
    start(): Promise<void>;
    listPlugins(): Promise<PluginListItem[]>;
    getLogs(pluginId: string): PluginLogEntry[];
    catalog(): ReturnType<PluginRuntime["catalog"]>;
    installDirectory(input: {
        path: string;
        id?: string;
    }): Promise<PluginListItem>;
    inspectDirectory(configuredPath: string): Promise<{
        id: string;
    }>;
    installSource(input: {
        source: string;
        id?: string;
        ref?: string;
    }): Promise<PluginListItem>;
    statusSources(pluginId?: string): Promise<PluginSourceStatusItem[]>;
    updateSources(_pluginId?: string): Promise<PluginSourceUpdateItem[]>;
    previewUpdates(input: {
        pluginId?: string;
        target?: PluginUpdateSelection;
    }): Promise<PluginUpdatePreview[]>;
    applyUpdates(proposals: PluginUpdateProposal[]): Promise<PluginUpdateResult[]>;
    reloadPlugin(pluginId: string): Promise<PluginListItem>;
    enablePlugin(pluginId: string): Promise<PluginListItem>;
    disablePlugin(pluginId: string): Promise<PluginListItem>;
    removePlugin(pluginId: string): Promise<void>;
    invokePluginRpc(pluginId: string, method: string, input: unknown): Promise<unknown>;
    stopAllPlugins(): Promise<void>;
    private handleGlobalSwitch;
    private startConfigured;
    private startExplicit;
    private canPublish;
    private startPlugin;
    private stopPlugin;
    private stopConfiguredPlugins;
    private stopAll;
    private publishUsageSources;
    private removeUsageSources;
    private publishProviderRegistrations;
    private removeProviderRegistrations;
    private notifyProviderRegistrations;
    private enqueue;
    private recordFailure;
    private checkRequirements;
    private updateSource;
    private validateCandidate;
    private requireManagedSources;
    private requireSource;
    private requireEnabledSource;
    private patchSource;
    private requireItem;
    private notify;
}
export {};
//# sourceMappingURL=index.d.ts.map