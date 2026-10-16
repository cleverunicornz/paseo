import { type ArchiveDependencies, type ArchiveScope } from "../workspace-archive-service.js";
import type { CreatePaseoWorktreeInput, CreatePaseoWorktreeResult } from "../paseo-worktree-service.js";
import { type WorktreeWireError } from "../worktree-errors.js";
import type { WorkspaceGitService, WorkspaceGitWorktreeInfo } from "../workspace-git-service.js";
export interface ListPaseoWorktreesCommandDependencies {
    workspaceGitService: Pick<WorkspaceGitService, "listWorktrees">;
}
export interface ListPaseoWorktreesCommandInput {
    cwd: string;
    reason?: string;
}
export declare function listPaseoWorktreesCommand(dependencies: ListPaseoWorktreesCommandDependencies, input: ListPaseoWorktreesCommandInput): Promise<WorkspaceGitWorktreeInfo[]>;
type CreatePaseoWorktreeWorkflow<Result extends CreatePaseoWorktreeResult> = (input: CreatePaseoWorktreeInput) => Promise<Result>;
export interface CreatePaseoWorktreeCommandDependencies<Result extends CreatePaseoWorktreeResult = CreatePaseoWorktreeResult> {
    paseoHome?: string;
    worktreesRoot?: string;
    createPaseoWorktreeWorkflow?: CreatePaseoWorktreeWorkflow<Result>;
}
export type CreatePaseoWorktreeCommandInput = Omit<CreatePaseoWorktreeInput, "paseoHome" | "runSetup"> & {
    paseoHome?: string;
    worktreesRoot?: string;
};
export type CreatePaseoWorktreeCommandResult<Result extends CreatePaseoWorktreeResult> = {
    ok: true;
    createdWorktree: Result;
} | {
    ok: false;
    error: WorktreeWireError;
    cause: unknown;
};
export declare function createPaseoWorktreeCommand<Result extends CreatePaseoWorktreeResult>(dependencies: CreatePaseoWorktreeCommandDependencies<Result>, input: CreatePaseoWorktreeCommandInput): Promise<CreatePaseoWorktreeCommandResult<Result>>;
export interface ArchiveCommandDependencies extends Omit<ArchiveDependencies, "workspaceGitService"> {
    workspaceGitService: Pick<WorkspaceGitService, "getSnapshot" | "listWorktrees">;
}
export interface ArchiveCommandInput {
    requestId: string;
    repoRoot?: string | null;
    worktreePath?: string;
    worktreeSlug?: string;
    branchName?: string;
    workspaceId?: string;
    scope?: ArchiveScope["kind"];
}
export type ArchiveCommandResult = {
    ok: true;
    removedAgents: string[];
} | {
    ok: false;
    code: "NOT_ALLOWED";
    message: string;
    removedAgents: [];
};
export declare function archiveCommand(dependencies: ArchiveCommandDependencies, input: ArchiveCommandInput): Promise<ArchiveCommandResult>;
export {};
//# sourceMappingURL=commands.d.ts.map