import type { FirstAgentContext } from "@getpaseo/protocol/messages";
import type { AgentManager } from "./agent/agent-manager.js";
import { generateStructuredAgentResponseWithFallback } from "./agent/agent-response-loop.js";
import { type StructuredGenerationDaemonConfig } from "./agent/structured-generation-providers.js";
import type { WorkspaceGitService } from "./workspace-git-service.js";
import type { ProviderSnapshotManager } from "./agent/provider-snapshot-manager.js";
interface BranchNameGeneratorLogger {
    info: (obj: object, msg?: string) => void;
    warn: (obj: object, msg?: string) => void;
    error: (obj: object, msg?: string) => void;
}
export interface GenerateBranchNameFromFirstAgentContextOptions {
    agentManager: AgentManager;
    cwd: string;
    workspaceGitService?: Pick<WorkspaceGitService, "resolveRepoRoot">;
    providerSnapshotManager?: Pick<ProviderSnapshotManager, "listProviders">;
    daemonConfig?: StructuredGenerationDaemonConfig | null;
    currentSelection?: {
        provider?: string | null;
        model?: string | null;
        thinkingOptionId?: string | null;
    };
    firstAgentContext: FirstAgentContext | undefined;
    logger: BranchNameGeneratorLogger;
    deps?: {
        generateStructuredAgentResponseWithFallback?: typeof generateStructuredAgentResponseWithFallback;
    };
}
export interface GeneratedWorkspaceName {
    title: string | null;
    branch: string | null;
}
export declare function generateBranchNameFromFirstAgentContext(options: GenerateBranchNameFromFirstAgentContextOptions): Promise<GeneratedWorkspaceName | null>;
export {};
//# sourceMappingURL=worktree-branch-name-generator.d.ts.map