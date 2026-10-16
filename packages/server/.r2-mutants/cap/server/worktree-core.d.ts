import type { ForgeService } from "../services/forge-service.js";
import { type CreatedWorktree } from "../utils/worktree.js";
import { type WorktreeCreationIntent } from "./resolve-worktree-creation-intent.js";
import type { ChangeRequestCheckoutSource, FirstAgentContext } from "@getpaseo/protocol/messages";
import type { WorkspaceGitService } from "./workspace-git-service.js";
export interface CreateWorktreeCoreInput {
    cwd: string;
    worktreeSlug?: string;
    branchName?: string;
    refName?: string;
    action?: "branch-off" | "checkout";
    checkoutSource?: ChangeRequestCheckoutSource;
    githubPrNumber?: number;
    firstAgentContext?: FirstAgentContext;
    paseoHome?: string;
    worktreesRoot?: string;
    runSetup?: boolean;
}
export interface CreateWorktreeCoreDeps {
    github: ForgeService;
    workspaceGitService?: Pick<WorkspaceGitService, "resolveRepoRoot" | "resolveDefaultBranch" | "resolveForge">;
    resolveDefaultBranch?: (repoRoot: string) => Promise<string>;
}
export interface CreateWorktreeCoreResult {
    worktree: CreatedWorktree;
    intent: WorktreeCreationIntent;
    repoRoot: string;
    created: boolean;
}
export declare function createWorktreeCore(input: CreateWorktreeCoreInput, deps: CreateWorktreeCoreDeps): Promise<CreateWorktreeCoreResult>;
export declare function resolveWorktreeRepoRoot(input: Pick<CreateWorktreeCoreInput, "cwd" | "paseoHome">, workspaceGitService?: Pick<WorkspaceGitService, "resolveRepoRoot">): Promise<string>;
//# sourceMappingURL=worktree-core.d.ts.map