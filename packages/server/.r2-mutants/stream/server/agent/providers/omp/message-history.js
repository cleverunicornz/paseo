import { mapCustomMessageToToolCall } from "../custom-message.js";
import { ompCustomMessageId, ompSkillPromptUserText, shouldDisplayOmpCustomMessage, } from "./custom-message.js";
import { mapToolDetail, parseToolArgs, parseToolResult, resolveToolCallName, toolFailureMessage, isOmpToolFailure, } from "./tool-call-detail.js";
function isTextContentBlock(block) {
    return (typeof block === "object" &&
        block !== null &&
        !Array.isArray(block) &&
        Reflect.get(block, "type") === "text" &&
        typeof Reflect.get(block, "text") === "string");
}
export function getUserMessageText(content) {
    if (typeof content === "string") {
        return content;
    }
    const textParts = [];
    for (const block of content) {
        if (isTextContentBlock(block)) {
            textParts.push(block.text);
        }
    }
    return textParts.join("\n\n");
}
export class OmpHistoryMapper {
    constructor(provider, userEntries = [], hooks = {}, bridgedTools = new Map()) {
        this.provider = provider;
        this.userEntries = userEntries;
        this.hooks = hooks;
        this.bridgedTools = bridgedTools;
        this.pendingToolCalls = new Map();
        this.userIndex = 0;
        this.assistantIndex = 0;
        this.customIndex = 0;
    }
    mapMessages(messages) {
        const events = [];
        for (const message of messages) {
            switch (message.role) {
                case "user":
                    events.push(...this.mapUserMessage(message));
                    break;
                case "custom":
                    events.push(...this.mapCustomMessage(message));
                    break;
                case "assistant":
                    events.push(...this.mapAssistantMessage(message));
                    break;
                case "toolResult": {
                    const event = this.mapToolResultMessage(message);
                    if (event) {
                        events.push(event);
                    }
                    break;
                }
                case "bashExecution":
                    events.push(this.mapBashExecutionMessage(message));
                    break;
            }
        }
        return events;
    }
    mapUserMessage(message) {
        const text = getUserMessageText(message.content);
        this.userIndex += 1;
        if (!text) {
            return [];
        }
        const userEntry = this.userEntries[this.userIndex - 1];
        return [
            {
                type: "timeline",
                provider: this.provider,
                item: {
                    type: "user_message",
                    text,
                    ...(userEntry ? { messageId: userEntry.id } : {}),
                },
            },
        ];
    }
    mapCustomMessage(message) {
        if (!shouldDisplayOmpCustomMessage(message)) {
            return [];
        }
        const text = getUserMessageText(message.content);
        const mappedEvent = text ? this.hooks.mapCustomMessage?.(message, text, this.provider) : null;
        if (mappedEvent) {
            return [mappedEvent];
        }
        if (!text) {
            return [];
        }
        const messageId = ompCustomMessageId(message, () => {
            this.customIndex += 1;
            return this.customIndex;
        });
        const skillPrompt = ompSkillPromptUserText(message);
        if (skillPrompt) {
            return [
                {
                    type: "timeline",
                    provider: this.provider,
                    item: { type: "user_message", text: skillPrompt, messageId: `${messageId}-user` },
                },
            ];
        }
        return [
            {
                type: "timeline",
                provider: this.provider,
                item: mapCustomMessageToToolCall(message, text, messageId),
            },
        ];
    }
    mapAssistantMessage(message) {
        const events = [];
        this.assistantIndex += 1;
        const messageId = message.responseId || `${this.provider}-history-assistant-${this.assistantIndex}`;
        for (const content of message.content) {
            if (content.type === "text" && content.text) {
                events.push({
                    type: "timeline",
                    provider: this.provider,
                    item: { type: "assistant_message", text: content.text, messageId },
                });
                continue;
            }
            if (content.type === "thinking" && content.thinking) {
                events.push({
                    type: "timeline",
                    provider: this.provider,
                    item: { type: "reasoning", text: content.thinking },
                });
                continue;
            }
            if (content.type === "toolCall") {
                const tracked = parseToolArgs(content.name, content.arguments);
                this.pendingToolCalls.set(content.id, tracked);
                const detail = this.mapToolDetail(content.id, tracked, null);
                if (!detail) {
                    continue;
                }
                events.push({
                    type: "timeline",
                    provider: this.provider,
                    item: {
                        type: "tool_call",
                        callId: this.resolveToolCallId(content.id, tracked),
                        name: this.toolName(tracked, null),
                        status: "running",
                        detail,
                        error: null,
                    },
                });
            }
        }
        return events;
    }
    mapToolResultMessage(message) {
        const tracked = this.pendingToolCalls.get(message.toolCallId) ?? parseToolArgs(message.toolName, null);
        this.pendingToolCalls.delete(message.toolCallId);
        const result = parseToolResult({ content: message.content, details: message.details });
        const detail = this.mapToolDetail(message.toolCallId, tracked, result);
        if (!detail) {
            return null;
        }
        return {
            type: "timeline",
            provider: this.provider,
            item: toToolResultTimelineItem({
                callId: this.resolveToolCallId(message.toolCallId, tracked),
                name: this.toolName(tracked, result),
                isError: isOmpToolFailure(tracked, result, Boolean(message.isError)),
                detail,
                errorText: toolFailureMessage(result),
            }),
        };
    }
    mapBashExecutionMessage(message) {
        const detail = {
            type: "shell",
            command: message.command,
            output: message.output,
            exitCode: message.exitCode ?? null,
        };
        return {
            type: "timeline",
            provider: this.provider,
            item: {
                type: "tool_call",
                callId: `omp-bash-${message.timestamp}`,
                name: "bash",
                status: message.cancelled ? "canceled" : "completed",
                detail,
                error: null,
            },
        };
    }
    resolveToolCallId(toolCallId, toolCall) {
        return this.hooks.resolveToolCallId?.(toolCallId, toolCall) ?? toolCallId;
    }
    mapToolDetail(toolCallId, toolCall, result) {
        const hook = this.hooks.mapToolDetail;
        return hook
            ? hook(toolCall, result, {
                toolCallId,
                bridgedTool: this.bridgedTools.get(toolCall.toolName),
            })
            : mapToolDetail(toolCall, result);
    }
    toolName(toolCall, result) {
        const bridged = this.bridgedTools.get(toolCall.toolName);
        return bridged ? `${bridged.server} / ${bridged.tool}` : resolveToolCallName(toolCall, result);
    }
}
export async function* streamOmpCoreHistory(provider, messages, userEntries = [], hooks = {}) {
    const mapper = new OmpHistoryMapper(provider, userEntries, hooks);
    for (const event of mapper.mapMessages(messages)) {
        if (event) {
            yield event;
        }
    }
}
function toToolResultTimelineItem(input) {
    if (input.isError) {
        return {
            type: "tool_call",
            callId: input.callId,
            name: input.name,
            status: "failed",
            detail: input.detail,
            error: input.errorText,
        };
    }
    return {
        type: "tool_call",
        callId: input.callId,
        name: input.name,
        status: "completed",
        detail: input.detail,
        error: null,
    };
}
//# sourceMappingURL=message-history.js.map