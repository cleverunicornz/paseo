import { type SkillOp, type SkillSelection, type SkillTargets } from "./operations.js";
export interface SkillsTransaction {
    /** Convergence stuck. Drop the staged copies. */
    commit(): Promise<void>;
    /** Put every captured directory back exactly as it was, then drop the staging. */
    rollback(): Promise<void>;
}
/**
 * Finishes what an interrupted save started. A transaction directory only exists
 * while a save is mid-flight, so finding one means the process died between
 * mutating the directories and committing the selection — the staged copies are
 * the only place the user's files still exist. Restore them, then drop the
 * transaction. Anything without our manifest is left where it is.
 */
export declare function recoverInterruptedSkillTransactions(targets: SkillTargets, committedSelection: SkillSelection): Promise<void>;
/**
 * Captures the managed skill directories so a failed save can put the machine
 * back exactly as it was — including files the user added inside them, which
 * re-running an install cannot reconstruct.
 */
export declare function beginSkillsTransaction(targets: SkillTargets, previousSelection: SkillSelection, nextSelection: SkillSelection, ops: readonly SkillOp[]): Promise<SkillsTransaction>;
//# sourceMappingURL=transaction.d.ts.map