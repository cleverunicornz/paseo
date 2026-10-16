import { z } from "zod";
import type { AgentTimelineItem } from "../../../agent-sdk-types.js";
import type { SubagentObservation } from "./observation.js";
/**
 * Rebuilds subagent observations from a persisted session, producing the same vocabulary the
 * live task-protocol source produces. Identical observations in means identical descriptor
 * state out, so a fact is derived once for both paths rather than once per path.
 *
 * Claude Code writes each subagent as `<session>/subagents/agent-<agentId>.jsonl` beside an
 * `agent-<agentId>.meta.json`. The meta file carries the Task `tool_use_id`, which is the same
 * canonical id the live stream uses — it is the bridge that lets the two paths agree.
 */
declare const ClaudeSubagentMetaSchema: z.ZodObject<{
    agentType: z.ZodCatch<z.ZodOptional<z.ZodString>>;
    description: z.ZodCatch<z.ZodOptional<z.ZodString>>;
    toolUseId: z.ZodCatch<z.ZodOptional<z.ZodString>>;
    spawnDepth: z.ZodCatch<z.ZodOptional<z.ZodNumber>>;
}, z.core.$strip>;
export type ClaudeSubagentMeta = z.infer<typeof ClaudeSubagentMetaSchema>;
/**
 * Parse a sidecar meta file. This is undocumented Claude Code internals, so every field is
 * optional and a malformed file is indistinguishable from an absent one: callers fall back to
 * the parent-transcript derivation rather than losing the subagent.
 */
export declare function parseClaudeSubagentMeta(contents: string): ClaudeSubagentMeta | null;
export interface ClaudeReplayEntry {
    type?: unknown;
    agentId?: unknown;
    timestamp?: unknown;
    /** Claude Code stamps the active effort on each assistant entry. */
    effort?: unknown;
    message?: {
        content?: unknown;
        [key: string]: unknown;
    };
    [key: string]: unknown;
}
export interface ClaudeReplaySubagentInput {
    agentId: string;
    meta: ClaudeSubagentMeta | null;
    entries: ClaudeReplayEntry[];
    /** Task declarations made by this subagent, used to attach its direct children. */
    parentFacts?: ClaudeReplayParentFacts;
}
export interface ClaudeReplayParentFacts {
    /** Task `tool_use` id -> identity declared in the parent's tool input. */
    toolCalls: ReadonlyMap<string, {
        title?: string;
        description?: string;
    }>;
    /** agentId -> tool call, recovered by scraping tool-result text. Legacy fallback only. */
    linksByAgentId: ReadonlyMap<string, {
        toolCallId: string;
        failed: boolean;
    }>;
    /** Task `tool_use` id -> outcome. Usable once meta.json supplies the link directly. */
    outcomesByToolCallId: ReadonlyMap<string, {
        failed: boolean;
    }>;
}
export declare function observeReplaySubagents(input: {
    subagents: readonly ClaudeReplaySubagentInput[];
    parent: ClaudeReplayParentFacts;
    convertEntry: (entry: ClaudeReplayEntry) => AgentTimelineItem[];
}): {
    observations: SubagentObservation[];
    toolOwners: ReadonlyMap<string, string>;
};
export {};
//# sourceMappingURL=replay-source.d.ts.map