export type WorktreeWireErrorCode = "branch_already_checked_out" | "missing_checkout_target" | "unknown_branch" | "unknown";
export interface WorktreeWireError {
    code: WorktreeWireErrorCode;
    message: string;
}
export declare class WorktreeRequestError extends Error {
    readonly code: WorktreeWireErrorCode;
    constructor(error: WorktreeWireError);
}
export declare function toWorktreeWireError(error: unknown): WorktreeWireError;
export declare function toWorktreeRequestError(error: unknown): WorktreeRequestError;
//# sourceMappingURL=worktree-errors.d.ts.map