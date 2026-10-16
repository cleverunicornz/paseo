import type { WorkspaceGitService } from "./workspace-git-service.js";
import type { PersistedWorkspaceRecord } from "./workspace-registry.js";
import type { WorkspaceProvisioningService } from "./session/workspace-provisioning/workspace-provisioning-service.js";
import { type CreateWorktreeCoreDeps, type CreateWorktreeCoreInput } from "./worktree-core.js";
import { type WorktreeConfig } from "../utils/worktree.js";
import { getCurrentBranch, localBranchExists, renameCurrentBranch } from "../utils/checkout-git.js";
import type { WorktreeCreationIntent } from "./resolve-worktree-creation-intent.js";
import type { FirstAgentContext } from "@getpaseo/protocol/messages";
export interface CreatePaseoWorktreeInput extends CreateWorktreeCoreInput {
    workspaceId?: string;
    projectId?: string;
    title?: string;
}
export interface CreatePaseoWorktreeResult {
    worktree: WorktreeConfig;
    intent: WorktreeCreationIntent;
    workspace: PersistedWorkspaceRecord;
    repoRoot: string;
    created: boolean;
}
export type CreatePaseoWorktreeFn = (input: CreatePaseoWorktreeInput, options?: {
    resolveDefaultBranch?: (repoRoot: string) => Promise<string>;
}) => Promise<CreatePaseoWorktreeResult>;
export interface AttemptFirstAgentBranchAutoNameResult {
    attempted: boolean;
    renamed: boolean;
    branchName: string | null;
}
export interface CreatePaseoWorktreeDeps extends CreateWorktreeCoreDeps {
    workspaceGitService: WorkspaceGitService;
    workspaceProvisioning: Pick<WorkspaceProvisioningService, "createWorkspaceForWorktree">;
}
export declare function createPaseoWorktree(input: CreatePaseoWorktreeInput, deps: CreatePaseoWorktreeDeps): Promise<CreatePaseoWorktreeResult>;
export declare function attemptFirstAgentBranchAutoName(options: {
    cwd: string;
    firstAgentContext: FirstAgentContext | undefined;
    generateBranchNameFromContext: (input: {
        cwd: string;
        firstAgentContext: FirstAgentContext;
    }) => Promise<string | null>;
    getCurrentBranch?: typeof getCurrentBranch;
    renameCurrentBranch?: typeof renameCurrentBranch;
    localBranchExists?: typeof localBranchExists;
}): Promise<AttemptFirstAgentBranchAutoNameResult>;
//# sourceMappingURL=paseo-worktree-service.d.ts.map