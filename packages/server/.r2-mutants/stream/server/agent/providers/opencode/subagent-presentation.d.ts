export interface OpenCodeSubagentPresentationFacts {
    /** OpenCode agent name running the child, e.g. "general", "explore". */
    agentName?: string;
    /** Raw model id, e.g. "claude-sonnet-5". OpenCode has no label table at translation time. */
    modelId?: string;
    /** Thinking level, e.g. "high", "max". */
    variant?: string;
    /** Latest assistant message token sum (input+output+reasoning+cache). */
    totalTokens?: number;
}
/**
 * Per-child presentation tracking: raw facts plus the last subtitle emitted, so
 * repeated folds of the same facts never re-emit an identical upsert.
 */
export interface OpenCodeSubagentPresentationState {
    facts: OpenCodeSubagentPresentationFacts;
    lastSubtitle?: string;
    /** A descriptor title has been emitted from detection, linking, or assistant facts. */
    titleEmitted?: boolean;
    /** Set once the parent `task` tool call has been linked to this child. */
    linkedToolCallId?: string;
    /** The link upsert carried a title (subAgentType); detection must not overwrite it. */
    titleFromLink?: boolean;
    /** The link upsert carried a description (task input); detection must not overwrite it. */
    descriptionFromLink?: boolean;
}
/** Claim the assistant/session agent as the descriptor title when no stronger title exists. */
export declare function claimOpenCodeSubagentFallbackTitle(state: OpenCodeSubagentPresentationState, agentName: string | undefined): string | undefined;
/** Build the complete compact subtitle OpenCode exposes to provider-neutral clients. */
export declare function buildOpenCodeSubagentSubtitle(facts: OpenCodeSubagentPresentationFacts): string | undefined;
/**
 * Merge observed facts into the tracked state and return the folded subtitle only
 * when it differs from the last one emitted; otherwise return undefined.
 */
export declare function foldOpenCodeSubagentPresentation(state: OpenCodeSubagentPresentationState, patch: OpenCodeSubagentPresentationFacts): string | undefined;
//# sourceMappingURL=subagent-presentation.d.ts.map