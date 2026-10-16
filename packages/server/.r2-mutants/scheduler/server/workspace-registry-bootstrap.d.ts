import type { Logger } from "pino";
import type { AgentStorage } from "./agent/agent-storage.js";
import type { WorkspaceGitService } from "./workspace-git-service.js";
import { type ProjectRegistry, type WorkspaceRegistry } from "./workspace-registry.js";
export declare function bootstrapWorkspaceRegistries(options: {
    serverId?: string;
    paseoHome: string;
    agentStorage: AgentStorage;
    projectRegistry: ProjectRegistry;
    workspaceRegistry: WorkspaceRegistry;
    workspaceGitService: WorkspaceGitService;
    logger: Logger;
}): Promise<void>;
//# sourceMappingURL=workspace-registry-bootstrap.d.ts.map