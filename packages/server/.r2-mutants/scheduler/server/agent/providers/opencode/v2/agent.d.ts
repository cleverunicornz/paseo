import type { Logger } from "pino";
import type { AgentCapabilityFlags, AgentClient, AgentCreateSessionOptions, AgentFeature, AgentLaunchContext, AgentPersistenceHandle, AgentSession, AgentSessionConfig, FetchCatalogOptions, ImportableProviderSession, ImportProviderSessionInput, ImportProviderSessionContext, ListImportableSessionsOptions, ProviderRefreshContext } from "../../../agent-sdk-types.js";
import { type ProviderRuntimeSettings } from "../../../provider-launch-config.js";
import type { ManagedProcessRegistry } from "../../../../managed-processes/managed-processes.js";
import type { OpenCodeBridge } from "../bridge.js";
import { V2Runtime } from "./runtime.js";
interface V2AgentOptions {
    logger: Logger;
    settings?: ProviderRuntimeSettings;
    managedProcesses?: ManagedProcessRegistry;
    bridge?: OpenCodeBridge;
    runtime?: Pick<V2Runtime, "acquire" | "shutdown">;
}
export declare class OpenCodeV2AgentClient implements AgentClient {
    private readonly options;
    readonly provider = "opencode";
    readonly capabilities: AgentCapabilityFlags;
    private readonly runtime;
    private readonly connections;
    constructor(options: V2AgentOptions);
    isAvailable(): Promise<boolean>;
    shutdown(): Promise<void>;
    fetchCatalog(options: FetchCatalogOptions, context?: ProviderRefreshContext): Promise<{
        models: import("../../../agent-sdk-types.js").AgentModelDefinition[];
        modes: import("../../../agent-sdk-types.js").AgentMode[];
    }>;
    createSession(config: AgentSessionConfig, launch?: AgentLaunchContext, options?: AgentCreateSessionOptions): Promise<AgentSession>;
    resumeSession(handle: AgentPersistenceHandle, overrides?: Partial<AgentSessionConfig>, launch?: AgentLaunchContext): Promise<AgentSession>;
    private attach;
    listFeatures(config: AgentSessionConfig): Promise<AgentFeature[]>;
    listCommands(config: AgentSessionConfig): Promise<import("../../../agent-sdk-types.js").AgentSlashCommand[]>;
    listImportableSessions(options?: ListImportableSessionsOptions): Promise<ImportableProviderSession[]>;
    importSession(input: ImportProviderSessionInput, context: ImportProviderSessionContext): Promise<import("../../../agent-sdk-types.js").ImportedProviderSession>;
}
export {};
//# sourceMappingURL=agent.d.ts.map