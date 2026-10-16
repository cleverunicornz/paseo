import type { Logger } from "pino";
import { type AgentClient, type AgentMode, type AgentModelDefinition, type AgentProvider, type ProviderSnapshotEntry } from "./agent-sdk-types.js";
import type { ManagedAgent } from "./agent-manager.js";
import type { WorkspaceGitService } from "../workspace-git-service.js";
import type { ManagedProcessRegistry } from "../managed-processes/managed-processes.js";
import type { OpenCodeBridge } from "./providers/opencode/bridge.js";
import type { AgentProviderRuntimeSettingsMap, ProviderOverride } from "./provider-launch-config.js";
import { type ProviderDefinition } from "./provider-registry.js";
import type { MutableDaemonConfig } from "../daemon-config-store.js";
import type { HubExecutionAgentValidationIssue } from "@getpaseo/protocol/messages";
import { type AgentConfigurationValidationInput } from "./agent-configuration-validator.js";
import type { ProviderRegistration } from "@getpaseo/plugin/server/provider";
export declare const GLOBAL_PROVIDER_SNAPSHOT_KEY = "paseo:global";
/** Published values are shared read-only; provider-owned data is detached at publication. */
export interface ProviderSnapshotRecord {
    readonly entry: ProviderSnapshotEntry;
    readonly contentHash: string;
}
export interface ProviderSnapshot {
    readonly cwd: string;
    readonly records: readonly ProviderSnapshotRecord[];
}
export interface ProviderSnapshotTransition {
    readonly previous: ProviderSnapshot;
    readonly current: ProviderSnapshot;
}
type ProviderSnapshotChangeListener = (transition: ProviderSnapshotTransition) => void;
export interface ProviderSnapshotManagerOptions {
    logger: Logger;
    runtimeSettings?: AgentProviderRuntimeSettingsMap;
    providerOverrides?: Record<string, ProviderOverride>;
    workspaceGitService?: Pick<WorkspaceGitService, "resolveRepoRoot">;
    managedProcesses?: ManagedProcessRegistry;
    isDev?: boolean;
    extraClients?: Partial<Record<AgentProvider, AgentClient>>;
    refreshTimeoutMs?: number;
    diagnosticTimeoutMs?: number;
    openCodeBridge?: OpenCodeBridge;
}
interface ProviderSnapshotRefreshOptions {
    cwd: string;
    providers?: AgentProvider[];
}
interface ProviderSnapshotWarmUpOptions {
    cwd?: string | null;
    providers?: AgentProvider[];
}
interface ProviderSnapshotReadOptions {
    cwd?: string | null;
    providers?: AgentProvider[];
    wait?: boolean;
}
interface ApplyMutableProviderConfigOptions {
    removeProviders?: readonly string[];
    replace?: boolean;
}
export interface PreparedMutableProviderConfig {
    agentManagerState: AgentManagerProviderState;
    commit(): void;
}
interface ProviderSnapshotProviderOptions {
    cwd?: string | null;
    provider: AgentProvider;
    wait?: boolean;
}
export interface ResolveProviderCreateConfigOptions {
    cwd?: string | null;
    provider: AgentProvider;
    requestedMode: string | undefined;
    featureValues: Record<string, unknown> | undefined;
    parent: ManagedAgent | null;
    unattended: boolean;
}
export interface ResolvedProviderCreateConfig {
    modeId: string | undefined;
    featureValues: Record<string, unknown> | undefined;
}
interface ResolveDefaultModelOptions {
    provider: AgentProvider;
    requestedModel?: string | null;
    cwd?: string;
}
export interface ProviderDiagnosticResult {
    provider: AgentProvider;
    diagnostic: string;
}
export interface AgentManagerProviderState {
    providerDefinitions: Partial<Record<AgentProvider, Pick<ProviderDefinition, "enabled" | "derivedFromProviderId" | "applyToolPolicy">>>;
    clients: Partial<Record<AgentProvider, AgentClient>>;
    retiredProviders?: readonly AgentProvider[];
}
export declare class ProviderSnapshotManager {
    private readonly catalogs;
    private readonly targets;
    private readonly events;
    private destroyed;
    private refreshTimeoutMs;
    private diagnosticTimeoutMs;
    private readonly logger;
    private readonly workspaceGitService?;
    private readonly managedProcesses?;
    private readonly openCodeBridge?;
    private readonly isDev;
    private readonly extraClients;
    private runtimeSettings;
    private providerOverrides;
    private baseProviderOverrides;
    private generation;
    private providerClients;
    private readonly ownedClients;
    private readonly pluginProviders;
    private pluginProvidersSettled;
    constructor(options: ProviderSnapshotManagerOptions);
    getSnapshot(cwd?: string): ProviderSnapshot;
    refreshSnapshotForCwd(options: ProviderSnapshotRefreshOptions): Promise<void>;
    refreshSettingsSnapshot(options?: Omit<ProviderSnapshotRefreshOptions, "cwd">): Promise<void>;
    warmUpSnapshotForCwd(options: ProviderSnapshotWarmUpOptions): Promise<void>;
    refresh(options: ProviderSnapshotRefreshOptions): Promise<void>;
    listRegisteredProviderIds(): AgentProvider[];
    hasProvider(provider: AgentProvider): boolean;
    getProviderLabel(provider: AgentProvider): string;
    getAgentManagerProviderState(): AgentManagerProviderState;
    private createAgentManagerState;
    /** Called after built-in and configured plugin startup has completed, including disabled plugins. */
    settlePluginProviders(): void;
    private warnUnknownProviderOverrides;
    replacePluginProviders(registrations: readonly ProviderRegistration[]): AgentManagerProviderState;
    private ensureClient;
    listProviders(input?: ProviderSnapshotReadOptions): Promise<ProviderSnapshotEntry[]>;
    getProvider(input: ProviderSnapshotProviderOptions): Promise<ProviderSnapshotEntry>;
    validateAgentConfiguration(input: AgentConfigurationValidationInput): Promise<HubExecutionAgentValidationIssue[]>;
    listModels(input: ProviderSnapshotProviderOptions): Promise<AgentModelDefinition[]>;
    listModes(input: ProviderSnapshotProviderOptions): Promise<AgentMode[]>;
    resolveDefaultModel(input: ResolveDefaultModelOptions): Promise<string | undefined>;
    resolveCreateConfig(input: ResolveProviderCreateConfigOptions): Promise<ResolvedProviderCreateConfig>;
    getProviderDiagnostic(provider: AgentProvider): Promise<ProviderDiagnosticResult>;
    applyMutableProviderConfig(mutableProviders: MutableDaemonConfig["providers"] | undefined, options?: ApplyMutableProviderConfigOptions): AgentManagerProviderState;
    prepareMutableProviderConfig(mutableProviders: MutableDaemonConfig["providers"] | undefined, options?: ApplyMutableProviderConfigOptions): PreparedMutableProviderConfig;
    private installGeneration;
    setRefreshTimeoutMs(refreshTimeoutMs: number | undefined): void;
    on(event: "change", listener: ProviderSnapshotChangeListener): this;
    off(event: "change", listener: ProviderSnapshotChangeListener): this;
    shutdown(): Promise<void>;
    destroy(): void;
    private buildRegistry;
    private resolveParent;
    private getSnapshotForTarget;
    private getReadyProvider;
    private requireProvider;
    private refreshDiagnosticSnapshotEntry;
    private getBaseProviderDiagnostic;
    private createGeneration;
    private warmUp;
    private refreshProviders;
    private resolveProvidersToWarm;
    private loadProviders;
    private loadProvider;
    private resolveCatalog;
    private refreshProvider;
    private publishTargets;
    private getOrCreateTarget;
    private getProviderIds;
    private resolveRefreshProviders;
}
export declare function resolveSnapshotCwd(cwd?: string | null): string;
export declare function isGlobalProviderSnapshotKey(cwd: string): boolean;
export declare function sameSnapshotRecords(previous: readonly ProviderSnapshotRecord[], current: readonly ProviderSnapshotRecord[]): boolean;
export {};
//# sourceMappingURL=provider-snapshot-manager.d.ts.map