export class GitCommandRuntimeMetricsWindow {
    constructor(limits, clock = Date.now) {
        this.limits = limits;
        this.clock = clock;
        this.pendingCommands = new Set();
        this.activeCommands = new Set();
        this.active = 0;
        this.peakActive = 0;
        this.peakPending = 0;
        this.submittedCount = 0;
        this.startedCount = 0;
        this.completedCount = 0;
        this.failedCount = 0;
        this.timedOutCount = 0;
        this.queueWaitSamples = [];
        this.executionSamples = [];
        this.operationCounts = new Map();
        this.provenanceCounts = new Map();
    }
    submit(operation, provenance = "unattributed") {
        const metric = { queuedAtMs: this.clock(), startedAtMs: null, provenance };
        this.pendingCommands.add(metric);
        this.submittedCount += 1;
        this.operationCounts.set(operation, (this.operationCounts.get(operation) ?? 0) + 1);
        this.provenanceCounts.set(provenance, (this.provenanceCounts.get(provenance) ?? 0) + 1);
        return metric;
    }
    observeLimiter(active, pending) {
        this.peakActive = Math.max(this.peakActive, active);
        this.peakPending = Math.max(this.peakPending, pending);
    }
    start(metric) {
        if (!this.pendingCommands.delete(metric)) {
            return;
        }
        const now = this.clock();
        metric.startedAtMs = now;
        this.activeCommands.add(metric);
        this.active += 1;
        this.startedCount += 1;
        this.peakActive = Math.max(this.peakActive, this.active);
        this.queueWaitSamples.push(Math.max(0, now - metric.queuedAtMs));
    }
    finish(metric, outcome) {
        if (metric.startedAtMs === null) {
            return;
        }
        const startedAtMs = metric.startedAtMs;
        metric.startedAtMs = null;
        this.activeCommands.delete(metric);
        this.active = Math.max(0, this.active - 1);
        this.completedCount += 1;
        if (!outcome.success) {
            this.failedCount += 1;
        }
        if (outcome.timedOut) {
            this.timedOutCount += 1;
        }
        this.executionSamples.push(Math.max(0, this.clock() - startedAtMs));
    }
    snapshotAndReset(limiter = { active: this.active, pending: this.pendingCommands.size }) {
        const now = this.clock();
        const oldestPendingAtMs = Math.min(...Array.from(this.pendingCommands, (metric) => metric.queuedAtMs));
        const snapshot = {
            concurrencyLimit: this.limits.concurrencyLimit,
            maxProcessesPerSecond: this.limits.maxProcessesPerSecond,
            active: limiter.active,
            pending: limiter.pending,
            peakActive: this.peakActive,
            peakPending: this.peakPending,
            oldestPendingMs: limiter.pending > 0 && Number.isFinite(oldestPendingAtMs)
                ? Math.max(0, now - oldestPendingAtMs)
                : 0,
            submitted: this.submittedCount,
            started: this.startedCount,
            completed: this.completedCount,
            failed: this.failedCount,
            timedOut: this.timedOutCount,
            queueWaitMs: summarizeDurations(this.queueWaitSamples),
            executionMs: summarizeDurations(this.executionSamples),
            operationsTop: [...this.operationCounts.entries()]
                .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
                .slice(0, 12),
            provenanceTop: topCounts(this.provenanceCounts),
            pendingProvenanceTop: topProvenance(this.pendingCommands),
            activeProvenanceTop: topProvenance(this.activeCommands),
        };
        this.peakActive = limiter.active;
        this.peakPending = limiter.pending;
        this.submittedCount = 0;
        this.startedCount = 0;
        this.completedCount = 0;
        this.failedCount = 0;
        this.timedOutCount = 0;
        this.queueWaitSamples.length = 0;
        this.executionSamples.length = 0;
        this.operationCounts.clear();
        this.provenanceCounts.clear();
        return snapshot;
    }
}
function topProvenance(commands) {
    const counts = new Map();
    for (const command of commands) {
        counts.set(command.provenance, (counts.get(command.provenance) ?? 0) + 1);
    }
    return topCounts(counts);
}
function topCounts(counts) {
    return [...counts.entries()]
        .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
        .slice(0, 12);
}
function summarizeDurations(samples) {
    if (samples.length === 0) {
        return { count: 0, p50Ms: 0, p95Ms: 0, maxMs: 0 };
    }
    const sorted = [...samples].sort((left, right) => left - right);
    return {
        count: sorted.length,
        p50Ms: Math.round(sorted[Math.floor(sorted.length / 2)] ?? 0),
        p95Ms: Math.round(sorted[Math.ceil(sorted.length * 0.95) - 1] ?? 0),
        maxMs: Math.round(sorted[sorted.length - 1] ?? 0),
    };
}
//# sourceMappingURL=git-command-runtime-metrics.js.map