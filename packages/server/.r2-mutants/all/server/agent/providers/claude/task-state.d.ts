import type { AgentTimelineItem } from "../../agent-sdk-types.js";
/** Accumulates Claude's snapshot and ID-based task tools into canonical todo snapshots. */
export declare class ClaudeTaskState {
    private readonly tasks;
    private readonly calls;
    private readonly appliedResults;
    observe(value: unknown): Extract<AgentTimelineItem, {
        type: "todo";
    }> | null;
    reset(): void;
    private replaceLegacyTodos;
    private applyResult;
    private applyCreate;
    private applyUpdate;
    private applyList;
    private snapshot;
}
//# sourceMappingURL=task-state.d.ts.map