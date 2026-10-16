import type { TerminalSession } from "./terminal.js";
export interface CaptureTerminalLinesOptions {
    start?: number;
    end?: number;
    stripAnsi?: boolean;
}
export interface CaptureTerminalLinesResult {
    lines: string[];
    totalLines: number;
}
export declare function captureTerminalLines(terminal: TerminalSession, options?: CaptureTerminalLinesOptions): CaptureTerminalLinesResult;
//# sourceMappingURL=terminal-capture.d.ts.map