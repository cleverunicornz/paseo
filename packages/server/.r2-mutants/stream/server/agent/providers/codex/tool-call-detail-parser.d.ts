import type { ToolCallDetail } from "../../agent-sdk-types.js";
export interface CodexToolDetailContext {
    cwd?: string | null;
}
export declare function normalizeCodexFilePath(filePath: string, cwd: string | null | undefined): string | undefined;
export declare function deriveCodexToolDetail(params: {
    name: string;
    input: unknown;
    output: unknown;
    cwd?: string | null;
}): ToolCallDetail;
//# sourceMappingURL=tool-call-detail-parser.d.ts.map