import type { Logger } from "pino";
import type { AgentProvider } from "./agent-sdk-types.js";
import type { AgentManager, ManagedAgent } from "./agent-manager.js";
import type { AgentStorage } from "./agent-storage.js";
export type AgentLoaderManager = Pick<AgentManager, "createAgent" | "getAgent" | "getRegisteredProviderIds" | "hydrateTimelineFromProvider" | "resumeAgentFromPersistence"> & Partial<Pick<AgentManager, "waitForAgentClose">>;
export interface EnsureAgentLoadedDeps {
    agentManager: AgentLoaderManager;
    agentStorage: AgentStorage;
    validProviders?: Iterable<AgentProvider>;
    broadcastTimeline?: boolean;
    logger: Logger;
}
export declare function ensureUnarchivedAgentLoaded(agentId: string, deps: EnsureAgentLoadedDeps & {
    agentManager: AgentLoaderManager & Pick<AgentManager, "closeAgent">;
}): Promise<ManagedAgent>;
export declare function ensureAgentLoaded(agentId: string, deps: EnsureAgentLoadedDeps): Promise<ManagedAgent>;
//# sourceMappingURL=agent-loading.d.ts.map