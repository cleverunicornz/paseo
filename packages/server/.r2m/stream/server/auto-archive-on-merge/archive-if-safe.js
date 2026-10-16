import { archiveByScope, killTerminalsForWorkspace, } from "../workspace-archive-service.js";
import { isPaseoOwnedWorktreeCwd } from "../../utils/worktree.js";
const defaultDependencies = {
    archiveByScope,
    isPaseoOwnedWorktreeCwd,
    killTerminalsForWorkspace,
};
export async function archiveIfSafe(input) {
    const { workspaceId, snapshot, options, log } = input;
    const deps = input.deps ?? defaultDependencies;
    const cwd = snapshot.cwd;
    const pullRequest = snapshot.forge.pullRequest;
    if (!pullRequest?.isMerged) {
        return;
    }
    if (snapshot.git.isDirty === true) {
        return;
    }
    if (typeof snapshot.git.aheadOfOrigin === "number" && snapshot.git.aheadOfOrigin > 0) {
        return;
    }
    const ownership = await deps.isPaseoOwnedWorktreeCwd(cwd, {
        paseoHome: options.paseoHome,
        worktreesRoot: options.paseoWorktreesBaseRoot,
    });
    if (!ownership.allowed) {
        return;
    }
    try {
        const autoArchivedChangeRequestUrl = await options.getAutoArchivedChangeRequestUrl(workspaceId);
        if (autoArchivedChangeRequestUrl === pullRequest.url) {
            return;
        }
        await deps.archiveByScope({
            paseoHome: options.paseoHome,
            paseoWorktreesBaseRoot: options.paseoWorktreesBaseRoot,
            github: options.github,
            workspaceGitService: options.workspaceGitService,
            agentManager: options.agentManager,
            agentStorage: options.agentStorage,
            findWorkspaceIdForCwd: options.findWorkspaceIdForCwd,
            listActiveWorkspaces: options.listActiveWorkspaces,
            archiveWorkspaceRecord: (workspaceIdToArchive) => options.archiveWorkspaceRecord(workspaceIdToArchive, {
                autoArchivedChangeRequestUrl: pullRequest.url,
            }),
            emitWorkspaceUpdatesForWorkspaceIds: options.emitWorkspaceUpdatesForWorkspaceIds,
            markWorkspaceArchiving: options.markWorkspaceArchiving,
            clearWorkspaceArchiving: options.clearWorkspaceArchiving,
            killTerminalsForWorkspace: (workspaceIdToKill) => deps.killTerminalsForWorkspace({
                terminalManager: options.terminalManager,
                sessionLogger: log,
            }, workspaceIdToKill),
            sessionLogger: log,
        }, {
            scope: { kind: "workspace", workspaceId },
            requestId: "auto-archive-on-merge",
        });
        log.info({ workspaceId, cwd, branch: pullRequest.headRefName, pullRequestUrl: pullRequest.url }, "Auto-archived worktree after PR merge");
    }
    catch (error) {
        log.warn({ err: error, cwd }, "Auto-archive after merge failed");
    }
}
//# sourceMappingURL=archive-if-safe.js.map