import type { AgentTimelineItem } from "../agent-sdk-types.js";
/** Preserve extension context as an expandable tool row instead of assistant speech. */
export declare function mapCustomMessageToToolCall(message: {
    role: "custom";
    customType?: unknown;
    details?: unknown;
}, text: string, callId: string): Extract<AgentTimelineItem, {
    type: "tool_call";
}>;
//# sourceMappingURL=custom-message.d.ts.map