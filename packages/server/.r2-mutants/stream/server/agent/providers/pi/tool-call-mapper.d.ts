import type { ToolCallDetail } from "../../agent-sdk-types.js";
interface BashToolInput {
    command: string;
    timeout?: number;
}
interface ReadToolInput {
    path: string;
    offset?: number;
    limit?: number;
}
interface EditToolInput {
    path: string;
    edits: Array<{
        oldText: string;
        newText: string;
    }>;
}
interface WriteToolInput {
    path: string;
    content: string;
}
interface FindToolInput {
    pattern: string;
    path?: string;
    limit?: number;
}
interface GrepToolInput {
    pattern: string;
    path?: string;
    glob?: string;
    ignoreCase?: boolean;
    literal?: boolean;
    context?: number;
    limit?: number;
}
interface LsToolInput {
    path?: string;
    limit?: number;
}
interface PiToolResultObject {
    output?: string;
    stdout?: string;
    text?: string;
    content?: PiToolResultContent[];
    exitCode?: number;
    code?: number;
    details?: PiToolResultDetails;
}
interface PiToolResultDetails {
    diff?: string;
    [key: string]: unknown;
}
interface PiToolResultTextContent {
    type: "text";
    text: string;
}
interface PiToolResultUnknownContent {
    type: string;
}
type PiToolResultContent = PiToolResultTextContent | PiToolResultUnknownContent;
export type PiToolResult = string | PiToolResultObject | null;
interface PiBashToolCall {
    kind: "bash";
    toolName: "bash";
    args: BashToolInput;
}
interface PiReadToolCall {
    kind: "read";
    toolName: "read";
    args: ReadToolInput;
}
interface PiEditToolCall {
    kind: "edit";
    toolName: "edit";
    args: EditToolInput;
}
interface PiWriteToolCall {
    kind: "write";
    toolName: "write";
    args: WriteToolInput;
}
interface PiFindToolCall {
    kind: "find";
    toolName: "find";
    args: FindToolInput;
}
interface PiGrepToolCall {
    kind: "grep";
    toolName: "grep";
    args: GrepToolInput;
}
interface PiLsToolCall {
    kind: "ls";
    toolName: "ls";
    args: LsToolInput;
}
interface PiUnknownToolCall {
    kind: "unknown";
    toolName: string;
    args: unknown;
}
export type PiTrackedToolCall = PiBashToolCall | PiReadToolCall | PiEditToolCall | PiWriteToolCall | PiFindToolCall | PiGrepToolCall | PiLsToolCall | PiUnknownToolCall;
export declare function parseToolResult(rawResult: unknown): PiToolResult;
export declare function extractTextFromToolResult(result: PiToolResult): string | undefined;
export declare function parseToolArgs(toolName: string, rawArgs: unknown): PiTrackedToolCall;
export declare function mapToolDetail(toolCall: PiTrackedToolCall, result?: PiToolResult): ToolCallDetail;
export {};
//# sourceMappingURL=tool-call-mapper.d.ts.map