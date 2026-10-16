import { getErrorMessage } from "@getpaseo/protocol/error-utils";
import { checkoutResolvedBranch, } from "../../../utils/checkout-git.js";
import { runGitCommand } from "../../../utils/run-git-command.js";
import { assertSafeGitRef as assertWorktreeSafeGitRef } from "../../worktree-session.js";
export function createGitMutationService(deps) {
    const { workspaceGitService, logger } = deps;
    function assertSafeGitRef(ref, label) {
        if (!/^[A-Za-z0-9._/-]+$/.test(ref)) {
            throw new Error(`Invalid ${label}: ${ref}`);
        }
        assertWorktreeSafeGitRef(ref, label);
    }
    async function isWorkingTreeDirty(cwd) {
        try {
            const snapshot = await workspaceGitService.getSnapshot(cwd);
            return snapshot.git.isDirty === true;
        }
        catch (error) {
            throw new Error(`Unable to inspect git status for ${cwd}: ${getErrorMessage(error)}`, {
                cause: error,
            });
        }
    }
    async function ensureCleanWorkingTree(cwd) {
        const dirty = await isWorkingTreeDirty(cwd);
        if (dirty) {
            throw new Error("Working directory has uncommitted changes. Commit or stash before switching branches.");
        }
    }
    async function notifyGitMutation(cwd, reason, options) {
        if (options?.invalidateForge) {
            workspaceGitService.invalidateForge(cwd);
        }
        try {
            await workspaceGitService.getSnapshot(cwd, { force: true, reason });
        }
        catch (error) {
            logger.warn({ err: error, cwd, reason }, "Failed to force-refresh workspace git snapshot after mutation");
        }
    }
    return {
        async checkoutExistingBranch(cwd, branch) {
            assertSafeGitRef(branch, "branch");
            const resolution = await workspaceGitService.validateBranchRef(cwd, branch);
            if (resolution.kind === "not-found") {
                throw new Error(`Branch not found: ${branch}`);
            }
            await ensureCleanWorkingTree(cwd);
            const result = await checkoutResolvedBranch({ cwd, resolution });
            await notifyGitMutation(cwd, "switch-branch", { invalidateForge: true });
            return result;
        },
        async createBranchFromBase({ cwd, baseBranch, newBranchName }) {
            assertSafeGitRef(baseBranch, "base branch");
            assertSafeGitRef(newBranchName, "new branch");
            const baseResolution = await workspaceGitService.validateBranchRef(cwd, baseBranch);
            if (baseResolution.kind === "not-found") {
                throw new Error(`Base branch not found: ${baseBranch}`);
            }
            const exists = await workspaceGitService.hasLocalBranch(cwd, newBranchName);
            if (exists) {
                throw new Error(`Branch already exists: ${newBranchName}`);
            }
            await ensureCleanWorkingTree(cwd);
            // --no-track: a branch we create is not a continuation of its base, so it gets no
            // upstream. Without it git hands the new branch `origin/<base>` whenever the base is a
            // remote-tracking ref or branch.autoSetupMerge asks for inheritance, and every later
            // push then reads that upstream and lands the work on the default branch. The worktree
            // path makes the same promise with `git worktree add -b <branch> --no-track <base>`.
            await runGitCommand(["checkout", "-b", newBranchName, "--no-track", baseBranch], {
                cwd,
                timeout: 120000,
            });
            await notifyGitMutation(cwd, "create-branch");
        },
        notifyGitMutation,
    };
}
//# sourceMappingURL=git-mutation-service.js.map