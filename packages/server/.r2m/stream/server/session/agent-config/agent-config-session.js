import { v4 as uuidv4 } from "uuid";
import { getErrorMessage, getErrorMessageOr } from "@getpaseo/protocol/error-utils";
/**
 * A client's per-agent config surface: set mode, model, feature, or thinking
 * option one at a time, or apply all of them together. Each request shares one
 * envelope — log, run the mutation, then emit the accepted response, or on
 * failure emit an activity_log error frame followed by the rejected response.
 * Reaches no state beyond the injected operations and the outbound channel.
 */
export class AgentConfigSession {
    constructor(options) {
        this.host = options.host;
        this.operations = options.operations;
        this.logger = options.logger;
    }
    handleSetAgentModeRequest(msg) {
        const { agentId, modeId, requestId } = msg;
        return this.applyConfigChange({
            agentId,
            requestId,
            logLabel: "set_agent_mode_request",
            logFields: { agentId, modeId, requestId },
            failureText: "Failed to set agent mode",
            run: () => this.operations.setMode(agentId, modeId),
            emitResponse: (payload) => this.host.emit({ type: "set_agent_mode_response", payload }),
        });
    }
    handleSetAgentModelRequest(msg) {
        const { agentId, modelId, requestId } = msg;
        return this.applyConfigChange({
            agentId,
            requestId,
            logLabel: "set_agent_model_request",
            logFields: { agentId, modelId, requestId },
            failureText: "Failed to set agent model",
            run: async () => {
                await this.operations.setModel(agentId, modelId);
                return undefined;
            },
            emitResponse: (payload) => this.host.emit({ type: "set_agent_model_response", payload }),
        });
    }
    handleSetAgentFeatureRequest(msg) {
        const { agentId, featureId, value, requestId } = msg;
        return this.applyConfigChange({
            agentId,
            requestId,
            logLabel: "set_agent_feature_request",
            logFields: { agentId, featureId, value, requestId },
            failureText: "Failed to set agent feature",
            run: async () => {
                await this.operations.setFeature(agentId, featureId, value);
                return undefined;
            },
            emitResponse: (payload) => this.host.emit({ type: "set_agent_feature_response", payload }),
        });
    }
    handleSetAgentThinkingRequest(msg) {
        const { agentId, thinkingOptionId, requestId } = msg;
        return this.applyConfigChange({
            agentId,
            requestId,
            logLabel: "set_agent_thinking_request",
            logFields: { agentId, thinkingOptionId, requestId },
            failureText: "Failed to set agent thinking option",
            run: () => this.operations.setThinking(agentId, thinkingOptionId),
            emitResponse: (payload) => this.host.emit({ type: "set_agent_thinking_response", payload }),
        });
    }
    handleAgentConfigApplyRequest(msg) {
        const { agentId, config, requestId } = msg;
        return this.applyConfigChange({
            agentId,
            requestId,
            logLabel: "agent.config.apply.request",
            logFields: { agentId, requestId, config },
            failureText: "Failed to apply agent config",
            run: () => this.applyBundle(agentId, config),
            emitResponse: (payload) => this.host.emit({ type: "agent.config.apply.response", payload }),
        });
    }
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
    async applyBundle(agentId, config) {
        let notice = null;
        if (config.modelId !== undefined) {
            await this.operations.setModel(agentId, config.modelId);
        }
        if (config.modeId !== undefined) {
            // Await first, assign second: `notice ??= await ...` would skip the call
            // entirely once an earlier step produced a notice.
            const modeNotice = await this.operations.setMode(agentId, config.modeId);
            notice ?? (notice = modeNotice);
        }
        if (config.thinkingOptionId !== undefined) {
            const thinkingNotice = await this.operations.setThinking(agentId, config.thinkingOptionId);
            notice ?? (notice = thinkingNotice);
        }
        for (const [featureId, value] of Object.entries(config.featureValues ?? {})) {
            await this.operations.setFeature(agentId, featureId, value);
        }
        return notice;
    }
    async applyConfigChange(change) {
        const { agentId, requestId, logLabel, logFields, failureText, run, emitResponse } = change;
        this.logger.info(logFields, `session: ${logLabel}`);
        try {
            await this.operations.ensureLoaded(agentId);
            const notice = await run();
            this.logger.info(logFields, `session: ${logLabel} success`);
            emitResponse({ requestId, agentId, accepted: true, error: null, notice });
        }
        catch (error) {
            this.logger.error({ err: error, ...logFields }, `session: ${logLabel} error`);
            this.host.emit({
                type: "activity_log",
                payload: {
                    id: uuidv4(),
                    timestamp: new Date(),
                    type: "error",
                    content: `${failureText}: ${getErrorMessage(error)}`,
                },
            });
            emitResponse({
                requestId,
                agentId,
                accepted: false,
                error: getErrorMessageOr(error, failureText),
            });
        }
    }
}
//# sourceMappingURL=agent-config-session.js.map