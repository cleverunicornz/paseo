import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { highlightCode, isLanguageSupported } from "@getpaseo/highlight";
const MAX_DIFF_HIGHLIGHT_LINE_CHARS = 10000;
/**
 * Parse a unified diff into structured data
 */
// Git's default patch headers use paired a/path and b/path prefixes, while
// diff.noprefix emits plain paths that may legitimately start with a/ or b/.
function usesDiffPathPrefixes(oldPath, newPath) {
    return oldPath.startsWith("a/") && newPath.startsWith("b/");
}
function extractPathFromMetadata(lines, prefix) {
    const line = lines.find((candidate) => candidate.startsWith(prefix));
    if (!line) {
        return null;
    }
    const path = line.slice(prefix.length).replace(/\t.*$/, "").trimEnd();
    return path === "/dev/null" ? null : path;
}
function extractPathFromDiffHeader(lines) {
    const firstLine = lines[0] ?? "";
    const prefixedPathMatch = firstLine.match(/^a\/(.+) b\/(.+)$/);
    if (prefixedPathMatch) {
        return prefixedPathMatch[2];
    }
    const metadataPath = extractPathFromMetadata(lines, "+++ ") ?? extractPathFromMetadata(lines, "--- ");
    if (metadataPath) {
        return metadataPath;
    }
    const pathMatch = firstLine.match(/^(\S+)\s+(\S+)$/);
    if (pathMatch) {
        const [, oldPath, newPath] = pathMatch;
        const path = newPath === "/dev/null" ? oldPath : newPath;
        return usesDiffPathPrefixes(oldPath, newPath) ? path.slice(2) : path;
    }
    return "unknown";
}
function isMetadataLine(line) {
    return (line.startsWith("index ") ||
        line.startsWith("--- ") ||
        line.startsWith("+++ ") ||
        line.startsWith("new file mode") ||
        line.startsWith("deleted file mode"));
}
function parseHunkHeader(line) {
    const hunkMatch = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
    if (!hunkMatch)
        return null;
    return {
        oldStart: parseInt(hunkMatch[1], 10),
        oldCount: parseInt(hunkMatch[2] ?? "1", 10),
        newStart: parseInt(hunkMatch[3], 10),
        newCount: parseInt(hunkMatch[4] ?? "1", 10),
        lines: [{ type: "header", content: line.match(/^(@@ .+? @@)/)?.[1] ?? line }],
    };
}
function parseSectionBody(lines) {
    const hunks = [];
    let currentHunk = null;
    let additions = 0;
    let deletions = 0;
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        if (isMetadataLine(line))
            continue;
        const newHunk = parseHunkHeader(line);
        if (newHunk) {
            if (currentHunk)
                hunks.push(currentHunk);
            currentHunk = newHunk;
            continue;
        }
        if (!currentHunk)
            continue;
        if (line.startsWith("+")) {
            currentHunk.lines.push({ type: "add", content: line.slice(1) });
            additions++;
        }
        else if (line.startsWith("-")) {
            currentHunk.lines.push({ type: "remove", content: line.slice(1) });
            deletions++;
        }
        else if (line.startsWith(" ")) {
            currentHunk.lines.push({ type: "context", content: line.slice(1) });
        }
        else if (line.length > 0 && !line.startsWith("\\")) {
            currentHunk.lines.push({ type: "context", content: line });
        }
    }
    if (currentHunk)
        hunks.push(currentHunk);
    return { hunks, additions, deletions };
}
export function parseDiff(diffText) {
    if (!diffText || diffText.trim().length === 0) {
        return [];
    }
    const files = [];
    const fileSections = diffText.split(/^diff --git /m).filter(Boolean);
    for (const section of fileSections) {
        const lines = section.split("\n");
        const isNew = section.includes("new file mode") || section.includes("--- /dev/null");
        const isDeleted = section.includes("deleted file mode") || section.includes("+++ /dev/null");
        const path = extractPathFromDiffHeader(lines);
        const { hunks, additions, deletions } = parseSectionBody(lines);
        files.push({ path, isNew, isDeleted, additions, deletions, hunks });
    }
    return files;
}
/**
 * Reconstruct the "new" version of a file from diff hunks.
 * Returns a map of new line numbers to their content.
 */
export function reconstructNewFile(hunks) {
    const lines = new Map();
    for (const hunk of hunks) {
        let newLineNum = hunk.newStart;
        for (const line of hunk.lines) {
            if (line.type === "header")
                continue;
            if (line.type === "add" || line.type === "context") {
                lines.set(newLineNum, line.content);
                newLineNum++;
            }
        }
    }
    return lines;
}
/**
 * Reconstruct the "old" version of a file from diff hunks.
 * Returns a map of old line numbers to their content.
 */
