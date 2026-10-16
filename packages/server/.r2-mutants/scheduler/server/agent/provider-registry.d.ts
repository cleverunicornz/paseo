import type { Logger } from "pino";
import type { ProviderOptions, ToolPolicy } from "@getpaseo/protocol/agent-types";
import type { AgentClient, AgentCreateConfigUnattendedInput, AgentProvider, AgentSession, FetchCatalogOptions, ProviderRefreshContext, ProviderCatalog, ResolveAgentCreateConfigInput, ResolveAgentCreateConfigResult, AgentSessionConfig } from "./agent-sdk-types.js";
import type { WorkspaceGitService } from "../workspace-git-service.js";
import type { ManagedProcessRegistry } from "../managed-processes/managed-processes.js";
import type { AgentProviderRuntimeSettingsMap, ProviderOverride, ProviderProfileModel, ProviderRuntimeSettings } from "./provider-launch-config.js";
import type { OpenCodeBridge } from "./providers/opencode/bridge.js";
import type { OmpRuntime } from "./providers/omp/runtime.js";
import { AGENT_PROVIDER_DEFINITIONS, getAgentProviderDefinition, type AgentProviderDefinition } from "@getpaseo/protocol/provider-manifest";
export type { AgentProviderDefinition };
export { AGENT_PROVIDER_DEFINITIONS, getAgentProviderDefinition };
export interface ProviderDefinition extends AgentProviderDefinition {
    /** Effective inputs after overrides and inheritance; plugin registrations are owned separately. */
    configuration: Omit<ResolvedProvider, "createBaseClient" | "contract"> | null;
    iconSvg?: string;
    enabled: boolean;
    /**
     * The id of another *registered* provider this one extends (e.g. a Z.AI
     * profile that extends "claude"). null for built-in providers and for
     * generic ACP providers (which only extend the literal "acp" sentinel).
     */
    derivedFromProviderId: string | null;
    supportsExactMcpPreapproval: boolean;
    applyToolPolicy: (config: AgentSessionConfig, toolPolicy: ToolPolicy | undefined) => AgentSessionConfig;
    createClient: (logger: Logger) => AgentClient;
    resolveCreateConfig: (input: ResolveAgentCreateConfigInput) => ResolveAgentCreateConfigResult;
    isCreateConfigUnattended: (input: AgentCreateConfigUnattendedInput) => boolean;
    /**
     * Single catalog discovery call used by ProviderSnapshotManager. Should spawn
     * at most one provider runtime process and return both models and modes.
     */
    fetchCatalog: (options: FetchCatalogOptions, client?: AgentClient, context?: ProviderRefreshContext) => Promise<ProviderCatalog>;
}
/** Provider metadata and an unconfigured factory; the registry owns override application. */
export interface RegisteredProviderDefinition extends AgentProviderDefinition {
    iconSvg?: string;
    supportsExactMcpPreapproval: boolean;
    createClient: (logger: Logger, runtimeSettings?: ProviderRuntimeSettings) => AgentClient;
}
export interface BuildProviderRegistryOptions {
    pluginProviders?: Record<string, RegisteredProviderDefinition>;
    runtimeSettings?: AgentProviderRuntimeSettingsMap;
    providerOverrides?: Record<string, ProviderOverride>;
    workspaceGitService?: Pick<WorkspaceGitService, "resolveRepoRoot">;
    managedProcesses?: ManagedProcessRegistry;
    isDev?: boolean;
    ompRuntime?: OmpRuntime;
    openCodeBridge?: OpenCodeBridge;
}
interface ResolvedProvider {
    definition: AgentProviderDefinition;
    runtimeSettings?: ProviderRuntimeSettings;
    profileModels: ProviderProfileModel[];
    additionalModels: ProviderProfileModel[];
    profileModelsAreAdditive: boolean;
    enabled: boolean;
    derivedFromProviderId: string | null;
    providerOptions?: ProviderOptions;
    createBaseClient: (logger: Logger) => AgentClient;
    contract: ProviderContract;
}
interface ProviderContract {
    supportsExactMcpPreapproval: boolean;
    applyToolPolicy?: (provider: string, toolPolicy: ToolPolicy) => ToolPolicy;
}
export declare function wrapSessionProvider(provider: AgentProvider, inner: AgentSession): AgentSession;
export declare function buildProviderRegistry(logger: Logger, options?: BuildProviderRegistryOptions): Record<AgentProvider, ProviderDefinition>;
export declare function getProviderIds(registry: Record<AgentProvider, ProviderDefinition>): AgentProvider[];
export declare const PROVIDER_REGISTRY: Record<AgentProvider, ProviderDefinition>;
export declare function createAllClients(logger: Logger, options?: BuildProviderRegistryOptions): Record<AgentProvider, AgentClient>;
export declare function createClientsFromRegistry(registry: Record<AgentProvider, ProviderDefinition>, logger: Logger): Record<AgentProvider, AgentClient>;
export declare function shutdownProviders(logger: Logger, options?: BuildProviderRegistryOptions): Promise<void>;
export declare function shutdownAgentClients(clients: Iterable<AgentClient>, logger: Logger): Promise<void>;
//# sourceMappingURL=provider-registry.d.ts.map