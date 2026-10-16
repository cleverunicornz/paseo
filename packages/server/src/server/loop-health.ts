import { PerformanceObserver, monitorEventLoopDelay, performance } from "node:perf_hooks";

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

const DEFAULT_PROBE_INTERVAL_MS = 50;
const MAX_LATENESS_SAMPLES = 2_000;

export interface LoopHealthMonitorOptions {
  /** How often the timer probe reschedules itself. */
  probeIntervalMs?: number;
  /** Injectable for tests; defaults to the real timer API. */
  schedule?: (callback: () => void, delayMs: number) => { unref?(): void };
  clearSchedule?: (handle: unknown) => void;
  now?: () => number;
}

/**
 * Samples what the delay gauge cannot: the true lateness of a timer, the
 * collector's own pause series, and the process's native handle count.
 */
export class LoopHealthMonitor {
  private readonly probeIntervalMs: number;
  private readonly schedule: (callback: () => void, delayMs: number) => { unref?(): void };
  private readonly clearSchedule: (handle: unknown) => void;
  private readonly now: () => number;
  private readonly eventLoopDelay = monitorEventLoopDelay({ resolution: 10 });
  private gcObserver: PerformanceObserver | null = null;
  private probeTimer: { unref?(): void } | null = null;
  private expectedFireAtMs = 0;
  private readonly latenessSamples: number[] = [];
  private gcCount = 0;
  private gcTotalPauseMs = 0;
  private gcMaxPauseMs = 0;
  private readonly gcByKind = new Map<string, number>();
  private lastHeapUsedBytes: number | null = null;
  private lastEventLoopUtilization = performance.eventLoopUtilization();

  constructor(options: LoopHealthMonitorOptions = {}) {
    this.probeIntervalMs = options.probeIntervalMs ?? DEFAULT_PROBE_INTERVAL_MS;
    this.schedule =
      options.schedule ??
      ((callback, delayMs) => {
        const timer = setTimeout(callback, delayMs);
        return timer;
      });
    this.clearSchedule =
      options.clearSchedule ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
    this.now = options.now ?? Date.now;
  }

  start(): void {
    this.eventLoopDelay.enable();
    this.startGcObserver();
    this.scheduleProbe();
  }

  stop(): void {
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
  snapshotEventLoopDelay(): { p50Ms: number; p99Ms: number; maxMs: number } | null {
    const toMs = (nanoseconds: number): number => Math.round(nanoseconds / 1e5) / 10;
    const snapshot = {
      p50Ms: toMs(this.eventLoopDelay.percentile(50)),
      p99Ms: toMs(this.eventLoopDelay.percentile(99)),
      maxMs: toMs(this.eventLoopDelay.max),
    };
    this.eventLoopDelay.reset();
    return snapshot;
  }

  snapshot(): LoopHealthSnapshot {
    const memory = process.memoryUsage();
    const utilization = performance.eventLoopUtilization(this.lastEventLoopUtilization);
    this.lastEventLoopUtilization = performance.eventLoopUtilization();

    const heapUsedDeltaBytes =
      this.lastHeapUsedBytes === null ? 0 : memory.heapUsed - this.lastHeapUsedBytes;
    this.lastHeapUsedBytes = memory.heapUsed;

    const lateness = summarizeLateness(this.latenessSamples);
    this.latenessSamples.length = 0;

    const gc: GcSeriesSnapshot = {
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
      eventLoopUtilization:
        utilization.utilization > 0
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

  private scheduleProbe(): void {
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

  private startGcObserver(): void {
    try {
      this.gcObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const gcEntry = entry as PerformanceEntry & { kind?: number; detail?: { kind?: string } };
          const kind = gcKindName(gcEntry);
          this.gcCount += 1;
          this.gcTotalPauseMs += gcEntry.duration;
          this.gcMaxPauseMs = Math.max(this.gcMaxPauseMs, gcEntry.duration);
          this.gcByKind.set(kind, (this.gcByKind.get(kind) ?? 0) + 1);
        }
      });
      this.gcObserver.observe({ entryTypes: ["gc"] });
    } catch {
      // GC observation is best effort: a runtime without gc entries reports an
      // empty series rather than failing the metric.
      this.gcObserver = null;
    }
  }
}

function gcKindName(entry: PerformanceEntry & { detail?: { kind?: string } }): string {
  const kind = entry.detail?.kind;
  return typeof kind === "string" && kind.length > 0 ? kind : "unknown";
}

function summarizeLateness(samples: number[]): LoopLatenessStats {
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

export function snapshotNativeHandles(): NativeHandleSnapshot {
  let resources: string[];
  try {
    resources = process.getActiveResourcesInfo();
  } catch {
    return { total: 0, byType: [] };
  }
  const byType = new Map<string, number>();
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
