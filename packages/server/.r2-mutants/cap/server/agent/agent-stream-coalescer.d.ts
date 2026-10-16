import type { AgentProvider, AgentStreamEvent, AgentTimelineItem } from "./agent-sdk-types.js";
export declare const AGENT_STREAM_COALESCE_DEFAULT_WINDOW_MS = 60;
type CoalescableTextKind = "assistant_message" | "reasoning";
type CoalescableTimelineKind = CoalescableTextKind | "tool_call";
type CoalescableTimelineItem = Extract<AgentTimelineItem, {
    type: CoalescableTimelineKind;
}>;
export interface AgentStreamCoalescerTimers {
    setTimeout: (callback: () => void, ms?: number) => ReturnType<typeof setTimeout>;
    clearTimeout: typeof clearTimeout;
}
export interface AgentStreamCoalescerFlush {
    agentId: string;
    item: CoalescableTimelineItem;
    provider: AgentProvider;
    turnId?: string;
}
export interface AgentStreamCoalescerOptions {
    windowMs?: number;
    timers: AgentStreamCoalescerTimers;
    now?: () => number;
    onFlush: (payload: AgentStreamCoalescerFlush) => void;
}
export declare class AgentStreamCoalescer {
    private readonly buffers;
    private readonly onFlush;
    private readonly timers;
    private readonly windowMs;
    private readonly now;
    constructor(options: AgentStreamCoalescerOptions);
    handle(agentId: string, event: AgentStreamEvent): boolean;
    flushFor(agentId: string): void;
    flushAll(): void;
    flushAndDiscard(agentId: string): void;
    private getOrCreateBuffer;
    private appendToBuffer;
    private scheduleFlush;
    private clearTimer;
    private flushBuffer;
    private collapseEntries;
}
export {};
//# sourceMappingURL=agent-stream-coalescer.d.ts.map