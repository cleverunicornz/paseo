import { mapOpencodeToolCall } from "../tool-call-mapper.js";
import { STRUCTURED_OUTPUT_TOOL } from "./structured-output.js";
function textPartKey(messageID, part, ordinal) {
    return `${messageID}:${part}:${ordinal}`;
}
// Text and reasoning each number parts from zero, independent of snapshot position.
export class V2Timeline {
    resetStreams() {
        this.streams.clear();
    }
    startPart(part) {
        this.streams.set(textPartKey(part.assistantMessageID, part.type, part.ordinal), "");
    }
    constructor(includeClientMessageId = true) {
        this.includeClientMessageId = includeClientMessageId;
        this.content = new Map();
        this.streams = new Map();
    }
    delta(event) {
        const key = textPartKey(event.assistantMessageID, event.type, event.ordinal);
        const streamed = this.streams.get(key);
        // Deltas are ephemeral and have no offset. After reconnect, only stream
        // parts whose start we observed; snapshots recover any interrupted part.
        if (streamed === undefined || event.delta.length === 0)
            return null;
        const text = streamed + event.delta;
        this.streams.set(key, text);
        const emitted = this.content.get(key) ?? "";
        if (text.length <= emitted.length)
            return null;
        if (!text.startsWith(emitted))
            throw new Error("OpenCode changed previously emitted message content");
        this.content.set(key, text);
        const suffix = text.slice(emitted.length);
        const item = event.type === "text"
            ? { type: "assistant_message", text: suffix, messageId: event.assistantMessageID }
            : { type: "reasoning", text: suffix };
        return { type: "timeline", provider: "opencode", item, timestamp: new Date().toISOString() };
    }
    messages(messages) {
        const events = [];
        const state = { structured: false, accepted: false };
        for (const message of messages) {
            const timestamp = new Date(message.time.created).toISOString();
            const push = (item) => events.push({ type: "timeline", provider: "opencode", item, timestamp });
            if (message.type === "user")
                this.userMessage(message, state, push);
            else if (message.type === "assistant")
                this.assistantMessage(message, state, push);
            else if (message.type === "compaction")
                this.compactionMessage(message, push);
        }
        return events;
    }
    userMessage(message, state, push) {
        state.structured = message.metadata?.paseoOutputSchema !== undefined;
        state.accepted = false;
        if (this.content.has(message.id))
            return;
        this.content.set(message.id, message.text);
        const clientMessageId = message.metadata?.paseoClientMessageId;
        push({
            type: "user_message",
            text: message.text,
            messageId: message.id,
            ...(this.includeClientMessageId && typeof clientMessageId === "string"
                ? { clientMessageId }
                : {}),
        });
    }
    assistantMessage(message, state, push) {
        // Snapshot parts are indexed by position in `message.content`, but deltas
        // number text and reasoning separately. Track a per-type ordinal so both
        // paths address the same cursor entry.
        let textOrdinal = 0;
        let reasoningOrdinal = 0;
        message.content.forEach((part, partIndex) => {
            if (part.type === "tool" && part.name === STRUCTURED_OUTPUT_TOOL) {
                this.structuredOutputPart(message.id, partIndex, part, state, push);
            }
            else if (part.type === "text" || part.type === "reasoning") {
                const ordinal = part.type === "text" ? textOrdinal++ : reasoningOrdinal++;
                this.textPart(message.id, part, ordinal, state, push);
            }
            else {
                this.toolPart(message.id, partIndex, part, push);
            }
        });
    }
    structuredOutputPart(messageID, partIndex, part, state, push) {
        if (!state.structured || state.accepted || part.state.status !== "completed")
            return;
        const value = part.state.metadata?.paseoStructuredOutput;
        if (value === undefined)
            return;
        state.accepted = true;
        const key = `${messageID}:${partIndex}`;
        const text = JSON.stringify(value);
        if (this.content.get(key) === text)
            return;
        this.content.set(key, text);
        push({ type: "assistant_message", text, messageId: messageID });
    }
    textPart(messageID, part, ordinal, state, push) {
        if (state.structured && part.type === "text")
            return;
        const key = textPartKey(messageID, part.type, ordinal);
        const previous = this.content.get(key) ?? "";
        // Upstream snapshots may briefly lag the volatile delta stream.
        if (part.text.length <= previous.length)
            return;
        if (!part.text.startsWith(previous))
            throw new Error("OpenCode changed previously emitted message content");
        this.content.set(key, part.text);
        const suffix = part.text.slice(previous.length);
        if (part.type === "text")
            push({ type: "assistant_message", text: suffix, messageId: messageID });
        else
            push({ type: "reasoning", text: suffix });
    }
    toolPart(messageID, partIndex, part, push) {
        const key = `${messageID}:${partIndex}`;
        const serialized = JSON.stringify(part);
        if (serialized === this.content.get(key))
            return;
        this.content.set(key, serialized);
        const item = toolFromV2(part);
        if (item)
            push(item);
    }
    compactionMessage(message, push) {
        const status = message.status === "running" ? "loading" : "completed";
        if (this.content.get(message.id) === status)
            return;
        this.content.set(message.id, status);
        push({ type: "compaction", status });
    }
}
function toolFromV2(tool) {
    const state = tool.state;
    const output = "content" in state
        ? state.content?.map((part) => (part.type === "text" ? part.text : part.uri)).join("\n")
        : undefined;
    return mapOpencodeToolCall({
        toolName: tool.name,
        callId: tool.id,
        input: state.input,
        status: state.status === "error" ? "failed" : state.status,
        output,
        error: state.status === "error" ? state.error : undefined,
        metadata: "metadata" in state ? state.metadata : undefined,
    });
}
//# sourceMappingURL=timeline.js.map