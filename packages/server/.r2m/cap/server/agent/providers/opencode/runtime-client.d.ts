import type { Logger } from "pino";
import type { AgentClient, AgentSessionConfig, AgentLaunchContext, AgentCreateSessionOptions, AgentPersistenceHandle, FetchCatalogOptions, ProviderRefreshContext, ListImportableSessionsOptions, ImportProviderSessionInput, ImportProviderSessionContext } from "../../agent-sdk-types.js";
import { type ProviderRuntimeSettings } from "../../provider-launch-config.js";
import { OpenCodeAgentClient } from "../opencode-agent.js";
export declare function openCodeMajorVersion(output: string): 1 | 2;
export type OpenCodeRuntimeClientOptions = NonNullable<ConstructorParameters<typeof OpenCodeAgentClient>[2]>;
export declare class OpenCodeRuntimeClient implements AgentClient {
    private readonly logger;
    private readonly settings?;
    private readonly options;
    readonly provider = "opencode";
    readonly capabilities: import("../../agent-sdk-types.js").AgentCapabilityFlags;
    readonly resolveCreateConfig: (input: import("../../agent-sdk-types.js").ResolveAgentCreateConfigInput) => import("../../agent-sdk-types.js").ResolveAgentCreateConfigResult;
    readonly isCreateConfigUnattended: (input: Parameters<typeof import("../../create-agent-mode.js").isDefaultAgentCreateConfigUnattended>[0]) => boolean;
    private selected;
    private legacySelected;
    private readonly legacy;
    constructor(logger: Logger, settings?: ProviderRuntimeSettings | undefined, options?: OpenCodeRuntimeClientOptions);
    private client;
    isAvailable(): Promise<boolean>;
    getDiagnostic(): Promise<{
        diagnostic: string;
    }>;
    createSession(config: AgentSessionConfig, launch?: AgentLaunchContext, options?: AgentCreateSessionOptions): Promise<import("../../agent-sdk-types.js").AgentSession>;
    resumeSession(handle: AgentPersistenceHandle, config?: Partial<AgentSessionConfig>, launch?: AgentLaunchContext): Promise<import("../../agent-sdk-types.js").AgentSession>;
    fetchCatalog(options: FetchCatalogOptions, context?: ProviderRefreshContext): Promise<{
        models: import("../../agent-sdk-types.js").AgentModelDefinition[];
        modes: import("../../agent-sdk-types.js").AgentMode[];
    }>;
    listCommands(config: AgentSessionConfig): Promise<import("../../agent-sdk-types.js").AgentSlashCommand[]>;
    listFeatures(config: AgentSessionConfig): Promise<import("@getpaseo/protocol/agent-types").AgentFeature[]>;
    listImportableSessions(options?: ListImportableSessionsOptions): Promise<import("../../agent-sdk-types.js").ImportableProviderSession[]>;
    importSession(input: ImportProviderSessionInput, context: ImportProviderSessionContext): Promise<import("../../agent-sdk-types.js").ImportedProviderSession>;
    archiveNativeSession(handle: AgentPersistenceHandle): Promise<void>;
    unarchiveNativeSession(handle: AgentPersistenceHandle): Promise<void>;
    shutdown(): Promise<void>;
}
//# sourceMappingURL=runtime-client.d.ts.map