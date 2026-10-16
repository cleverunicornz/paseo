import { randomBytes } from "node:crypto";
export function generateWorkspaceId() {
    return `wks_${randomBytes(8).toString("hex")}`;
}
export function generateProjectId() {
    return `prj_${randomBytes(8).toString("hex")}`;
}
export function deriveProjectKind(checkout) {
    return checkout.isGit ? "git" : "non_git";
}
export function deriveWorkspaceKind(checkout) {
    if (!checkout.isGit) {
        return "directory";
    }
    return checkout.mainRepoRoot ? "worktree" : "local_checkout";
}
export function deriveWorkspaceDisplayName(input) {
    const branch = input.checkout.currentBranch?.trim() ?? null;
    if (branch && branch.toUpperCase() !== "HEAD")
        return branch;
    const segments = input.cwd.replace(/\\/g, "/").split("/").filter(Boolean);
    return segments[segments.length - 1] ?? input.cwd;
}
/** Defines the complete persisted placement for every new workspace. */
export function initialWorkspacePlacement(input) {
    if (input.source === "created_worktree") {
        return {
            cwd: input.cwd,
            kind: "worktree",
            displayName: input.branch || input.cwd,
            branch: input.branch,
            worktreeRoot: input.worktreeRoot,
            baseBranch: input.baseBranch,
            isPaseoOwnedWorktree: true,
            mainRepoRoot: input.mainRepoRoot,
        };
    }
    const branch = normalizeBranch(input.checkout.currentBranch);
    return {
        cwd: input.cwd,
        kind: deriveWorkspaceKind(input.checkout),
        displayName: deriveWorkspaceDisplayName(input),
        branch,
        worktreeRoot: input.checkout.isGit ? (input.checkout.worktreeRoot ?? input.cwd) : null,
        baseBranch: null,
        isPaseoOwnedWorktree: input.checkout.isGit && input.checkout.isPaseoOwnedWorktree,
        mainRepoRoot: input.checkout.isGit ? input.checkout.mainRepoRoot : null,
    };
}
/**
 * Applies live placement facts without rewriting the workspace's durable name
 * or its creation-time base branch.
 *
 * A null checkout is an absence, not an observation: nothing was read at the
 * workspace directory, so the recorded placement stands. Only a directory that
 * is there can show that a worktree stopped being one.
 */
export function reconcileWorkspacePlacement(input) {
    if (!input.checkout)
        return null;
    const observed = initialWorkspacePlacement({
        source: "checkout",
        cwd: input.workspace.cwd,
        checkout: input.checkout,
    });
    const fields = {};
    if (input.workspace.kind !== observed.kind)
        fields.kind = observed.kind;
    if (input.workspace.branch !== observed.branch)
        fields.branch = observed.branch;
    if (input.workspace.worktreeRoot !== observed.worktreeRoot)
        fields.worktreeRoot = observed.worktreeRoot;
    if (input.workspace.isPaseoOwnedWorktree !== observed.isPaseoOwnedWorktree)
        fields.isPaseoOwnedWorktree = observed.isPaseoOwnedWorktree;
    if (input.workspace.mainRepoRoot !== observed.mainRepoRoot)
        fields.mainRepoRoot = observed.mainRepoRoot;
    if (Object.keys(fields).length === 0)
        return null;
    return {
        workspace: { ...input.workspace, ...fields, updatedAt: input.updatedAt },
        fields,
    };
}
/** Projects persisted placement onto the checkout shape sent over the wire. */
export function checkoutFromPersistedWorkspacePlacement(input) {
    const { workspace } = input;
    if (workspace.kind === "directory") {
        return {
            cwd: workspace.cwd,
            isGit: false,
            currentBranch: null,
            remoteUrl: null,
            worktreeRoot: null,
            isPaseoOwnedWorktree: false,
            mainRepoRoot: null,
        };
    }
    const checkout = {
        cwd: workspace.cwd,
        currentBranch: workspace.branch ?? input.fallbackBranch ?? null,
        remoteUrl: null,
        worktreeRoot: workspace.worktreeRoot ?? input.fallbackWorktreeRoot ?? workspace.cwd,
    };
    if (workspace.isPaseoOwnedWorktree && workspace.mainRepoRoot) {
        return {
            ...checkout,
            isGit: true,
            isPaseoOwnedWorktree: true,
            mainRepoRoot: workspace.mainRepoRoot,
        };
    }
    return {
        ...checkout,
        isGit: true,
        isPaseoOwnedWorktree: false,
        mainRepoRoot: workspace.mainRepoRoot ?? null,
    };
}
function normalizeBranch(branch) {
    const normalized = branch?.trim() ?? null;
    return normalized && normalized.toUpperCase() !== "HEAD" ? normalized : null;
}
export function checkoutLiteFromGitSnapshot(cwd, git) {
    if (!git.isGit) {
        return {
            cwd,
            isGit: false,
            currentBranch: null,
            remoteUrl: null,
            worktreeRoot: null,
            isPaseoOwnedWorktree: false,
            mainRepoRoot: null,
        };
    }
    if (git.isPaseoOwnedWorktree && git.mainRepoRoot) {
        return {
            cwd,
            isGit: true,
            currentBranch: git.currentBranch,
            remoteUrl: git.remoteUrl,
            worktreeRoot: git.repoRoot ?? cwd,
            isPaseoOwnedWorktree: true,
            mainRepoRoot: git.mainRepoRoot,
        };
    }
    return {
        cwd,
        isGit: true,
        currentBranch: git.currentBranch,
        remoteUrl: git.remoteUrl,
        worktreeRoot: git.repoRoot ?? cwd,
        isPaseoOwnedWorktree: false,
        mainRepoRoot: git.mainRepoRoot,
    };
}
//# sourceMappingURL=workspace-registry-model.js.map