import stripAnsi from "strip-ansi";
function cellsToPlainText(cells, options) {
    const text = cells
        .map((cell) => cell.char)
        .join("")
        .trimEnd();
    return options.stripAnsi ? stripAnsi(text) : text;
}
function resolveCaptureLineIndex(lineNumber, totalLines, fallback) {
    if (totalLines === 0) {
        return fallback === "start" ? 0 : -1;
    }
    const defaultIndex = fallback === "start" ? 0 : totalLines - 1;
    if (typeof lineNumber !== "number") {
        return defaultIndex;
    }
    const resolvedIndex = lineNumber < 0 ? totalLines + lineNumber : lineNumber;
    if (resolvedIndex < 0) {
        return 0;
    }
    if (resolvedIndex >= totalLines) {
        return totalLines - 1;
    }
    return resolvedIndex;
}
export function captureTerminalLines(terminal, options = {}) {
    const state = terminal.getState();
    const allLines = [...state.scrollback, ...state.grid].map((cells) => cellsToPlainText(cells, { stripAnsi: options.stripAnsi ?? true }));
    const totalLines = allLines.length;
    const startIndex = resolveCaptureLineIndex(options.start, totalLines, "start");
    const endIndex = resolveCaptureLineIndex(options.end, totalLines, "end");
    if (totalLines === 0 || startIndex > endIndex) {
        return {
            lines: [],
            totalLines,
        };
    }
    return {
        lines: allLines.slice(startIndex, endIndex + 1),
        totalLines,
    };
}
//# sourceMappingURL=terminal-capture.js.map