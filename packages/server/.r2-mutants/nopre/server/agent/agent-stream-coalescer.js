import { mergeToolCallItems } from "./timeline-projection.js";
export const AGENT_STREAM_COALESCE_DEFAULT_WINDOW_MS = 60;
function isCoalescableTimelineEvent(event) {
    return (event.type === "timeline" &&
        (event.item.type === "assistant_message" ||
            event.item.type === "reasoning" ||
            event.item.type === "tool_call"));
}
function isTextTimelineItem(item) {
    return item.type === "assistant_message" || item.type === "reasoning";
}
function isTerminalToolCall(item) {
    return (item.type === "tool_call" &&
        (item.status === "completed" || item.status === "failed" || item.status === "canceled"));
}
function isSameTextStream(previous, next) {
    if (previous.item.type !== next.item.type) {
        return false;
    }
    if (previous.item.type === "assistant_message" && next.item.type === "assistant_message") {
        return previous.item.messageId === next.item.messageId;
    }
    return true;
}
export class AgentStreamCoalescer {
    constructor(options) {
        this.buffers = new Map();
        this.windowMs = options.windowMs ?? AGENT_STREAM_COALESCE_DEFAULT_WINDOW_MS;
        this.timers = options.timers;
        this.now = options.now ?? Date.now;
        this.onFlush = options.onFlush;
    }
    handle(agentId, event) {
        if (!isCoalescableTimelineEvent(event)) {
            return false;
        }
        if (isTextTimelineItem(event.item) && event.item.text === "") {
            return true;
        }
        const buffer = this.getOrCreateBuffer(agentId);
        this.appendToBuffer(buffer, event);
        if (isTerminalToolCall(event.item)) {
            this.flushBuffer(agentId);
            return true;
        }
        // Leading edge: the first event after an idle window flushes synchronously so
        // the first token of a turn isn't delayed a full window. Sustained bursts fall
        // through to the trailing timer, which keeps the message rate at one per
        // window. Same shape as TerminalOutputCoalescer.
        if (!buffer.timer) {
            const elapsed = buffer.lastFlushAt === null ? Number.POSITIVE_INFINITY : this.now() - buffer.lastFlushAt;
            if (elapsed >= this.windowMs) {
                this.flushBuffer(agentId);
                return true;
            }
            this.scheduleFlush(buffer);
        }
        return true;
    }
    flushFor(agentId) {
        this.flushBuffer(agentId);
    }
    flushAll() {
        for (const agentId of Array.from(this.buffers.keys())) {
            this.flushBuffer(agentId);
        }
    }
    flushAndDiscard(agentId) {
        this.flushBuffer(agentId);
        const buffer = this.buffers.get(agentId);
        if (buffer) {
            this.clearTimer(buffer);
            this.buffers.delete(agentId);
        }
    }
    getOrCreateBuffer(agentId) {
        const existing = this.buffers.get(agentId);
        if (existing) {
            return existing;
        }
        const buffer = {
            agentId,
            entries: [],
            toolCallEntryIndexes: new Map(),
            timer: null,
            flushing: false,
            lastFlushAt: null,
        };
        this.buffers.set(agentId, buffer);
        return buffer;
    }
    appendToBuffer(buffer, event) {
        if (isTextTimelineItem(event.item)) {
            buffer.entries.push({
                kind: "text",
                item: event.item,
                text: event.item.text,
                provider: event.provider,
                ...(event.turnId !== undefined ? { turnId: event.turnId } : {}),
            });
            return;
        }
        const existingIndex = buffer.toolCallEntryIndexes.get(event.item.callId);
        const existing = existingIndex !== undefined ? buffer.entries[existingIndex] : undefined;
        // Merge rather than replace, so an update that carries less (an unknown detail after a
        // labeled one) cannot erase what the timeline would have kept had both been flushed.
        let item = event.item;
        if (existing?.kind === "tool_call") {
            item = mergeToolCallItems(existing.item, event.item);
        }
        const entry = {
            kind: "tool_call",
            item,
            provider: event.provider,
            ...(event.turnId !== undefined ? { turnId: event.turnId } : {}),
        };
        if (existingIndex !== undefined) {
            buffer.entries[existingIndex] = entry;
            return;
        }
        buffer.toolCallEntryIndexes.set(event.item.callId, buffer.entries.length);
        buffer.entries.push(entry);
    }
    scheduleFlush(buffer) {
        const timer = this.timers.setTimeout(() => {
            this.flushBuffer(buffer.agentId, buffer);
        }, this.windowMs);
        timer.unref?.();
        buffer.timer = timer;
    }
    clearTimer(buffer) {
        if (!buffer.timer) {
            return;
        }
        this.timers.clearTimeout(buffer.timer);
        buffer.timer = null;
    }
    flushBuffer(agentId, expectedBuffer) {
        const buffer = this.buffers.get(agentId);
        if (!buffer) {
            return;
        }
        if (expectedBuffer && buffer !== expectedBuffer) {
            return;
        }
        if (buffer.flushing) {
            return;
        }
        this.clearTimer(buffer);
        if (buffer.entries.length === 0) {
            return;
        }
        const entries = buffer.entries;
        buffer.entries = [];
        buffer.toolCallEntryIndexes.clear();
        buffer.flushing = true;
        buffer.lastFlushAt = this.now();
        try {
            for (const entry of this.collapseEntries(entries)) {
                this.onFlush({
                    agentId,
                    item: entry.kind === "text"
                        ? {
                            ...entry.item,
                            text: entry.text,
                        }
                        : entry.item,
                    provider: entry.provider,
                    ...(entry.turnId !== undefined ? { turnId: entry.turnId } : {}),
                });
            }
        }
        finally {
            buffer.flushing = false;
        }
    }
    collapseEntries(entries) {
        const collapsed = [];
        for (const entry of entries) {
            const previous = collapsed.at(-1);
            if (previous &&
                previous.kind === "text" &&
                entry.kind === "text" &&
                isSameTextStream(previous, entry) &&
                previous.provider === entry.provider &&
                previous.turnId === entry.turnId) {
                previous.text += entry.text;
                continue;
            }
            collapsed.push({ ...entry });
        }
        return collapsed;
    }
}
//# sourceMappingURL=agent-stream-coalescer.js.map