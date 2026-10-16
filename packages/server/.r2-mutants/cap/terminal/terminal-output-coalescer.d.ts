export interface TerminalOutputCoalescerTimers {
    setTimeout: typeof setTimeout;
    clearTimeout: typeof clearTimeout;
}
export interface TerminalOutputCoalescerFlush {
    payload: Buffer;
    chars: number;
    bytes: number;
}
export interface TerminalOutputCoalescerOptions {
    timers: TerminalOutputCoalescerTimers;
    flushDelayMs?: number;
    now?: () => number;
    onFlush: (payload: TerminalOutputCoalescerFlush) => void;
}
export declare class TerminalOutputCoalescer {
    private readonly timers;
    private readonly flushDelayMs;
    private readonly now;
    private readonly onFlush;
    private chunks;
    private bytes;
    private chars;
    private flushTimer;
    private lastFlushAt;
    constructor(options: TerminalOutputCoalescerOptions);
    handle(data: string): void;
    flush(): void;
    markFlushed(): void;
    dispose(): void;
    private clearTimer;
    private clearPending;
}
//# sourceMappingURL=terminal-output-coalescer.d.ts.map