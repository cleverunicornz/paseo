import { randomUUID } from "node:crypto";
import { basename } from "node:path";
import { resolveRepositoryDefaultBranch } from "../../../utils/checkout-git.js";
import { createRealpathAwarePathMatcher } from "../../../utils/path.js";
import { runGitCommand } from "../../../utils/run-git-command.js";
import { createWorktree, isPaseoOwnedWorktreeCwd, mapWorkspaceCwdToWorktree, rollbackCreatedPaseoWorktree, } from "../../../utils/worktree.js";
import { WorktreeRequestError, toWorktreeRequestError } from "../../worktree-errors.js";
import { resolveWorkspaceDisplayName, } from "../../workspace-registry.js";
export function createWorkspaceRecoveryService(deps) {
    async function resolveRecovery(workspaceId) {
        const workspace = await deps.getWorkspace(workspaceId);
        if (!workspace) {
            return {
                kind: "unavailable",
                workspaceId,
                reason: "workspace_not_found",
                message: "This workspace is no longer known to the host.",
            };
        }
        if (!workspace.archivedAt) {
            return {
                kind: "unavailable",
                workspaceId,
                reason: "workspace_not_archived",
                message: "This workspace is not archived, but it is unavailable from the host.",
            };
        }
        const project = await deps.getProject(workspace.projectId);
        if (!project) {
            return {
                kind: "unavailable",
                workspaceId,
                reason: "project_not_found",
                message: "The project for this archived workspace no longer exists.",
            };
        }
        if (await deps.isDirectory(workspace.cwd)) {
            return createRecoveryPlan({ action: "unarchive", workspace });
        }
        if (workspace.kind !== "worktree") {
            return {
                kind: "unavailable",
                workspaceId,
                reason: "workspace_directory_missing",
                message: "The archived workspace directory no longer exists and cannot be recreated.",
            };
        }
        // COMPAT(worktreeRestoreMissingMainRepoRoot): records created before v0.1.110
        // lack placement ownership; remove the project-root fallback after 2027-01-17.
        const sourceRepoRoot = workspace.mainRepoRoot ?? project.rootPath;
        if (!(await deps.isDirectory(sourceRepoRoot))) {
            return {
                kind: "unavailable",
                workspaceId,
                reason: "project_directory_missing",
                message: "The source repository needed to restore this worktree no longer exists.",
            };
        }
        return createRecoveryPlan({ action: "restore", workspace, sourceRepoRoot });
    }
    async function inspect(workspaceId) {
        const resolved = await resolveRecovery(workspaceId);
        return resolved.kind === "unavailable" ? resolved : resolved.state;
    }
    async function restore(workspaceId) {
        const resolved = await resolveRecovery(workspaceId);
        if (resolved.kind === "unavailable") {
            throw new Error(resolved.message);
        }
        if (resolved.kind === "restore") {
            await recreateArchivedWorktree(resolved.workspace, resolved.sourceRepoRoot);
        }
        await deps.unarchiveWorkspace(resolved.workspace);
        return { workspaceId, action: resolved.kind };
    }
    async function recreateArchivedWorktree(workspace, sourceRepoRoot) {
        const source = workspace.branch
            ? { kind: "restore", branchName: workspace.branch, baseRef: workspace.baseBranch }
            : {
                kind: "restore-from-base",
                branchName: `restored/${randomUUID().slice(0, 8)}`,
                baseRef: await resolveRecoveryBase(sourceRepoRoot, workspace.baseBranch),
            };
        try {
            await runGitCommand(["worktree", "prune"], { cwd: sourceRepoRoot, timeout: 30000 });
        }
        catch {
            // A stale worktree registration is not guaranteed; creation reports any real conflict.
        }
        let previousWorktreePath = workspace.worktreeRoot;
        if (!previousWorktreePath) {
            // COMPAT(worktreeRestoreMissingWorktreeRoot): records created before v0.1.110
            // lack durable backing placement; remove filesystem discovery after 2027-01-17.
            const ownership = await isPaseoOwnedWorktreeCwd(workspace.cwd, {
                paseoHome: deps.paseoHome,
                worktreesRoot: deps.worktreesRoot,
            });
            previousWorktreePath = ownership.allowed
                ? (ownership.worktreePath ?? workspace.cwd)
                : workspace.cwd;
        }
        let recreatedWorktreePath;
        try {
            const result = await createWorktree({
                cwd: sourceRepoRoot,
                worktreeSlug: basename(previousWorktreePath),
                source,
                runSetup: false,
                paseoHome: deps.paseoHome,
                worktreesRoot: deps.worktreesRoot,
            });
            recreatedWorktreePath = result.worktreePath;
        }
        catch (error) {
            throw toWorktreeRequestError(error);
        }
        try {
            const recreatedWorkspacePath = mapWorkspaceCwdToWorktree({
                sourceWorktreePath: previousWorktreePath,
                workspaceCwd: workspace.cwd,
                targetWorktreePath: recreatedWorktreePath,
            });
            if (!createRealpathAwarePathMatcher(workspace.cwd)(recreatedWorkspacePath)) {
                throw new WorktreeRequestError({
                    code: "unknown",
                    message: `Recreated worktree diverged from ${workspace.cwd}: ${recreatedWorkspacePath}`,
                });
            }
            if (!(await deps.isDirectory(recreatedWorkspacePath))) {
                throw new WorktreeRequestError({
                    code: "unknown",
                    message: `Selected project directory is missing from the restored worktree: ${recreatedWorkspacePath}`,
                });
            }
        }
        catch (error) {
            return rollbackCreatedPaseoWorktree({
                cwd: sourceRepoRoot,
                worktreePath: recreatedWorktreePath,
                teardownCwds: [],
                paseoHome: deps.paseoHome,
                worktreesBaseRoot: deps.worktreesRoot,
            }, error);
        }
    }
    return { inspect, restore };
}
async function resolveRecoveryBase(repoRoot, recordedBase) {
    if (recordedBase) {
        try {
            await runGitCommand(["rev-parse", "--verify", `${recordedBase}^{commit}`], { cwd: repoRoot });
            return recordedBase;
        }
        catch {
            // The saved base was removed; use the repository default for continued work.
        }
    }
    const defaultBranch = await resolveRepositoryDefaultBranch(repoRoot);
    if (!defaultBranch) {
        throw new WorktreeRequestError({
            code: "unknown",
            message: "The saved base is unavailable and the repository has no default branch to restore from.",
        });
    }
    return defaultBranch;
}
function createRecoveryPlan(input) {
    const state = {
        kind: "recoverable",
        workspaceId: input.workspace.workspaceId,
        workspaceName: resolveWorkspaceDisplayName(input.workspace),
        branch: input.workspace.branch,
    };
    if (input.action === "restore") {
        return {
            kind: input.action,
            state: { ...state, action: input.action },
            workspace: input.workspace,
            sourceRepoRoot: input.sourceRepoRoot,
        };
    }
    return {
        kind: input.action,
        state: {
            ...state,
            action: input.action,
        },
        workspace: input.workspace,
    };
}
//# sourceMappingURL=workspace-recovery-service.js.map