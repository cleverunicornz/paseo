/**
 * Loop-blocker instrumentation for the periodic metrics line.
 *
 * The 2026-10-15 hang left three candidate mechanisms the daemon's own metric
 * could not separate: a microtask/promise storm, a GC or allocator spiral, and
 * an fs.watch handle storm. `monitorEventLoopDelay` measures only the poll
 * phase, so a promise chain that never awaits starves every timer while the
 * gauge keeps reporting p50/p99/max near zero; heapUsed alone cannot separate a
 * live heap from a collector working hard; and nothing reported the native
 * handle count. This module reports all three, each bounded.
 */
export interface LoopLatenessStats {
    /** Lateness samples kept in the window. */
    count: number;
    p50Ms: number;
    p95Ms: number;
    maxMs: number;
}
export interface GcSeriesSnapshot {
    /** GC events observed in the window. */
    count: number;
    /** Total stop-the-world pause seen in the window. */
    totalPauseMs: number;
    maxPauseMs: number;
    /** Events by GC kind, e.g. `major`, `minor`, `incremental`. */
    byKind: Array<[string, number]>;
}
export interface HeapSeriesSnapshot {
    heapUsedBytes: number;
    /** Change in heapUsed since the previous snapshot. */
    heapUsedDeltaBytes: number;
    heapTotalBytes: number;
    rssBytes: number;
    externalBytes: number;
}
export interface NativeHandleSnapshot {
    total: number;
    byType: Array<[string, number]>;
}
export interface EventLoopUtilizationSnapshot {
    utilization: number;
    activeMs: number;
    idleMs: number;
}
export interface LoopHealthSnapshot {
    /**
     * Real lateness of a self-rescheduling timer, in milliseconds. This is the
     * microtask-aware measure: `monitorEventLoopDelay` cannot see a microtask
     * storm, but a timer delayed by one reports it here. It is a lower bound on
     * loop pressure, sampled once per probe interval.
     */
    timerLateness: LoopLatenessStats;
    eventLoopUtilization: EventLoopUtilizationSnapshot | null;
    gc: GcSeriesSnapshot;
    heap: HeapSeriesSnapshot;
    nativeHandles: NativeHandleSnapshot;
}
export interface LoopHealthMonitorOptions {
    /** How often the timer probe reschedules itself. */
    probeIntervalMs?: number;
    /** Injectable for tests; defaults to the real timer API. */
    schedule?: (callback: () => void, delayMs: number) => {
        unref?(): void;
    };
    clearSchedule?: (handle: unknown) => void;
    now?: () => number;
}
/**
 * Samples what the delay gauge cannot: the true lateness of a timer, the
 * collector's own pause series, and the process's native handle count.
 */
export declare class LoopHealthMonitor {
    private readonly probeIntervalMs;
    private readonly schedule;
    private readonly clearSchedule;
    private readonly now;
    private readonly eventLoopDelay;
    private gcObserver;
    private probeTimer;
    private expectedFireAtMs;
    private readonly latenessSamples;
    private gcCount;
    private gcTotalPauseMs;
    private gcMaxPauseMs;
    private readonly gcByKind;
    private lastHeapUsedBytes;
    private lastEventLoopUtilization;
    constructor(options?: LoopHealthMonitorOptions);
    start(): void;
    stop(): void;
    /**
     * The poll-phase delay percentiles, kept for compatibility with the existing
     * metric. A microtask storm reads near zero here: see {@link LoopHealthSnapshot.timerLateness}.
     */
    snapshotEventLoopDelay(): {
        p50Ms: number;
        p99Ms: number;
        maxMs: number;
    } | null;
    snapshot(): LoopHealthSnapshot;
    private scheduleProbe;
    private startGcObserver;
}
export declare function snapshotNativeHandles(): NativeHandleSnapshot;
//# sourceMappingURL=loop-health.d.ts.map