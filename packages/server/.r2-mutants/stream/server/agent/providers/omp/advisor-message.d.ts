import type { AgentTimelineItem } from "../../agent-sdk-types.js";
import type { OmpAgentMessage } from "./rpc-types.js";
type OmpCustomMessage = Extract<OmpAgentMessage, {
    role: "custom";
}>;
type OmpAdvisorToolCallItem = Extract<AgentTimelineItem, {
    type: "tool_call";
}>;
export declare function mapOmpAdvisorMessageToToolCall(message: OmpCustomMessage, text: string): OmpAdvisorToolCallItem | null;
export {};
//# sourceMappingURL=advisor-message.d.ts.map