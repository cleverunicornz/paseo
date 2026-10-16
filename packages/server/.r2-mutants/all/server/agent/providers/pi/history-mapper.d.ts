import type { AgentStreamEvent, ToolCallDetail } from "../../agent-sdk-types.js";
import { type PiExtensionHost } from "./extensions/index.js";
import type { PiAgentMessage, PiImageContent, PiTextContent } from "./rpc-types.js";
import { type PiToolResult, type PiTrackedToolCall } from "./tool-call-mapper.js";
export interface PiCapturedUserMessageEntry {
    id: string;
    text: string;
}
export interface PiHistoryMapperHooks {
    mapCustomMessage?: (text: string, provider: string) => Extract<AgentStreamEvent, {
        type: "timeline";
    }> | null;
    resolveToolCallId?: (toolCallId: string, toolCall: PiTrackedToolCall) => string;
    mapToolDetail?: (toolCall: PiTrackedToolCall, result: PiToolResult, context: {
        toolCallId: string;
    }) => ToolCallDetail | null;
}
export declare function getUserMessageText(content: string | (PiTextContent | PiImageContent)[]): string;
export declare class PiHistoryMapper {
    private readonly provider;
    private readonly userEntries;
    private readonly hooks;
    private readonly extensionHost;
    private readonly pendingToolCalls;
    private readonly hydrations;
    private userIndex;
    private assistantIndex;
    private customIndex;
    constructor(provider: string, userEntries?: readonly PiCapturedUserMessageEntry[], hooks?: PiHistoryMapperHooks, extensionHost?: PiExtensionHost);
    mapMessages(messages: readonly PiAgentMessage[]): AgentStreamEvent[];
    hydrate(): Promise<AgentStreamEvent[]>;
    private mapUserMessage;
    private mapCustomMessage;
    private mapAssistantMessage;
    private mapToolResultMessage;
    private extensionEvents;
    private mapBashExecutionMessage;
    private resolveToolCallId;
    private mapToolDetail;
}
export declare function streamPiHistory(provider: string, messages: PiAgentMessage[], userEntries?: readonly PiCapturedUserMessageEntry[], hooks?: PiHistoryMapperHooks, extensionHost?: PiExtensionHost, signal?: AbortSignal): AsyncGenerator<AgentStreamEvent>;
//# sourceMappingURL=history-mapper.d.ts.map