export function reconstructOldFile(hunks) {
    const lines = new Map();
    for (const hunk of hunks) {
        let oldLineNum = hunk.oldStart;
        for (const line of hunk.lines) {
            if (line.type === "header")
                continue;
            if (line.type === "remove" || line.type === "context") {
                lines.set(oldLineNum, line.content);
                oldLineNum++;
            }
        }
    }
    return lines;
}
function buildFileContent(lineMap) {
    if (lineMap.size === 0)
        return "";
    const lineNumbers = Array.from(lineMap.keys()).sort((a, b) => a - b);
    const minLine = lineNumbers[0];
    const maxLine = lineNumbers[lineNumbers.length - 1];
    const lines = [];
    for (let i = minLine; i <= maxLine; i++) {
        lines.push(lineMap.get(i) ?? "");
    }
    return lines.join("\n");
}
function hasOversizedLine(content) {
    let lineStart = 0;
    for (let index = 0; index <= content.length; index++) {
        if (index !== content.length && content.charCodeAt(index) !== 10)
            continue;
        if (index - lineStart > MAX_DIFF_HIGHLIGHT_LINE_CHARS)
            return true;
        lineStart = index + 1;
    }
    return false;
}
function hasOversizedDiffLine(file) {
    for (const hunk of file.hunks) {
        for (const line of hunk.lines) {
            if (line.content.length > MAX_DIFF_HIGHLIGHT_LINE_CHARS)
                return true;
        }
    }
    return false;
}
function buildTokenLookup(lineMap, highlighted) {
    const lookup = new Map();
    if (lineMap.size === 0)
        return lookup;
    const lineNumbers = Array.from(lineMap.keys()).sort((a, b) => a - b);
    const minLine = lineNumbers[0];
    for (let i = 0; i < highlighted.length; i++) {
        const lineNum = minLine + i;
        if (lineMap.has(lineNum)) {
            lookup.set(lineNum, highlighted[i]);
        }
    }
    return lookup;
}
function buildFullFileTokenLookup(fileContent, path) {
    if (hasOversizedLine(fileContent))
        return null;
    const lookup = new Map();
    const highlighted = highlightCode(fileContent, path);
    for (let i = 0; i < highlighted.length; i++) {
        lookup.set(i + 1, highlighted[i]);
    }
    return lookup;
}
function buildReconstructedTokenLookups(file) {
    const newFileLines = reconstructNewFile(file.hunks);
    const oldFileLines = reconstructOldFile(file.hunks);
    const newFileContent = buildFileContent(newFileLines);
    const oldFileContent = buildFileContent(oldFileLines);
    const newHighlighted = highlightCode(newFileContent, file.path);
    const oldHighlighted = highlightCode(oldFileContent, file.path);
    return {
        newTokensByLine: buildTokenLookup(newFileLines, newHighlighted),
        oldTokensByLine: buildTokenLookup(oldFileLines, oldHighlighted),
    };
}
/**
 * Apply syntax highlighting to diff hunks using reconstructed file content.
 * This is the fallback when actual file content is not available.
 */
export function highlightDiffFromHunks(file) {
    if (!isLanguageSupported(file.path) || hasOversizedDiffLine(file)) {
        return file;
    }
    const reconstructedTokens = buildReconstructedTokenLookups(file);
    return applyTokensToHunks(file, reconstructedTokens.newTokensByLine, reconstructedTokens.oldTokensByLine);
}
/**
 * Apply syntax highlighting to diff hunks using actual file content.
 * This provides better context for the parser.
 */
export async function highlightDiffWithFileContent(file, cwd, options = {}) {
    if (!isLanguageSupported(file.path) || hasOversizedDiffLine(file)) {
        return file;
    }
    let newTokensByLine = null;
    const oldTokensByLine = typeof options.oldFileContent === "string"
        ? buildFullFileTokenLookup(options.oldFileContent, file.path)
        : null;
    if (typeof options.newFileContent === "string") {
        newTokensByLine = buildFullFileTokenLookup(options.newFileContent, file.path);
    }
    else {
        try {
            const fileContent = await readFile(resolve(cwd, file.path), "utf-8");
            newTokensByLine = buildFullFileTokenLookup(fileContent, file.path);
        }
        catch {
            // Deleted or unavailable files use reconstructed tokens below.
        }
    }
    if (newTokensByLine && oldTokensByLine)
        return applyTokensToHunks(file, newTokensByLine, oldTokensByLine);
    const reconstructedTokens = buildReconstructedTokenLookups(file);
    return applyTokensToHunks(file, newTokensByLine ?? reconstructedTokens.newTokensByLine, oldTokensByLine ?? reconstructedTokens.oldTokensByLine);
}
function applyTokensToHunks(file, newTokensByLine, oldTokensByLine) {
    const highlightedHunks = file.hunks.map((hunk) => {
        let oldLineNum = hunk.oldStart;
        let newLineNum = hunk.newStart;
        const highlightedLines = hunk.lines.map((line) => {
            if (line.type === "header") {
                return line;
            }
            let tokens;
            if (line.type === "add") {
                tokens = newTokensByLine.get(newLineNum);
                newLineNum++;
            }
            else if (line.type === "remove") {
                tokens = oldTokensByLine.get(oldLineNum);
                oldLineNum++;
            }
            else if (line.type === "context") {
                // Context lines exist in both - use new file version
                tokens = newTokensByLine.get(newLineNum);
                oldLineNum++;
                newLineNum++;
            }
            return tokens ? { ...line, tokens } : line;
        });
        return { ...hunk, lines: highlightedLines };
    });
    return { ...file, hunks: highlightedHunks };
}
/**
 * Parse and highlight a complete diff, using actual file content when available.
 */
export async function parseAndHighlightDiff(diffText, cwd, options = {}) {
    const files = parseDiff(diffText);
    const highlightedFiles = await Promise.all(files.map(async (file) => {
        const [oldFileContent, newFileContent] = await Promise.all([
            options.getOldFileContent?.(file),
            options.getNewFileContent?.(file),
        ]);
        return highlightDiffWithFileContent(file, cwd, {
            oldFileContent: oldFileContent ?? undefined,
            newFileContent: newFileContent ?? undefined,
        });
    }));
    return highlightedFiles;
}
//# sourceMappingURL=diff-highlighter.js.map