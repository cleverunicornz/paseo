import { toAgentPayload } from "./agent/agent-projections.js";
import { AgentStreamEventPayloadSchema as AgentStreamEventPayloadRuntimeSchema } from "@getpaseo/protocol/messages";
export * from "@getpaseo/protocol/messages";
function validateStreamEventPayload(payload) {
    const parsed = AgentStreamEventPayloadRuntimeSchema.safeParse(payload);
    if (!parsed.success) {
        return null;
    }
    return parsed.data;
}
export function serializeAgentSnapshot(agent, options) {
    return toAgentPayload(agent, options);
}
export function serializeAgentStreamEvent(event) {
    if (event.type === "attention_required") {
        // Providers may emit attention_required without per-client notification context.
        // The websocket server emits attention_required with shouldNotify computed per client.
        // Normalize provider events so they satisfy the shared schema.
        return validateStreamEventPayload({
            type: "attention_required",
            provider: event.provider,
            reason: event.reason,
            timestamp: event.timestamp,
            shouldNotify: false,
        });
    }
    return validateStreamEventPayload(event);
}
//# sourceMappingURL=messages.js.map