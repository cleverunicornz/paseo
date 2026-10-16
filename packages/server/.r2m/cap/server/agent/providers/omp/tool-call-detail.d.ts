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
interface OmpToolResultObject {
    output?: string;
    stdout?: string;
    text?: string;
    content?: OmpToolResultContent[];
    exitCode?: number;
    code?: number;
    details?: OmpToolResultDetails;
}
interface OmpToolResultStructuredError {
    message: string;
}
interface OmpToolResultDetails {
    diff?: string;
    error?: string | OmpToolResultStructuredError;
    mode?: string;
    xdev?: unknown;
}
interface OmpToolResultTextContent {
    type: "text";
    text: string;
}
interface OmpToolResultUnknownContent {
    type: string;
}
type OmpToolResultContent = OmpToolResultTextContent | OmpToolResultUnknownContent;
export type OmpToolResult = string | OmpToolResultObject | null;
interface OmpBashToolCall {
    kind: "bash";
    toolName: "bash";
    args: BashToolInput;
}
interface OmpReadToolCall {
    kind: "read";
    toolName: "read";
    args: ReadToolInput;
}
interface OmpEditToolCall {
    kind: "edit";
    toolName: "edit";
    args: EditToolInput;
}
interface OmpWriteToolCall {
    kind: "write";
    toolName: "write";
    args: WriteToolInput;
}
interface OmpFindToolCall {
    kind: "find";
    toolName: "find";
    args: FindToolInput;
}
interface OmpGrepToolCall {
    kind: "grep";
    toolName: "grep";
    args: GrepToolInput;
}
interface OmpLsToolCall {
    kind: "ls";
    toolName: "ls";
    args: LsToolInput;
}
interface OmpUnknownToolCall {
    kind: "unknown";
    toolName: string;
    args: unknown;
}
export type OmpTrackedToolCall = OmpBashToolCall | OmpReadToolCall | OmpEditToolCall | OmpWriteToolCall | OmpFindToolCall | OmpGrepToolCall | OmpLsToolCall | OmpUnknownToolCall;
export declare function parseToolResult(rawResult: unknown): OmpToolResult;
export declare function extractTextFromToolResult(result: OmpToolResult): string | undefined;
export declare function toolFailureMessage(result: OmpToolResult): string;
export declare function isOmpToolFailure(toolCall: OmpTrackedToolCall, result: OmpToolResult, isError: boolean): boolean;
export declare function parseToolArgs(toolName: string, rawArgs: unknown): OmpTrackedToolCall;
export declare function resolveToolCallName(toolCall: OmpTrackedToolCall, result?: OmpToolResult): string;
export declare function mapToolDetail(toolCall: OmpTrackedToolCall, result?: OmpToolResult): ToolCallDetail;
export {};
//# sourceMappingURL=tool-call-detail.d.ts.map