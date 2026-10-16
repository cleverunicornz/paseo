import type { WSOutboundMessage } from "../messages.js";
import type { LoopHealthSnapshot } from "../loop-health.js";
import type { ProcessMemoryDiagnostics } from "../process-diagnostics.js";
export interface WebSocketRuntimeCounters {
    connectedAwaitingHello: number;
    helloResumed: number;
    helloNew: number;
    pendingDisconnected: number;
    sessionDisconnectedWaitingReconnect: number;
    sessionSocketDisconnectedAttached: number;
    sessionCleanup: number;
    validationFailed: number;
    binaryBeforeHelloRejected: number;
    pendingMessageRejectedBeforeHello: number;
    missingConnectionForMessage: number;
    unexpectedHelloOnActiveConnection: number;
    relayExternalSocketAttached: number;
    originRejected: number;
    hostRejected: number;
    applicationJsonRejected: number;
    applicationBinaryRejected: number;
}
export interface WebSocketRuntimeMetricsSnapshot {
    windowMs: number;
    counters: WebSocketRuntimeCounters;
    inboundMessageTypesTop: Array<[string, number]>;
    inboundSessionRequestTypesTop: Array<[string, number]>;
    outboundMessageTypesTop: Array<[string, number]>;
    outboundSessionMessageTypesTop: Array<[string, number]>;
    outboundAgentStreamTypesTop: Array<[string, number]>;
    outboundAgentStreamAgentsTop: Array<[string, number]>;
    outboundBinaryFrameTypesTop: Array<[string, number]>;
    bufferedAmount: {
        p95: number;
        max: number;
    };
    latency: Array<{
        type: string;
        count: number;
        minMs: number;
        maxMs: number;
        p50Ms: number;
        totalMs: number;
    }>;
}
export interface WebSocketRuntimeDiagnosticSnapshot<TRuntime = unknown, TAgents = unknown, TGit = unknown> extends WebSocketRuntimeMetricsSnapshot {
    collectedAt: string;
    final: boolean;
    sessions: {
        activeConnections: number;
        externalSessionKeys: number;
        reconnectGraceSessions: number;
    };
    sockets: {
        activeSockets: number;
        pendingConnections: number;
    };
    eventLoopDelay: {
        p50Ms: number;
        p99Ms: number;
        maxMs: number;
    } | null;
    /**
     * The loop-blocker series: a microtask-aware timer lateness (the poll-phase
     * `eventLoopDelay` above cannot see a promise storm), the GC pause series,
     * and the native handle count.
     */
    loopHealth: LoopHealthSnapshot | null;
    uptimeSeconds: number;
    memory: ProcessMemoryDiagnostics;
    runtime: TRuntime;
    agents: TAgents;
    git: TGit;
}
type Clock = () => number;
export declare class WebSocketRuntimeMetricsWindow {
    private readonly clock;
    private windowStartedAt;
    private readonly counters;
    private readonly inboundMessageCounts;
    private readonly inboundSessionRequestCounts;
    private readonly outboundMessageCounts;
    private readonly outboundSessionMessageCounts;
    private readonly outboundAgentStreamCounts;
    private readonly outboundAgentStreamByAgentCounts;
    private readonly outboundBinaryFrameCounts;
    private readonly bufferedAmountSamples;
    private readonly requestLatencies;
    constructor(clock?: Clock);
    incrementCounter(counter: keyof WebSocketRuntimeCounters): void;
    recordInboundMessage(type: string): void;
    recordInboundSessionRequest(type: string): void;
    recordOutboundMessage(message: WSOutboundMessage, bufferedAmount?: number): void;
    recordOutboundBinaryFrame(bufferedAmount?: number): void;
    recordRequestLatency(type: string, durationMs: number): void;
    snapshotAndReset(): WebSocketRuntimeMetricsSnapshot;
    private recordOutboundAgentStreamMessage;
    private recordBufferedAmount;
    private computeLatencyStats;
    private computeBufferedAmountStats;
    private reset;
}
export {};
//# sourceMappingURL=runtime-metrics.d.ts.map