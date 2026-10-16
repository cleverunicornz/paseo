import { PerformanceObserver, monitorEventLoopDelay, performance } from "node:perf_hooks";
const DEFAULT_PROBE_INTERVAL_MS = 50;
const MAX_LATENESS_SAMPLES = 2000;
/**
 * Samples what the delay gauge cannot: the true lateness of a timer, the
 * collector's own pause series, and the process's native handle count.
 */
export class LoopHealthMonitor {
    constructor(options = {}) {
        this.eventLoopDelay = monitorEventLoopDelay({ resolution: 10 });
        this.gcObserver = null;
        this.probeTimer = null;
        this.expectedFireAtMs = 0;
        this.latenessSamples = [];
        this.gcCount = 0;
        this.gcTotalPauseMs = 0;
        this.gcMaxPauseMs = 0;
        this.gcByKind = new Map();
        this.lastHeapUsedBytes = null;
        this.lastEventLoopUtilization = performance.eventLoopUtilization();
        this.probeIntervalMs = options.probeIntervalMs ?? DEFAULT_PROBE_INTERVAL_MS;
        this.schedule =
            options.schedule ??
                ((callback, delayMs) => {
                    const timer = setTimeout(callback, delayMs);
                    return timer;
                });
        this.clearSchedule =
            options.clearSchedule ?? ((handle) => clearTimeout(handle));
        this.now = options.now ?? Date.now;
    }
    start() {
        this.eventLoopDelay.enable();
        this.startGcObserver();
        this.scheduleProbe();
    }
    stop() {
        this.eventLoopDelay.disable();
        this.gcObserver?.disconnect();
        this.gcObserver = null;
        if (this.probeTimer) {
            this.clearSchedule(this.probeTimer);
            this.probeTimer = null;
        }
    }
    /**
     * The poll-phase delay percentiles, kept for compatibility with the existing
     * metric. A microtask storm reads near zero here: see {@link LoopHealthSnapshot.timerLateness}.
     */
    snapshotEventLoopDelay() {
        const toMs = (nanoseconds) => Math.round(nanoseconds / 1e5) / 10;
        const snapshot = {
            p50Ms: toMs(this.eventLoopDelay.percentile(50)),
            p99Ms: toMs(this.eventLoopDelay.percentile(99)),
            maxMs: toMs(this.eventLoopDelay.max),
        };
        this.eventLoopDelay.reset();
        return snapshot;
    }
    snapshot() {
        const memory = process.memoryUsage();
        const utilization = performance.eventLoopUtilization(this.lastEventLoopUtilization);
        this.lastEventLoopUtilization = performance.eventLoopUtilization();
        const heapUsedDeltaBytes = this.lastHeapUsedBytes === null ? 0 : memory.heapUsed - this.lastHeapUsedBytes;
        this.lastHeapUsedBytes = memory.heapUsed;
        const lateness = summarizeLateness(this.latenessSamples);
        this.latenessSamples.length = 0;
        const gc = {
            count: this.gcCount,
            totalPauseMs: Math.round(this.gcTotalPauseMs * 10) / 10,
            maxPauseMs: Math.round(this.gcMaxPauseMs * 10) / 10,
            byKind: [...this.gcByKind.entries()]
                .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
                .slice(0, 8),
        };
        this.gcCount = 0;
        this.gcTotalPauseMs = 0;
        this.gcMaxPauseMs = 0;
        this.gcByKind.clear();
        return {
            timerLateness: lateness,
            eventLoopUtilization: utilization.utilization > 0
                ? {
                    utilization: Math.round(utilization.utilization * 1000) / 1000,
                    activeMs: Math.round(utilization.active),
                    idleMs: Math.round(utilization.idle),
                }
                : null,
            gc,
            heap: {
                heapUsedBytes: memory.heapUsed,
                heapUsedDeltaBytes,
                heapTotalBytes: memory.heapTotal,
                rssBytes: memory.rss,
                externalBytes: memory.external,
            },
            nativeHandles: snapshotNativeHandles(),
        };
    }
    scheduleProbe() {
        this.expectedFireAtMs = this.now() + this.probeIntervalMs;
        const fire = () => {
            const latenessMs = Math.max(0, this.now() - this.expectedFireAtMs);
            if (this.latenessSamples.length < MAX_LATENESS_SAMPLES) {
                this.latenessSamples.push(latenessMs);
            }
            this.scheduleProbe();
        };
        this.probeTimer = this.schedule(fire, this.probeIntervalMs);
        this.probeTimer.unref?.();
    }
    startGcObserver() {
        try {
            this.gcObserver = new PerformanceObserver((list) => {
                for (const entry of list.getEntries()) {
                    const gcEntry = entry;
                    const kind = gcKindName(gcEntry);
                    this.gcCount += 1;
                    this.gcTotalPauseMs += gcEntry.duration;
                    this.gcMaxPauseMs = Math.max(this.gcMaxPauseMs, gcEntry.duration);
                    this.gcByKind.set(kind, (this.gcByKind.get(kind) ?? 0) + 1);
                }
            });
            this.gcObserver.observe({ entryTypes: ["gc"] });
        }
        catch {
            // GC observation is best effort: a runtime without gc entries reports an
            // empty series rather than failing the metric.
            this.gcObserver = null;
        }
    }
}
function gcKindName(entry) {
    const kind = entry.detail?.kind;
    return typeof kind === "string" && kind.length > 0 ? kind : "unknown";
}
function summarizeLateness(samples) {
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
export function snapshotNativeHandles() {
    let resources;
    try {
        resources = process.getActiveResourcesInfo();
    }
    catch {
        return { total: 0, byType: [] };
    }
    const byType = new Map();
    for (const resource of resources) {
        byType.set(resource, (byType.get(resource) ?? 0) + 1);
    }
    return {
        total: resources.length,
        byType: [...byType.entries()]
            .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
            .slice(0, 12),
    };
}
//# sourceMappingURL=loop-health.js.map