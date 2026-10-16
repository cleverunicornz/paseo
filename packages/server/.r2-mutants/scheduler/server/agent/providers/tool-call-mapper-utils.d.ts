export type NormalizedToolCallStatus = "running" | "completed" | "failed" | "canceled";
export declare function normalizeToolCallStatus(rawStatus: string | undefined | null, error: unknown, output: unknown): NormalizedToolCallStatus;
interface ReadChunkLike {
    text?: string;
    content?: string;
    output?: string;
}
export declare function nonEmptyString(value: unknown): string | undefined;
export declare function extractCodexShellOutput(value: string | undefined): string | undefined;
export declare function extractCodexTerminalSessionId(value: string | undefined): string | undefined;
export declare function flattenReadContent<Chunk extends ReadChunkLike>(value: string | Chunk | Chunk[] | undefined): string | undefined;
export interface StrippedReadContent {
    content: string;
    startLine?: number;
}
export declare function stripReadLineNumberGutter(content: string | undefined): StrippedReadContent | undefined;
export declare function truncateDiffText(text: string | undefined, maxChars?: number): string | undefined;
export declare function coerceToolCallId(params: {
    providerPrefix: string;
    rawCallId: string | null | undefined;
    toolName: string;
    input: unknown;
}): string;
export {};
//# sourceMappingURL=tool-call-mapper-utils.d.ts.map