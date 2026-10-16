import type { Logger } from "pino";
import type { AgentStorage } from "../agent/agent-storage.js";
import type { WorkspaceRegistry } from "../workspace-registry.js";
export declare function backfillWorkspaceIdForLegacyAgents(options: {
    agentStorage: AgentStorage;
    workspaceRegistry: WorkspaceRegistry;
    logger: Logger;
}): Promise<number>;
//# sourceMappingURL=backfill-workspace-id.migration.d.ts.map