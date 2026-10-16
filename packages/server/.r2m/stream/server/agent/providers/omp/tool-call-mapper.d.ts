import type { ToolCallDetail } from "../../agent-sdk-types.js";
import type { OmpBridgedToolIdentity } from "./mcp-bridge.js";
import { type OmpToolResult, type OmpTrackedToolCall } from "./tool-call-detail.js";
export declare function mapOmpToolDetail(toolCall: OmpTrackedToolCall, result: OmpToolResult, context?: {
    toolCallId: string;
    bridgedTool?: OmpBridgedToolIdentity;
    mapSubagentDetail?: (baseDetail: ToolCallDetail) => ToolCallDetail;
}): ToolCallDetail | null;
//# sourceMappingURL=tool-call-mapper.d.ts.map