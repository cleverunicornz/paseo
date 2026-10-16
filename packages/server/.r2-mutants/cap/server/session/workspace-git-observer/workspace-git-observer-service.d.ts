import type pino from "pino";
import type { WorkspaceDescriptorPayload } from "../../messages.js";
import type { WorkspaceGitRuntimeSnapshot, WorkspaceGitService } from "../../workspace-git-service.js";
export interface WorkspaceGitObserverMetrics {
    watchedDirectoryCount: number;
    workspaceRecordCount: number;
    subscriptionCount: number;
}
/**
 * Observes a workspace's git state on disk (via WorkspaceGitService) and drives the
 * live update fan-out: branch-change notifications, workspace-card refreshes, and
 * checkout status updates. It owns the per-cwd watch targets and the WorkspaceGitService
 * subscription handles. Filesystem subscriptions are keyed by cwd while descriptor and
 * branch state remain keyed by workspace id, so same-directory workspace records share one
 * watch without sharing identity or teardown lifetime.
 *
 * Branch changes reach `onBranchChanged` from two paths that share `lastBranchName`: the
 * on-disk snapshot listener (handleBranchSnapshot) and the workspace-emit loop's Git runtime
 * projection (recordDescriptorState). Both stay inside this module so the shared state is coherent.
 */
export interface WorkspaceGitObserverService {
    syncObservers(workspaces: Iterable<WorkspaceDescriptorPayload>): void;
    reconcileObservers(workspaces: Iterable<Pick<WorkspaceDescriptorPayload, "id" | "workspaceDirectory" | "workspaceKind">>): void;
    recordDescriptorState(workspaceId: string, workspace: WorkspaceDescriptorPayload | null): void;
    handleBranchSnapshot(cwd: string, branchName: string | null): void;
    getMetrics(): WorkspaceGitObserverMetrics;
    removeForWorkspaceId(workspaceId: string): void;
    dispose(): void;
}
export declare function createWorkspaceGitObserverService(deps: {
    workspaceGitService: Pick<WorkspaceGitService, "registerWorkspace">;
    emitWorkspaceUpdateForCwd: (cwd: string) => Promise<void>;
    emitStatusUpdate: (cwd: string, snapshot: WorkspaceGitRuntimeSnapshot) => void;
    onBranchChanged?: (workspaceId: string, oldBranch: string | null, newBranch: string | null) => void;
    logger: pino.Logger;
}): WorkspaceGitObserverService;
//# sourceMappingURL=workspace-git-observer-service.d.ts.map