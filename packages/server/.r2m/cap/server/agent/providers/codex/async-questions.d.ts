import type { AgentPermissionRequest, AgentPermissionResponse, ToolCallTimelineItem } from "../../agent-sdk-types.js";
export declare function codexAsyncQuestionToTimeline(item: unknown): ToolCallTimelineItem | null;
/** Codex emits these as completed messages; the outstanding answer belongs to the session. */
export declare class CodexAsyncQuestions {
    private readonly records;
    constructor(saved: unknown);
    receive(item: unknown): AgentPermissionRequest | null;
    pending(): AgentPermissionRequest[];
    hasPending(id: string): boolean;
    prepareResponse(id: string, response: AgentPermissionResponse): {
        prompt?: string;
        complete: () => ToolCallTimelineItem;
    };
    timeline(itemId: string): ToolCallTimelineItem | null;
    retain(itemIds: ReadonlySet<string>): string[];
    serialize(): unknown;
}
//# sourceMappingURL=async-questions.d.ts.map