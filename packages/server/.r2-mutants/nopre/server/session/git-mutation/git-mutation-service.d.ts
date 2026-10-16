import type pino from "pino";
import { type CheckoutExistingBranchResult, type GitMutationRefreshReason } from "../../../utils/checkout-git.js";
import type { WorkspaceGitService } from "../../workspace-git-service.js";
/**
 * The git branch / working-tree mutation primitives a client session performs on a
 * workspace: switch to an existing branch, create a branch from a base, and force a
 * snapshot refresh (plus optional forge cache invalidation) after any mutation.
 *
 * CheckoutSession (the branch/commit/merge commands), the worktree session-config
 * builder, and the auto-naming + worktree-creation paths all funnel their git
 * mutations through this one module, so the validate-ref → clean-tree → execute →
 * refresh sequence lives in a single place instead of being smeared across the
 * session as loose callbacks.
 */
export interface GitMutationService {
    checkoutExistingBranch(cwd: string, branch: string): Promise<CheckoutExistingBranchResult>;
    createBranchFromBase(params: {
        cwd: string;
        baseBranch: string;
        newBranchName: string;
    }): Promise<void>;
    notifyGitMutation(cwd: string, reason: GitMutationRefreshReason, options?: {
        invalidateForge?: boolean;
    }): Promise<void>;
}
type GitMutationGitSource = Pick<WorkspaceGitService, "validateBranchRef" | "getSnapshot" | "hasLocalBranch" | "invalidateForge">;
export declare function createGitMutationService(deps: {
    workspaceGitService: GitMutationGitSource;
    logger: pino.Logger;
}): GitMutationService;
export {};
//# sourceMappingURL=git-mutation-service.d.ts.map