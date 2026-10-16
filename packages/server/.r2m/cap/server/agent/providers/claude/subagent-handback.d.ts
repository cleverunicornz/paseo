export interface ClaudeSubagentHandback {
    callId: string;
    /** Null while the call is still streaming its input. */
    report: string | null;
}
export declare function isClaudeSubagentHandbackToolName(name: unknown): boolean;
export declare function readClaudeSubagentHandback(block: {
    type: string;
    [key: string]: unknown;
}): ClaudeSubagentHandback | null;
//# sourceMappingURL=subagent-handback.d.ts.map