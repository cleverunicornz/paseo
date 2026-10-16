import type { Logger } from "pino";
import type { AgentPromptInput, AgentRunOptions } from "./agent-sdk-types.js";
import type { AgentManager, ManagedAgent } from "./agent-manager.js";
import type { AgentStorage } from "./agent-storage.js";
import type { ActiveTurnBehavior } from "@getpaseo/protocol/messages";
export type AgentUnarchiveController = Pick<AgentManager, "notifyAgentState" | "unarchiveSnapshot">;
export type AgentRunController = Pick<AgentManager, "getAgent" | "tryRunOutOfBand" | "hasInFlightRun" | "replaceAgentRun" | "steerOrReplaceActiveTurn" | "streamAgent"> & {
    reloadAgentSession(agentId: string): Promise<unknown>;
};
export interface StartAgentRunOptions {
    replaceRunning?: boolean;
    activeTurnBehavior?: ActiveTurnBehavior;
    runOptions?: AgentRunOptions;
    /** Ask the provider to deny permissions blocking this steer. */
    clearPendingPermissions?: boolean;
}
export type PromptDispatchDisposition = "out_of_band" | "steered" | "turn_started";
export declare function startAgentRun(agentManager: AgentRunController, agentId: string, prompt: AgentPromptInput, logger: Logger, options?: StartAgentRunOptions): Promise<{
    disposition: PromptDispatchDisposition;
}>;
/**
 * Clear the archived flag from a stored agent record.
 * Shared across Session (app/WS), MCP, and CLI so every surface that acts on
 * an archived agent unarchives it the same way.
 */
export declare function unarchiveAgentState(_agentStorage: AgentStorage, agentManager: AgentUnarchiveController, agentId: string, updates?: {
    workspaceId?: string;
    labels?: Record<string, string | null>;
}): Promise<boolean>;
/**
 * Wrap a body in <paseo-system>…</paseo-system> so the receiving agent
 * recognizes the prompt as system-injected context — not a user turn.
 * Used by chat mentions, schedule fires, and notify-on-finish.
 */
export declare function formatSystemNotificationPrompt(reason: string): string;
export declare function isSystemInjectedEnvelope(text: string): boolean;
export interface SendPromptToAgentParams {
    agentManager: AgentManager;
    agentStorage: AgentStorage;
    agentId: string;
    /** Prompt to dispatch to the provider (may include image blocks or wrapped text). */
    prompt: AgentPromptInput;
    messageId?: string;
    activeTurnBehavior?: ActiveTurnBehavior;
    runOptions?: AgentRunOptions;
    /** Optional mode to set on the agent before the run starts. */
    sessionMode?: string;
    /**
     * Default true. When false, archived agents are skipped instead of being
     * unarchived. Use false for system-injected prompts (chat mentions,
     * schedule fires, notify-on-finish).
     */
    unarchive?: boolean;
    /** See {@link StartAgentRunOptions.clearPendingPermissions}. */
    clearPendingPermissions?: boolean;
    logger: Logger;
}
export interface StartCreatedAgentInitialPromptParams {
    agentManager: AgentManager;
    agentId: string;
    snapshot?: ManagedAgent;
    prompt: AgentPromptInput | null;
    runOptions?: AgentRunOptions;
    logger: Logger;
}
export declare function waitForAgentRunStartWithTimeout(agentManager: AgentManager, agentId: string, signal?: AbortSignal): Promise<void>;
/**
 * Full send-prompt orchestration: (optional unarchive) → load → (optional
 * mode change) → start run.
 *
 * Every surface that sends a prompt to an agent (Session/WS, MCP, CLI-through-MCP,
 * chat mentions, notify-on-finish) MUST go through this so behavior can never
 * drift between them.
 *
 * When `unarchive` is false and the agent is archived, the call is a silent
 * no-op (returns the normal turn-start disposition) — the agent is not run.
 */
export declare function sendPromptToAgent(params: SendPromptToAgentParams): Promise<{
    disposition: PromptDispatchDisposition;
}>;
export declare function startCreatedAgentInitialPrompt(params: StartCreatedAgentInitialPromptParams): Promise<ManagedAgent>;
export interface SetupFinishNotificationParams {
    agentManager: AgentManager;
    agentStorage: AgentStorage;
    childAgentId: string;
    callerAgentId: string;
    requireParentOwnership?: boolean;
    logger: Logger;
}
export declare function setupFinishNotification(params: SetupFinishNotificationParams): void;
//# sourceMappingURL=agent-prompt.d.ts.map