import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { AgentMetadata } from "../../../agent-sdk-types.js";
import type { SubagentObservation } from "./observation.js";
/**
 * The subset of a hook input this source reads. Every hook shares these base fields: `agent_id`
 * is set when the hook fires from inside a subagent, and `effort.level` is the ACTIVE level for
 * that turn, after any silent downgrade for the selected model.
 */
export interface ClaudeHookObservationInput {
    agent_id?: unknown;
    agent_type?: unknown;
    effort?: {
        level?: unknown;
    } | undefined;
}
export interface ClaudeTaskProtocolSourceInput {
    /**
     * The parent's Task tool input, by tool_use id.
     *
     * `task_started` announces `subagent_type`, but the Task call itself may also carry an explicit
     * `name`, and the replay source prefers that name over the type. Reading the same field from the
     * same place is what keeps one subagent titled identically live and on reopen.
     */
    getToolInput?: (toolUseId: string) => AgentMetadata | null | undefined;
    /** Reads the safe, provider-owned result from a completed workflow's task output file. */
    readWorkflowResult?: (outputFile: string) => string | undefined;
}
export declare class ClaudeTaskProtocolSource {
    /** task_id -> canonical subagent id (the Task tool_use id). Populated by task_started. */
    private readonly subagentIdByTaskId;
    /** Every announced tool id -> the first tool id that publicly identifies the child. */
    private readonly canonicalIdByToolUseId;
    /** Tool calls made inside a sidechain, keyed to the direct child that emitted them. */
    private readonly ownerSubagentIdByToolUseId;
    /** Announced tasks inherit the owner recorded for their tool call, including local_bash. */
    private readonly ownerSubagentIdByTaskId;
    /**
     * Every subagent id this source declared. It is the source's whole vocabulary: an id that is
     * not in here was either filtered at declaration or never announced, and this source has
     * nothing to say about it.
     */
    private readonly declaredIds;
    /** Task ids declared specifically as workflows; only these may read workflow output files. */
    private readonly workflowTaskIds;
    /** Last result emitted per workflow task, so duplicate terminal notifications stay idempotent. */
    private readonly lastWorkflowResultByTaskId;
    /** Workflow invocations already own a real Workflow card in the parent timeline. */
    private readonly idsWithExistingParentToolCard;
    /**
     * Declared subagents running in the background, whether spawned there or moved there later.
     * They outlive the turn that spawned them, so a turn ending is not evidence that they stopped.
     */
    private readonly backgroundedIds;
    /** Last status emitted per subagent, so a redundant announcement is not re-broadcast. */
    private readonly lastStatusById;
    /** Claude facts stay inside the provider boundary; clients receive one compact subtitle. */
    private readonly presentationById;
    private readonly lastSubtitleById;
    private sawTaskStarted;
    private sawAnyTask;
    private readonly getToolInput;
    private readonly readWorkflowResult;
    constructor(input?: ClaudeTaskProtocolSourceInput);
    /**
     * True once this session has announced at least one task. Older Claude Code releases predate
     * the task protocol; callers use this to decide whether the legacy derivation still has work
     * to do, rather than assuming a version.
     */
    get isActive(): boolean;
    /**
     * True once this session announced any task at all, including the ones filtered out.
     *
     * Deliberately not `isActive`: that one answers "does a declarative owner exist for subagent
     * descriptors", and stays false in a session whose only tasks were rejected. This one answers
     * "does this CLI announce its tasks" — and once it does, every task is announced, so a frame
     * for an id that was never declared is provably work the filter refused rather than something
     * this source has yet to hear about.
     */
    get announcesTasks(): boolean;
    /**
     * Whether this source declared the given subagent. Callers route frames through this before
     * attributing anything to an id: a frame for a task that was never declared belongs to work
     * the declaration filter already rejected.
     */
    isDeclared(subagentId: string): boolean;
    /** Resolve a Claude tool id to the provider descriptor id that owns its state and timeline. */
    resolveSubagentId(toolUseId: string): string | undefined;
    /** Whether Claude's task protocol declared this task as a provider subagent. */
    isDeclaredTask(taskId: string): boolean;
    /** Resolve a non-subagent task (for example local_bash) to its emitting sidechain. */
    resolveTaskOwner(taskId: string, toolUseId?: string): string | undefined;
    needsSyntheticParentToolCard(subagentId: string): boolean;
    observe(message: SDKMessage): SubagentObservation[];
    /**
     * Forget the session.
     *
     * Task ids are session-scoped and outlive any single turn, so this belongs to session teardown
     * alone. Clearing it when a turn ends would drop the routing table while its tasks were still
     * live — see `cancelRunningForegroundTasks`, which is what a turn ending actually warrants.
     */
    reset(): void;
    /**
     * Terminalize the subagents that a canceled turn was running.
     *
     * Cancellation is a fact about the turn, not about the task table: the session, and every id in
     * it, outlives the turn. So this reports statuses and leaves the routing intact — that is what
     * lets a child which settles after the interrupt still find its descriptor, and what keeps a
     * later `task_notification` free to correct this guess.
     *
     * Backgrounded children are skipped. Being backgrounded is precisely the declaration that they
     * outlive the turn; everything else was running in the foreground and died with it.
     */
    cancelRunningForegroundTasks(): SubagentObservation[];
    /** A lost Claude process terminates every task it owned, including backgrounded workflows. */
    failRunningTasks(): SubagentObservation[];
    private observeTaskStarted;
    private observeExistingTaskStart;
    private observeNewTaskStart;
    private observeTaskUpdated;
    private recordBackgrounded;
    private observeTaskNotification;
    private observeWorkflowResult;
    /**
     * `task_progress` fires once per tool use, not on a timer, so this is an accurate live cost
     * signal rather than a sampled one. It matters most for backgrounded subagents, which emit no
     * sidechain frames at all and would otherwise show no activity while they work.
     */
    private observeTaskProgress;
    private observeUsage;
    /**
     * Effort as reported by a hook firing inside a subagent.
     *
     * This is the only live source: the message stream carries no effort at any depth, and the
     * value Paseo requested is not necessarily the one that ran, because a model that does not
     * support the requested level is silently downgraded. Hooks report the post-downgrade level.
     *
     * `agent_id` is the same id `task_started` calls `task_id`, so it routes through the table
     * already built at declaration — no second identity to reconcile.
     */
    observeHook(input: ClaudeHookObservationInput): SubagentObservation[];
    /**
     * The model the child is actually running, read off its own assistant frames.
     *
     * Routed through the declaration for the same reason status is: a frame carrying the tool_use
     * id of a task this source filtered out — ambient housekeeping or a workflow child — would
     * otherwise fold to an upsert with no
     * identity and a defaulted "running" status. That is the nameless, never-finishing row the
     * declaration filter exists to prevent, arriving by a different door.
     */
    observeSidechainFrame(message: SDKMessage, subagentId: string): SubagentObservation[];
    private updatePresentation;
    /**
     * Status is routed only through a task this source declared.
     *
     * `task_notification` also fires for the tasks deliberately filtered above, and it carries a
     * `tool_use_id`. Falling back to that id would readmit exactly what the filter rejected — as a
     * descriptor holding a status and no identity, which the track renders as a nameless row.
     * A status without a declaration describes nothing, so it is dropped.
     */
    private observeStatus;
}
//# sourceMappingURL=live-source.d.ts.map