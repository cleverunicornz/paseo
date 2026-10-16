export interface GitCommandDurationStats {
    count: number;
    p50Ms: number;
    p95Ms: number;
    maxMs: number;
}
export interface GitCommandRuntimeMetricsSnapshot {
    concurrencyLimit: number;
    maxProcessesPerSecond: number;
    active: number;
    pending: number;
    peakActive: number;
    peakPending: number;
    oldestPendingMs: number;
    submitted: number;
    started: number;
    completed: number;
    failed: number;
    timedOut: number;
    queueWaitMs: GitCommandDurationStats;
    executionMs: GitCommandDurationStats;
    operationsTop: Array<[string, number]>;
    provenanceTop: Array<[string, number]>;
    pendingProvenanceTop: Array<[string, number]>;
    activeProvenanceTop: Array<[string, number]>;
}
interface GitCommandRuntimeMetric {
    queuedAtMs: number;
    startedAtMs: number | null;
    provenance: string;
}
type Clock = () => number;
export declare class GitCommandRuntimeMetricsWindow {
    private readonly limits;
    private readonly clock;
    private readonly pendingCommands;
    private readonly activeCommands;
    private active;
    private peakActive;
    private peakPending;
    private submittedCount;
    private startedCount;
    private completedCount;
    private failedCount;
    private timedOutCount;
    private readonly queueWaitSamples;
    private readonly executionSamples;
    private readonly operationCounts;
    private readonly provenanceCounts;
    constructor(limits: {
        concurrencyLimit: number;
        maxProcessesPerSecond: number;
    }, clock?: Clock);
    submit(operation: string, provenance?: string): GitCommandRuntimeMetric;
    observeLimiter(active: number, pending: number): void;
    start(metric: GitCommandRuntimeMetric): void;
    finish(metric: GitCommandRuntimeMetric, outcome: {
        success: boolean;
        timedOut: boolean;
    }): void;
    snapshotAndReset(limiter?: {
        active: number;
        pending: number;
    }): GitCommandRuntimeMetricsSnapshot;
}
export {};
//# sourceMappingURL=git-command-runtime-metrics.d.ts.map