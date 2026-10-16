import { describe, expect, test } from "vitest";
import { GitCommandRuntimeMetricsWindow } from "./git-command-runtime-metrics.js";

function createMetricsWindow(concurrencyLimit = 2, maxProcessesPerSecond = 8) {
  let now = 1_000;
  return {
    metrics: new GitCommandRuntimeMetricsWindow(
      { concurrencyLimit, maxProcessesPerSecond },
      () => now,
    ),
    advance(ms: number) {
      now += ms;
    },
  };
}

describe("GitCommandRuntimeMetricsWindow", () => {
  test("separates queue wait from execution time", () => {
    const { metrics, advance } = createMetricsWindow();
    const command = metrics.submit("status");
    advance(40);
    metrics.start(command);
    advance(15);
    metrics.finish(command, { success: true, timedOut: false });

    expect(metrics.snapshotAndReset()).toMatchObject({
      submitted: 1,
      started: 1,
      completed: 1,
      failed: 0,
      timedOut: 0,
      queueWaitMs: { count: 1, p50Ms: 40, p95Ms: 40, maxMs: 40 },
      executionMs: { count: 1, p50Ms: 15, p95Ms: 15, maxMs: 15 },
      operationsTop: [["status", 1]],
    });
  });

  test("reports live queue pressure across window resets", () => {
    const { metrics, advance } = createMetricsWindow(1);
    const active = metrics.submit("fetch", "background-fetch");
    metrics.start(active);
    const pending = metrics.submit("rev-parse", "workspace-refresh:watch");
    metrics.observeLimiter(1, 1);
    advance(25);

    expect(metrics.snapshotAndReset()).toMatchObject({
      concurrencyLimit: 1,
      maxProcessesPerSecond: 8,
      active: 1,
      pending: 1,
      peakActive: 1,
      peakPending: 1,
      oldestPendingMs: 25,
      submitted: 2,
      started: 1,
      provenanceTop: [
        ["background-fetch", 1],
        ["workspace-refresh:watch", 1],
      ],
      pendingProvenanceTop: [["workspace-refresh:watch", 1]],
      activeProvenanceTop: [["background-fetch", 1]],
    });

    advance(10);
    metrics.finish(active, { success: true, timedOut: false });
    metrics.start(pending);
    metrics.observeLimiter(1, 0);
    advance(5);
    metrics.finish(pending, { success: false, timedOut: true });

    expect(metrics.snapshotAndReset()).toMatchObject({
      active: 0,
      pending: 0,
      peakActive: 1,
      peakPending: 1,
      submitted: 0,
      started: 1,
      completed: 2,
      failed: 1,
      timedOut: 1,
      queueWaitMs: { count: 1, p50Ms: 35, p95Ms: 35, maxMs: 35 },
      provenanceTop: [],
      pendingProvenanceTop: [],
      activeProvenanceTop: [],
    });
  });

  test("retires a refused submission so it survives no window reset", () => {
    const { metrics } = createMetricsWindow(1);

    // A refusal: submitted, never started, then retired.
    const refused = metrics.submit("status", "refused-background");
    expect(metrics.retire(refused)).toBe(true);

    // The next window sees nothing from it.
    metrics.observeLimiter(0, 0);
    expect(metrics.snapshotAndReset()).toMatchObject({
      active: 0,
      pending: 0,
      submitted: 0,
      started: 0,
      completed: 0,
      operationsTop: [],
      provenanceTop: [],
      pendingProvenanceTop: [],
      activeProvenanceTop: [],
    });

    // A command that really started is never retired: `retire` reports that it
    // had already left the pending set, so its accounting stays single.
    const started = metrics.submit("fetch", "workspace-refresh:watch");
    metrics.start(started);
    expect(metrics.retire(started)).toBe(false);
    expect(metrics.retire(started)).toBe(false);
    metrics.finish(started, { success: true, timedOut: false });
    expect(metrics.snapshotAndReset()).toMatchObject({
      submitted: 1,
      started: 1,
      completed: 1,
      failed: 0,
      operationsTop: [["fetch", 1]],
      provenanceTop: [["workspace-refresh:watch", 1]],
    });
  });
});
