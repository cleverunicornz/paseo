import type { PluginLifecycle } from "../../plugins/lifecycle/index.js";
import type { Logger } from "pino";
import { type PersistedProjectRecord, type PersistedWorkspaceRecord, type ProjectRegistry, type WorkspaceRegistry } from "../../workspace-registry.js";
import type { WorkspaceGitService } from "../../workspace-git-service.js";
import type { CreatePaseoWorktreeWorkflowResult } from "../../worktree-session.js";
import type { UntrustedWorkspaceSource } from "../../workspace-automation-gate.js";
export interface ResolveOrCreateWorkspaceIdInput {
    createdWorktree: CreatePaseoWorktreeWorkflowResult | null;
    requestedWorkspaceId?: string;
    cwd: string;
    initialTitle: string | null;
}
export interface ImportWorkspaceInput {
    cwd: string;
    requestedWorkspaceId?: string;
}
export interface ImportWorkspaceResult<T> {
    value: T;
    createdWorkspace: PersistedWorkspaceRecord | null;
}
export interface CreateWorktreeWorkspaceInput {
    sourceCwd: string;
    projectId?: string;
    workspaceId?: string;
    repoRoot: string;
    cwd: string;
    worktreeRoot: string;
    branch: string | null;
    baseBranch: string | null;
    title: string | null;
    expectsInitialAgent?: boolean;
    untrustedSource?: UntrustedWorkspaceSource;
}
export interface WorkspaceProvisioningService {
    runInImportWorkspace<T>(input: ImportWorkspaceInput, operation: (workspace: PersistedWorkspaceRecord) => Promise<T>): Promise<ImportWorkspaceResult<T>>;
    findOrCreateWorkspaceForDirectory(cwd: string): Promise<PersistedWorkspaceRecord>;
    resolveOrCreateWorkspaceIdForCreateAgent(input: ResolveOrCreateWorkspaceIdInput): Promise<string>;
    createWorkspaceForDirectory(cwd: string, title?: string | null, projectId?: string, context?: {
        expectsInitialAgent?: boolean;
        workspaceId?: string;
    }): Promise<PersistedWorkspaceRecord>;
    createWorkspaceForWorktree(input: CreateWorktreeWorkspaceInput): Promise<PersistedWorkspaceRecord>;
    findOrCreateProjectForDirectory(cwd: string): Promise<PersistedProjectRecord>;
    ensureWorkspaceRecordUnarchived(workspace: PersistedWorkspaceRecord): Promise<PersistedWorkspaceRecord>;
}
export type WorkspaceProvisioningErrorCode = "unknown_project" | "archived_project";
export declare class WorkspaceProvisioningError extends Error {
    readonly code: WorkspaceProvisioningErrorCode;
    constructor(code: WorkspaceProvisioningErrorCode, projectId: string);
}
export declare function createWorkspaceProvisioningService(deps: {
    serverId?: string;
    workspaceRegistry: WorkspaceRegistry;
    projectRegistry: ProjectRegistry;
    workspaceGitService: Pick<WorkspaceGitService, "getCheckout" | "getSnapshot" | "peekSnapshot">;
    isDirectory: (path: string) => Promise<boolean>;
    logger: Logger;
    lifecycle?: PluginLifecycle;
}): WorkspaceProvisioningService;
//# sourceMappingURL=workspace-provisioning-service.d.ts.map