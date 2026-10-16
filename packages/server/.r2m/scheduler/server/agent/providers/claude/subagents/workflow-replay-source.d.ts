import { z } from "zod";
import type { AgentTimelineItem } from "../../../agent-sdk-types.js";
import type { SubagentObservation } from "./observation.js";
import type { ClaudeReplayEntry } from "./replay-source.js";
declare const ClaudeWorkflowRunSchema: z.ZodObject<{
    runId: z.ZodString;
    timestamp: z.ZodCatch<z.ZodOptional<z.ZodString>>;
    summary: z.ZodCatch<z.ZodOptional<z.ZodString>>;
    workflowName: z.ZodCatch<z.ZodOptional<z.ZodString>>;
    status: z.ZodCatch<z.ZodOptional<z.ZodString>>;
    startTime: z.ZodCatch<z.ZodOptional<z.ZodNumber>>;
    defaultModel: z.ZodCatch<z.ZodOptional<z.ZodString>>;
    totalTokens: z.ZodCatch<z.ZodOptional<z.ZodNumber>>;
    result: z.ZodOptional<z.ZodUnknown>;
}, z.core.$strip>;
export type ClaudeWorkflowRun = z.infer<typeof ClaudeWorkflowRunSchema>;
export interface ClaudeWorkflowParentEntry {
    message?: {
        content?: unknown;
    };
}
export declare function parseClaudeWorkflowRun(contents: string): ClaudeWorkflowRun | null;
/**
 * Rebuild workflow rows from Claude's persisted run summaries.
 *
 * The parent tool result links a Workflow tool-use id to a run id. The run summary owns the
 * terminal outcome and presentation facts. A nonterminal summary cannot still be live after the
 * provider runtime was recreated, so replay terminalizes it as failed instead of resurrecting a
 * row that can never receive another update.
 */
export declare function observeReplayWorkflows(input: {
    workflows: readonly ClaudeWorkflowRun[];
    parentEntries: readonly ClaudeWorkflowParentEntry[];
    entriesByRunId?: ReadonlyMap<string, readonly ClaudeReplayEntry[]>;
    convertEntry?: (entry: ClaudeReplayEntry) => AgentTimelineItem[];
}): SubagentObservation[];
export {};
//# sourceMappingURL=workflow-replay-source.d.ts.map