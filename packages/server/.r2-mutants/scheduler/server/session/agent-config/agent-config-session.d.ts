import type pino from "pino";
import type { AgentProviderNotice } from "../../agent/agent-sdk-types.js";
import type { SessionInboundMessage, SessionOutboundMessage } from "../../messages.js";
export interface AgentConfigSessionHost {
    emit(msg: SessionOutboundMessage): void;
}
/**
 * The per-agent config mutations this subsystem drives. The shell adapts these
 * onto the AgentManager and loads a closed agent before mutation (mode still
 * routes through setAgentModeCommand); tests wire an in-memory fake. Mode and
 * thinking yield a provider notice; model and feature do not.
 */
export interface AgentConfigOperations {
    ensureLoaded(agentId: string): Promise<void>;
    setMode(agentId: string, modeId: string): Promise<AgentProviderNotice | null>;
    setModel(agentId: string, modelId: string | null): Promise<void>;
    setFeature(agentId: string, featureId: string, value: unknown): Promise<void>;
    setThinking(agentId: string, thinkingOptionId: string | null): Promise<AgentProviderNotice | null>;
}
export interface AgentConfigSessionOptions {
    host: AgentConfigSessionHost;
    operations: AgentConfigOperations;
    logger: pino.Logger;
}
/**
 * A client's per-agent config surface: set mode, model, feature, or thinking
 * option one at a time, or apply all of them together. Each request shares one
 * envelope — log, run the mutation, then emit the accepted response, or on
 * failure emit an activity_log error frame followed by the rejected response.
 * Reaches no state beyond the injected operations and the outbound channel.
 */
export declare class AgentConfigSession {
    private readonly host;
    private readonly operations;
    private readonly logger;
    constructor(options: AgentConfigSessionOptions);
    handleSetAgentModeRequest(msg: Extract<SessionInboundMessage, {
        type: "set_agent_mode_request";
    }>): Promise<void>;
    handleSetAgentModelRequest(msg: Extract<SessionInboundMessage, {
        type: "set_agent_model_request";
    }>): Promise<void>;
    handleSetAgentFeatureRequest(msg: Extract<SessionInboundMessage, {
        type: "set_agent_feature_request";
    }>): Promise<void>;
    handleSetAgentThinkingRequest(msg: Extract<SessionInboundMessage, {
        type: "set_agent_thinking_request";
    }>): Promise<void>;
    handleAgentConfigApplyRequest(msg: Extract<SessionInboundMessage, {
        type: "agent.config.apply.request";
    }>): Promise<void>;
    /**
     * Model first, because a thinking option only means anything against the model
     * that offers it; features last so they settle on top of the rest. An omitted
     * field is left alone. The first notice produced is the one the client sees —
     * later steps still run, so a notice never truncates the bundle.
     *
     * This is not a transaction. A step that rejects aborts the rest, and steps
     * that already applied stay applied — provider setters validate against the
     * agent's live model, so a bundle that omits `modelId` can have its mode land
     * and its feature rejected. Nothing is hidden by that: every AgentManager
     * setter emits agent state before returning, so what applied is already
     * streamed to the client alongside the rejected response and the error frame.
     *
     * Rolling back would re-invoke the setters that just failed, most often
     * against a session that is already gone. Pre-flight validation would restate
     * each provider's model-dependent checks somewhere they would drift from the
     * setters that own them. What sending the bundle in one request does remove is
     * the multi-round-trip failure class: interruption between hops, and
     * interleaving with another client's mutation.
     */
    private applyBundle;
    private applyConfigChange;
}
//# sourceMappingURL=agent-config-session.d.ts.map