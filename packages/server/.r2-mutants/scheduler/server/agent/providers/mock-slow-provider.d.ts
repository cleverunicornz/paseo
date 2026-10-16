import type { AgentCapabilityFlags, AgentClient, AgentLaunchContext, AgentPersistenceHandle, AgentProvider, AgentSession, AgentSessionConfig, FetchCatalogOptions, ProviderRefreshContext, ProviderCatalog } from "../agent-sdk-types.js";
export declare const MOCK_SLOW_PROVIDER_ID = "mock-slow";
export declare class MockSlowProviderClient implements AgentClient {
    readonly provider: AgentProvider;
    readonly capabilities: AgentCapabilityFlags;
    isAvailable(): Promise<boolean>;
    fetchCatalog(_options: FetchCatalogOptions, context?: ProviderRefreshContext): Promise<ProviderCatalog>;
    getDiagnostic(): Promise<{
        diagnostic: string;
    }>;
    createSession(_config: AgentSessionConfig, _launchContext?: AgentLaunchContext): Promise<AgentSession>;
    resumeSession(_handle: AgentPersistenceHandle, _overrides?: Partial<AgentSessionConfig>, _launchContext?: AgentLaunchContext): Promise<AgentSession>;
}
//# sourceMappingURL=mock-slow-provider.d.ts.map