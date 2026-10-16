import { type PersistedProjectRecord, type PersistedWorkspaceRecord } from "../../workspace-registry.js";
export type WorkspaceRecoveryAction = "unarchive" | "restore";
export type WorkspaceRecoveryState = {
    kind: "recoverable";
    workspaceId: string;
    workspaceName: string;
    action: WorkspaceRecoveryAction;
    branch: string | null;
} | {
    kind: "unavailable";
    workspaceId: string;
    reason: "workspace_not_found" | "workspace_not_archived" | "project_not_found" | "project_directory_missing" | "workspace_directory_missing" | "worktree_branch_missing";
    message: string;
};
export interface WorkspaceRecoveryService {
    inspect(workspaceId: string): Promise<WorkspaceRecoveryState>;
    restore(workspaceId: string): Promise<{
        workspaceId: string;
        action: WorkspaceRecoveryAction;
    }>;
}
export declare function createWorkspaceRecoveryService(deps: {
    paseoHome: string;
    worktreesRoot?: string;
    getWorkspace: (workspaceId: string) => Promise<PersistedWorkspaceRecord | null>;
    getProject: (projectId: string) => Promise<PersistedProjectRecord | null>;
    isDirectory: (path: string) => Promise<boolean>;
    unarchiveWorkspace: (workspace: PersistedWorkspaceRecord) => Promise<void>;
}): WorkspaceRecoveryService;
//# sourceMappingURL=workspace-recovery-service.d.ts.map