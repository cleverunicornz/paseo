import type { AgentStreamEvent, ToolCallDetail } from "../../agent-sdk-types.js";
import type { OmpAgentMessage, OmpImageContent, OmpTextContent } from "./rpc-types.js";
import type { OmpBridgedToolIdentity } from "./mcp-bridge.js";
import { type OmpToolResult, type OmpTrackedToolCall } from "./tool-call-detail.js";
export interface OmpCapturedUserMessageEntry {
    id: string;
    text: string;
}
export interface OmpHistoryMapperHooks {
    mapCustomMessage?: (message: Extract<OmpAgentMessage, {
        role: "custom";
    }>, text: string, provider: string) => Extract<AgentStreamEvent, {
        type: "timeline";
    }> | null;
    resolveToolCallId?: (toolCallId: string, toolCall: OmpTrackedToolCall) => string;
    mapToolDetail?: (toolCall: OmpTrackedToolCall, result: OmpToolResult, context: {
        toolCallId: string;
        bridgedTool?: OmpBridgedToolIdentity;
    }) => ToolCallDetail | null;
}
export declare function getUserMessageText(content: string | (OmpTextContent | OmpImageContent)[]): string;
export declare class OmpHistoryMapper {
    private readonly provider;
    private readonly userEntries;
    private readonly hooks;
    private readonly bridgedTools;
    private readonly pendingToolCalls;
    private userIndex;
    private assistantIndex;
    private customIndex;
    constructor(provider: string, userEntries?: readonly OmpCapturedUserMessageEntry[], hooks?: OmpHistoryMapperHooks, bridgedTools?: ReadonlyMap<string, OmpBridgedToolIdentity>);
    mapMessages(messages: readonly OmpAgentMessage[]): AgentStreamEvent[];
    private mapUserMessage;
    private mapCustomMessage;
    private mapAssistantMessage;
    private mapToolResultMessage;
    private mapBashExecutionMessage;
    private resolveToolCallId;
    private mapToolDetail;
    private toolName;
}
export declare function streamOmpCoreHistory(provider: string, messages: OmpAgentMessage[], userEntries?: readonly OmpCapturedUserMessageEntry[], hooks?: OmpHistoryMapperHooks): AsyncGenerator<AgentStreamEvent>;
//# sourceMappingURL=message-history.d.ts.map