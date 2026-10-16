import { join } from "node:path";
import { getPaseoWorktreesRoot, isPaseoOwnedWorktreeCwd } from "../../utils/worktree.js";
import { archiveByScope, resolveWorkspaceIdAtPath, } from "../workspace-archive-service.js";
import { toWorktreeWireError } from "../worktree-errors.js";
export async function listPaseoWorktreesCommand(dependencies, input) {
    if (input.reason) {
        return dependencies.workspaceGitService.listWorktrees(input.cwd, { reason: input.reason });
    }
    return dependencies.workspaceGitService.listWorktrees(input.cwd);
}
export async function createPaseoWorktreeCommand(dependencies, input) {
    try {
        if (!dependencies.createPaseoWorktreeWorkflow) {
            throw new Error("Paseo worktree service is not configured");
        }
        const createdWorktree = await dependencies.createPaseoWorktreeWorkflow({
            ...input,
            runSetup: false,
            paseoHome: input.paseoHome ?? dependencies.paseoHome,
            worktreesRoot: input.worktreesRoot ?? dependencies.worktreesRoot,
        });
        return { ok: true, createdWorktree };
    }
    catch (error) {
        return {
            ok: false,
            error: toWorktreeWireError(error),
            cause: error,
        };
    }
}
export async function archiveCommand(dependencies, input) {
    const targetPath = await resolveArchiveTarget(dependencies, input);
    const scope = input.scope ?? "workspace";
    const ownership = await isPaseoOwnedWorktreeCwd(targetPath, {
        paseoHome: dependencies.paseoHome,
        worktreesRoot: dependencies.paseoWorktreesBaseRoot,
    });
    if (scope === "worktree") {
        if (!ownership.allowed) {
            return {
                ok: false,
                code: "NOT_ALLOWED",
                message: "Worktree is not a Paseo-owned worktree",
                removedAgents: [],
            };
        }
        const result = await archiveByScope(dependencies, {
            scope: { kind: "worktree", targetPath },
            requestId: input.requestId,
        });
        return {
            ok: true,
            removedAgents: result.archivedAgentIds,
        };
    }
    const workspaceId = input.workspaceId ?? (await resolveWorkspaceIdAtPath(dependencies, targetPath));
    if (!workspaceId) {
        dependencies.sessionLogger?.warn({ targetPath }, "Could not resolve workspace for archive; skipping");
        return {
            ok: true,
            removedAgents: [],
        };
    }
    const result = await archiveByScope(dependencies, {
        scope: { kind: "workspace", workspaceId },
        requestId: input.requestId,
    });
    return {
        ok: true,
        removedAgents: result.archivedAgentIds,
    };
}
async function resolveArchiveTarget(dependencies, input) {
    const repoRoot = input.repoRoot ?? null;
    if (input.worktreePath) {
        return input.worktreePath;
    }
    if (input.worktreeSlug) {
        if (!repoRoot) {
            throw new Error("repoRoot is required when worktreeSlug is supplied");
        }
        return resolveWorktreeSlugPath(dependencies, repoRoot, input.worktreeSlug);
    }
    if (repoRoot && input.branchName) {
        const worktrees = await dependencies.workspaceGitService.listWorktrees(repoRoot);
        const match = worktrees.find((entry) => entry.branchName === input.branchName);
        if (!match) {
            throw new Error(`Paseo worktree not found for branch ${input.branchName}`);
        }
        return match.path;
    }
    throw new Error("worktreePath, worktreeSlug, or repoRoot+branchName is required");
}
async function resolveWorktreeSlugPath(dependencies, repoRoot, worktreeSlug) {
    const worktreesRoot = await getPaseoWorktreesRoot(repoRoot, dependencies.paseoHome, dependencies.paseoWorktreesBaseRoot);
    return join(worktreesRoot, worktreeSlug);
}
//# sourceMappingURL=commands.js.map