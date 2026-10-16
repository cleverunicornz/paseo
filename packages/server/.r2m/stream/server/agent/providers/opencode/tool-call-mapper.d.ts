import type { ToolCallTimelineItem } from "../../agent-sdk-types.js";
interface OpencodeToolCallParams {
    toolName: string;
    callId?: string | null;
    status?: unknown;
    input?: unknown;
    output?: unknown;
    error?: unknown;
    metadata?: Record<string, unknown>;
}
export declare function mapOpencodeToolCall(params: OpencodeToolCallParams): ToolCallTimelineItem | null;
export {};
//# sourceMappingURL=tool-call-mapper.d.ts.map