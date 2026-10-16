import type { AgentClient, AgentPersistenceHandle, AgentProvider, AgentSessionConfig, ImportedProviderSession, ImportProviderSessionContext, ImportProviderSessionInput } from "./agent-sdk-types.js";
export declare function importSessionFromPersistence(input: {
    provider: AgentProvider;
    request: ImportProviderSessionInput;
    context: ImportProviderSessionContext;
    resumeSession: AgentClient["resumeSession"];
    config?: Partial<AgentSessionConfig>;
    persistence?: AgentPersistenceHandle;
}): Promise<ImportedProviderSession>;
//# sourceMappingURL=provider-session-import.d.ts.map