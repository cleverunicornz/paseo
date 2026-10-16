export interface ClaudeSubagentUsage {
    totalTokens?: number;
}
export interface ClaudeSubagentPresentationFacts {
    title?: string;
    model?: string;
    effort?: string;
    usage?: ClaudeSubagentUsage;
}
/** Build the complete compact subtitle Claude exposes to provider-neutral clients. */
export declare function buildClaudeSubagentSubtitle(facts: ClaudeSubagentPresentationFacts): string | undefined;
//# sourceMappingURL=presentation.d.ts.map