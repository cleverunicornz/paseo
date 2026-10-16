import type { TerminalSession } from "./terminal.js";
interface TerminalSizeRequest {
    rows: number;
    cols: number;
    intent?: "claim" | "update";
}
export declare function applyTerminalSize(terminal: TerminalSession, owner: object, request: TerminalSizeRequest): boolean;
export {};
//# sourceMappingURL=terminal-size-ownership.d.ts.map