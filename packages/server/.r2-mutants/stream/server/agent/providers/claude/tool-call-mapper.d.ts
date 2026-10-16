import type { ToolCallTimelineItem } from "../../agent-sdk-types.js";
interface MapperParams {
    callId?: string | null;
    name: string;
    input?: unknown;
    output?: unknown;
    metadata?: Record<string, unknown>;
}
export declare function mapClaudeRunningToolCall(params: MapperParams): ToolCallTimelineItem | null;
export declare function mapClaudeCompletedToolCall(params: MapperParams): ToolCallTimelineItem | null;
export declare function mapClaudeFailedToolCall(params: MapperParams & {
    error: unknown;
}): ToolCallTimelineItem | null;
export declare function mapClaudeCanceledToolCall(params: MapperParams): ToolCallTimelineItem | null;
export {};
//# sourceMappingURL=tool-call-mapper.d.ts.map