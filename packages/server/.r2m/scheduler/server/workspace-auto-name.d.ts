import type pino from "pino";
import type { FirstAgentContext } from "@getpaseo/protocol/messages";
import type { AgentManager } from "./agent/agent-manager.js";
import type { ProviderSnapshotManager } from "./agent/provider-snapshot-manager.js";
import type { StructuredGenerationDaemonConfig } from "./agent/structured-generation-providers.js";
import type { GitMutationService } from "./session/git-mutation/git-mutation-service.js";
import type { WorkspaceGitService } from "./workspace-git-service.js";
import type { PersistedWorkspaceRecord, WorkspaceRegistry } from "./workspace-registry.js";
import { generateBranchNameFromFirstAgentContext, type GenerateBranchNameFromFirstAgentContextOptions } from "./worktree-branch-name-generator.js";
type WorkspaceNameGenerator = typeof generateBranchNameFromFirstAgentContext;
type CurrentSelection = GenerateBranchNameFromFirstAgentContextOptions["currentSelection"] | null;
interface WorkspaceAutoNameOptions {
    agentManager: AgentManager;
    workspaceRegistry: Pick<WorkspaceRegistry, "update">;
    workspaceGitService: WorkspaceGitService;
    providerSnapshotManager: ProviderSnapshotManager;
    readDaemonConfig: () => StructuredGenerationDaemonConfig;
    gitMutation: Pick<GitMutationService, "notifyGitMutation">;
    emitWorkspaceUpdateForCwd: (cwd: string) => Promise<void>;
    emitWorkspaceUpdateForWorkspaceId: (workspaceId: string) => Promise<void>;
    logger: pino.Logger;
    generateWorkspaceName?: WorkspaceNameGenerator;
}
interface ScheduleContext {
    currentSelection?: CurrentSelection;
}
export declare class WorkspaceAutoName {
    private readonly agentManager;
    private readonly workspaceRegistry;
    private readonly workspaceGitService;
    private readonly providerSnapshotManager;
    private readonly readDaemonConfig;
    private readonly gitMutation;
    private readonly emitWorkspaceUpdateForCwd;
    private readonly emitWorkspaceUpdateForWorkspaceId;
    private readonly logger;
    private readonly generateWorkspaceName;
    constructor(options: WorkspaceAutoNameOptions);
    scheduleForWorktree(input: {
        workspace: PersistedWorkspaceRecord;
        firstAgentContext: FirstAgentContext;
    }, context?: ScheduleContext): void;
    scheduleForDirectory(input: {
        workspaceId: string;
        cwd: string;
        firstAgentContext: FirstAgentContext;
    }, context?: ScheduleContext): void;
    private maybeAutoNameWorkspaceBranchForFirstAgent;
    private maybeAutoNameDirectoryWorkspaceTitle;
    private applyGeneratedWorkspaceTitle;
    private generateFromContext;
    private schedule;
}
export {};
//# sourceMappingURL=workspace-auto-name.d.ts.map