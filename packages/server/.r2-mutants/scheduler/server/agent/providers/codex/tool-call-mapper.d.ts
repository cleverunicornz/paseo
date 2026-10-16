import type { ToolCallTimelineItem } from "../../agent-sdk-types.js";
interface CodexMapperOptions {
    cwd?: string | null;
}
export interface CodexMcpToolResultImage {
    data: string;
    mimeType: string;
}
interface CodexMcpToolResultImagesSplit {
    images: CodexMcpToolResultImage[];
    output: unknown;
}
export declare function normalizeCommandExecutionCommand(value: unknown): string | undefined;
export declare function splitCodexMcpToolResultImages(result: unknown): CodexMcpToolResultImagesSplit;
export declare function mapCodexToolCallFromThreadItem(item: unknown, options?: CodexMapperOptions): ToolCallTimelineItem | null;
export declare function mapCodexToolCallEnvelope(params: {
    callId?: string | null;
    name: string;
    input?: unknown;
    output?: unknown;
    error?: unknown;
    cwd?: string | null;
}): ToolCallTimelineItem | null;
export {};
//# sourceMappingURL=tool-call-mapper.d.ts.map