export class WebSocketRuntimeMetricsWindow {
    constructor(clock = Date.now) {
        this.clock = clock;
        this.counters = createRuntimeCounters();
        this.inboundMessageCounts = new Map();
        this.inboundSessionRequestCounts = new Map();
        this.outboundMessageCounts = new Map();
        this.outboundSessionMessageCounts = new Map();
        this.outboundAgentStreamCounts = new Map();
        this.outboundAgentStreamByAgentCounts = new Map();
        this.outboundBinaryFrameCounts = new Map();
        this.bufferedAmountSamples = [];
        this.requestLatencies = new Map();
        this.windowStartedAt = this.clock();
    }
    incrementCounter(counter) {
        this.counters[counter] += 1;
    }
    recordInboundMessage(type) {
        incrementCount(this.inboundMessageCounts, type);
    }
    recordInboundSessionRequest(type) {
        incrementCount(this.inboundSessionRequestCounts, type);
    }
    recordOutboundMessage(message, bufferedAmount) {
        if (message.type !== "session") {
            incrementCount(this.outboundMessageCounts, message.type);
            this.recordBufferedAmount(bufferedAmount);
            return;
        }
        incrementCount(this.outboundMessageCounts, "session_message");
        incrementCount(this.outboundSessionMessageCounts, message.message.type);
        if (message.message.type === "agent_stream") {
            this.recordOutboundAgentStreamMessage(message.message.payload);
        }
        this.recordBufferedAmount(bufferedAmount);
    }
    recordOutboundBinaryFrame(bufferedAmount) {
        incrementCount(this.outboundBinaryFrameCounts, "binary");
        this.recordBufferedAmount(bufferedAmount);
    }
    recordRequestLatency(type, durationMs) {
        let latencies = this.requestLatencies.get(type);
        if (!latencies) {
            latencies = [];
            this.requestLatencies.set(type, latencies);
        }
        latencies.push(durationMs);
    }
    snapshotAndReset() {
        const now = this.clock();
        const snapshot = {
            windowMs: Math.max(0, now - this.windowStartedAt),
            counters: { ...this.counters },
            inboundMessageTypesTop: getTopCounts(this.inboundMessageCounts, 12),
            inboundSessionRequestTypesTop: getTopCounts(this.inboundSessionRequestCounts, 20),
            outboundMessageTypesTop: getTopCounts(this.outboundMessageCounts, 12),
            outboundSessionMessageTypesTop: getTopCounts(this.outboundSessionMessageCounts, 20),
            outboundAgentStreamTypesTop: getTopCounts(this.outboundAgentStreamCounts, 20),
            outboundAgentStreamAgentsTop: getTopCounts(this.outboundAgentStreamByAgentCounts, 20),
            outboundBinaryFrameTypesTop: getTopCounts(this.outboundBinaryFrameCounts, 12),
            bufferedAmount: this.computeBufferedAmountStats(),
            latency: this.computeLatencyStats(),
        };
        this.reset(now);
        return snapshot;
    }
    recordOutboundAgentStreamMessage(payload) {
        const { agentId, event } = payload;
        const eventType = event.type === "timeline" ? `timeline:${event.item.type}` : event.type;
        incrementCount(this.outboundAgentStreamCounts, eventType);
        incrementCount(this.outboundAgentStreamByAgentCounts, agentId);
    }
    recordBufferedAmount(bufferedAmount) {
        if (typeof bufferedAmount !== "number") {
            return;
        }
        this.bufferedAmountSamples.push(bufferedAmount);
    }
    computeLatencyStats() {
        const stats = [];
        for (const [type, latencies] of this.requestLatencies) {
            if (latencies.length === 0)
                continue;
            const sortedLatencies = [...latencies].sort((a, b) => a - b);
            const count = sortedLatencies.length;
            const minMs = Math.round(sortedLatencies[0]);
            const maxMs = Math.round(sortedLatencies[count - 1]);
            const p50Ms = Math.round(sortedLatencies[Math.floor(count / 2)]);
            const totalMs = Math.round(sortedLatencies.reduce((sum, value) => sum + value, 0));
            stats.push({ type, count, minMs, maxMs, p50Ms, totalMs });
        }
        stats.sort((a, b) => b.totalMs - a.totalMs);
        return stats.slice(0, 15);
    }
    computeBufferedAmountStats() {
        if (this.bufferedAmountSamples.length === 0) {
            return { p95: 0, max: 0 };
        }
        const samples = [...this.bufferedAmountSamples].sort((a, b) => a - b);
        const p95Index = Math.ceil(samples.length * 0.95) - 1;
        return {
            p95: samples[p95Index] ?? 0,
            max: samples[samples.length - 1] ?? 0,
        };
    }
    reset(windowStartedAt) {
        for (const counter of Object.keys(this.counters)) {
            this.counters[counter] = 0;
        }
        this.inboundMessageCounts.clear();
        this.inboundSessionRequestCounts.clear();
        this.outboundMessageCounts.clear();
        this.outboundSessionMessageCounts.clear();
        this.outboundAgentStreamCounts.clear();
        this.outboundAgentStreamByAgentCounts.clear();
        this.outboundBinaryFrameCounts.clear();
        this.bufferedAmountSamples.length = 0;
        this.requestLatencies.clear();
        this.windowStartedAt = windowStartedAt;
    }
}
function createRuntimeCounters() {
    return {
        connectedAwaitingHello: 0,
        helloResumed: 0,
        helloNew: 0,
        pendingDisconnected: 0,
        sessionDisconnectedWaitingReconnect: 0,
        sessionSocketDisconnectedAttached: 0,
        sessionCleanup: 0,
        validationFailed: 0,
        binaryBeforeHelloRejected: 0,
        pendingMessageRejectedBeforeHello: 0,
        missingConnectionForMessage: 0,
        unexpectedHelloOnActiveConnection: 0,
        relayExternalSocketAttached: 0,
        originRejected: 0,
        hostRejected: 0,
        applicationJsonRejected: 0,
        applicationBinaryRejected: 0,
    };
}
function incrementCount(map, key) {
    map.set(key, (map.get(key) ?? 0) + 1);
}
function getTopCounts(map, limit) {
    return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
}
//# sourceMappingURL=runtime-metrics.js.map