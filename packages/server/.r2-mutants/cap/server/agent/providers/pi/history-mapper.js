import { mapCustomMessageToToolCall } from "../custom-message.js";
import { createPiExtensionHost, } from "./extensions/index.js";
import { extractTextFromToolResult, mapToolDetail, parseToolArgs, parseToolResult, } from "./tool-call-mapper.js";
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
export class PiHistoryMapper {
    constructor(provider, userEntries = [], hooks = {}, extensionHost = createPiExtensionHost()) {
        this.provider = provider;
        this.userEntries = userEntries;
        this.hooks = hooks;
        this.extensionHost = extensionHost;
        this.pendingToolCalls = new Map();
        this.hydrations = [];
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
                    events.push(...this.mapToolResultMessage(message));
                    break;
                }
                case "bashExecution":
                    events.push(this.mapBashExecutionMessage(message));
                    break;
            }
        }
        return events;
    }
    async hydrate() {
        return (await Promise.all(this.hydrations)).flat();
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
        const extensionMapping = this.extensionHost.mapCustomMessage(message);
        const extensionEvents = this.extensionEvents(extensionMapping);
        if (message.display === false)
            return extensionEvents;
        const text = getUserMessageText(message.content);
        const mappedEvent = text ? this.hooks.mapCustomMessage?.(text, this.provider) : null;
        if (mappedEvent) {
            return [...extensionEvents, mappedEvent];
        }
        return [
            ...extensionEvents,
            ...(text
                ? [
                    {
                        type: "timeline",
                        provider: this.provider,
                        item: mapCustomMessageToToolCall(message, text, `${this.provider}-custom-${++this.customIndex}`),
                    },
                ]
                : []),
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
                const mapping = this.extensionHost.mapToolCall({
                    callId: content.id,
                    toolName: tracked.toolName,
                    args: tracked.args,
                    status: "running",
                    result: null,
                });
                const detail = this.mapToolDetail(content.id, tracked, null, mapping?.detail);
                if (!detail) {
                    continue;
                }
                events.push({
                    type: "timeline",
                    provider: this.provider,
                    item: {
                        type: "tool_call",
                        callId: this.resolveToolCallId(content.id, tracked),
                        name: mapping?.name ?? tracked.toolName,
                        status: "running",
                        detail,
                        error: null,
                    },
                });
                events.push(...this.extensionEvents(mapping));
            }
        }
        return events;
    }
    mapToolResultMessage(message) {
        const tracked = this.pendingToolCalls.get(message.toolCallId) ?? parseToolArgs(message.toolName, null);
        this.pendingToolCalls.delete(message.toolCallId);
        const result = parseToolResult({ content: message.content, details: message.details });
        const mapping = this.extensionHost.mapToolCall({
            callId: message.toolCallId,
            toolName: tracked.toolName,
            args: tracked.args,
            status: message.isError ? "failed" : "completed",
            result,
        });
        const detail = this.mapToolDetail(message.toolCallId, tracked, result, mapping?.detail);
        if (!detail) {
            return [];
        }
        return [
            {
                type: "timeline",
                provider: this.provider,
                item: toToolResultTimelineItem({
                    callId: this.resolveToolCallId(message.toolCallId, tracked),
                    name: mapping?.name ?? tracked.toolName,
                    isError: Boolean(message.isError),
                    detail,
                    errorText: extractTextFromToolResult(result) ?? "Tool call failed",
                }),
            },
            ...this.extensionEvents(mapping),
        ];
    }
    extensionEvents(mapping) {
        if (!mapping)
            return [];
        this.hydrations.push(mapping.hydration);
        return mapping.events;
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
                callId: `pi-bash-${message.timestamp}`,
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
    mapToolDetail(toolCallId, toolCall, result, extensionDetail) {
        const hook = this.hooks.mapToolDetail;
        return hook
            ? hook(toolCall, result, { toolCallId })
            : (extensionDetail ?? mapToolDetail(toolCall, result));
    }
}
export async function* streamPiHistory(provider, messages, userEntries = [], hooks = {}, 
// At most eight 2 MiB child files per replay; remaining cards keep their summaries.
extensionHost = createPiExtensionHost(undefined, undefined, 16 * 1024 * 1024), signal) {
    const mapper = new PiHistoryMapper(provider, userEntries, hooks, extensionHost);
    for (const event of mapper.mapMessages(messages)) {
        if (signal?.aborted)
            return;
        if (event) {
            yield event;
        }
    }
    for (const event of await mapper.hydrate()) {
        if (signal?.aborted)
            return;
        yield event;
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
//# sourceMappingURL=history-mapper.js.map