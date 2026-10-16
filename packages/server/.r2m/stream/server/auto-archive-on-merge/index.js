import { resolve } from "node:path";
import { LRUCache } from "lru-cache";
import { archiveIfSafe } from "./archive-if-safe.js";
const OPEN_PULL_REQUEST_LATCH_MAX = 1024;
const defaultDependencies = {
    archiveIfSafe,
    resolvePath: resolve,
};
export function setupAutoArchiveOnMerge(options, deps = defaultDependencies) {
    const log = options.logger.child({ module: "auto-archive-on-merge" });
    const inFlightCwds = new Set();
    const openPullRequestUrlsByCwd = new LRUCache({
        max: OPEN_PULL_REQUEST_LATCH_MAX,
    });
    return options.workspaceGitService.onSnapshotUpdated((snapshot) => {
        const snapshotCwd = deps.resolvePath(snapshot.cwd);
        if (options.daemonConfigStore.get().autoArchiveAfterMerge !== true) {
            openPullRequestUrlsByCwd.delete(snapshotCwd);
            return;
        }
        const pullRequest = snapshot.forge.pullRequest;
        if (!pullRequest?.isMerged) {
            if (pullRequest?.state.toLowerCase() === "open") {
                openPullRequestUrlsByCwd.set(snapshotCwd, pullRequest.url);
            }
            else {
                openPullRequestUrlsByCwd.delete(snapshotCwd);
            }
            return;
        }
        if (openPullRequestUrlsByCwd.get(snapshotCwd) !== pullRequest.url) {
            openPullRequestUrlsByCwd.delete(snapshotCwd);
            return;
        }
        if (inFlightCwds.has(snapshotCwd)) {
            return;
        }
        inFlightCwds.add(snapshotCwd);
        void (async () => {
            let freshSnapshot;
            try {
                freshSnapshot = await options.workspaceGitService.getSnapshot(snapshot.cwd, {
                    reason: "auto-archive-on-merge",
                });
            }
            catch (error) {
                log.warn({ err: error, cwd: snapshot.cwd }, "Failed to read snapshot for auto-archive; skipping");
                return;
            }
            const freshPullRequest = freshSnapshot?.forge.pullRequest;
            if (!freshPullRequest?.isMerged ||
                freshPullRequest.url !== pullRequest.url ||
                openPullRequestUrlsByCwd.get(snapshotCwd) !== pullRequest.url) {
                if (openPullRequestUrlsByCwd.get(snapshotCwd) === pullRequest.url) {
                    openPullRequestUrlsByCwd.delete(snapshotCwd);
                }
                return;
            }
            const attachedWorkspaces = (await options.listActiveWorkspaces()).filter((workspace) => deps.resolvePath(workspace.cwd) === snapshotCwd);
            for (const workspace of attachedWorkspaces) {
                await deps.archiveIfSafe({
                    workspaceId: workspace.workspaceId,
                    snapshot: freshSnapshot,
                    options,
                    log,
                });
            }
        })()
            .catch((error) => {
            log.warn({ err: error, cwd: snapshot.cwd }, "Failed to auto-archive attached workspaces");
        })
            .finally(() => {
            inFlightCwds.delete(snapshotCwd);
        });
    });
}
//# sourceMappingURL=index.js.map