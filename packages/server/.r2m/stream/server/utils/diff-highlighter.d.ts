import { type HighlightToken } from "@getpaseo/highlight";
export interface DiffLine {
    type: "add" | "remove" | "context" | "header";
    content: string;
    tokens?: HighlightToken[];
}
export interface DiffHunk {
    oldStart: number;
    oldCount: number;
    newStart: number;
    newCount: number;
    lines: DiffLine[];
}
export interface ParsedDiffFile {
    path: string;
    isNew: boolean;
    isDeleted: boolean;
    additions: number;
    deletions: number;
    hunks: DiffHunk[];
    status?: "ok" | "too_large" | "binary";
}
interface HighlightDiffWithFileContentOptions {
    oldFileContent?: string | null;
    newFileContent?: string | null;
}
interface ParseAndHighlightDiffOptions {
    getOldFileContent?: (file: ParsedDiffFile) => Promise<string | null>;
    getNewFileContent?: (file: ParsedDiffFile) => Promise<string | null>;
}
export declare function parseDiff(diffText: string): ParsedDiffFile[];
/**
 * Reconstruct the "new" version of a file from diff hunks.
 * Returns a map of new line numbers to their content.
 */
export declare function reconstructNewFile(hunks: DiffHunk[]): Map<number, string>;
/**
 * Reconstruct the "old" version of a file from diff hunks.
 * Returns a map of old line numbers to their content.
 */
export declare function reconstructOldFile(hunks: DiffHunk[]): Map<number, string>;
/**
 * Apply syntax highlighting to diff hunks using reconstructed file content.
 * This is the fallback when actual file content is not available.
 */
export declare function highlightDiffFromHunks(file: ParsedDiffFile): ParsedDiffFile;
/**
 * Apply syntax highlighting to diff hunks using actual file content.
 * This provides better context for the parser.
 */
export declare function highlightDiffWithFileContent(file: ParsedDiffFile, cwd: string, options?: HighlightDiffWithFileContentOptions): Promise<ParsedDiffFile>;
/**
 * Parse and highlight a complete diff, using actual file content when available.
 */
export declare function parseAndHighlightDiff(diffText: string, cwd: string, options?: ParseAndHighlightDiffOptions): Promise<ParsedDiffFile[]>;
export type { HighlightToken };
//# sourceMappingURL=diff-highlighter.d.ts.map