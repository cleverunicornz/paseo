import { MissingCheckoutTargetError } from "./resolve-worktree-creation-intent.js";
import { BranchAlreadyCheckedOutError, UnknownBranchError } from "../utils/worktree.js";
export class WorktreeRequestError extends Error {
    constructor(error) {
        super(error.message);
        this.name = "WorktreeRequestError";
        this.code = error.code;
    }
}
export function toWorktreeWireError(error) {
    if (error instanceof BranchAlreadyCheckedOutError) {
        return { code: "branch_already_checked_out", message: error.message };
    }
    if (error instanceof MissingCheckoutTargetError) {
        return { code: "missing_checkout_target", message: error.message };
    }
    if (error instanceof UnknownBranchError) {
        return { code: "unknown_branch", message: error.message };
    }
    if (error instanceof Error) {
        return { code: "unknown", message: error.message };
    }
    return { code: "unknown", message: String(error) };
}
export function toWorktreeRequestError(error) {
    return new WorktreeRequestError(toWorktreeWireError(error));
}
//# sourceMappingURL=worktree-errors.js.map