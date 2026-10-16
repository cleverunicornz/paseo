import { describe, expect, test } from "vitest";

import { LoopHealthMonitor, snapshotNativeHandles } from "./loop-health.js";

describe("LoopHealthMonitor", () => {
  test("reports a timer lateness that a microtask storm raises and monitorEventLoopDelay misses", async () => {
    const monitor = new LoopHealthMonitor();
    monitor.start();
    try {
      // Burn the loop with a long microtask chain: no await, so timers starve.
      const burnUntil = Date.now() + 120;
      const burn = () => {
        if (Date.now() < burnUntil) Promise.resolve().then(burn);
      };
      burn();

      await new Promise((resolve) => setTimeout(resolve, 200));

      const snapshot = monitor.snapshot();
      const pollMaxMs = monitor.snapshotEventLoopDelay()?.maxMs ?? 0;
      // The timer probe sees the starvation far more strongly than the
      // poll-phase gauge, which is why both series are reported.
      expect(snapshot.timerLateness.count).toBeGreaterThan(0);
      expect(snapshot.timerLateness.maxMs).toBeGreaterThan(50);
      expect(snapshot.timerLateness.maxMs).toBeGreaterThan(pollMaxMs);
    } finally {
      monitor.stop();
    }
  });

  test("reports a GC and heap series beyond heapUsed", () => {
    const monitor = new LoopHealthMonitor();
    monitor.start();
    try {
      const first = monitor.snapshot();
      const second = monitor.snapshot();

      expect(second.gc).toEqual(
        expect.objectContaining({
          count: expect.any(Number),
          totalPauseMs: expect.any(Number),
          maxPauseMs: expect.any(Number),
        }),
      );
      expect(second.heap.heapUsedBytes).toBeGreaterThan(0);
      expect(second.heap.heapTotalBytes).toBeGreaterThan(0);
      expect(second.heap.rssBytes).toBeGreaterThan(0);
      expect(second.heap).toHaveProperty("heapUsedDeltaBytes");
      expect(first.heap).toHaveProperty("heapUsedDeltaBytes", 0);
    } finally {
      monitor.stop();
    }
  });

  test("reports the native handle count with its types", () => {
    const monitor = new LoopHealthMonitor();
    monitor.start();
    try {
      const snapshot = monitor.snapshot();
      expect(snapshot.nativeHandles.total).toBeGreaterThan(0);
      expect(Array.isArray(snapshot.nativeHandles.byType)).toBe(true);
    } finally {
      monitor.stop();
    }
  });

  test("snapshotNativeHandles reads the live resources", () => {
    const handles = snapshotNativeHandles();
    expect(handles.total).toBeGreaterThan(0);
    expect(handles.byType.length).toBeGreaterThan(0);
  });

  test("event loop utilization is reported after activity", async () => {
    const monitor = new LoopHealthMonitor();
    monitor.start();
    try {
      await new Promise((resolve) => setTimeout(resolve, 60));
      const snapshot = monitor.snapshot();
      expect(snapshot.eventLoopUtilization).not.toBeNull();
      expect(snapshot.eventLoopUtilization?.utilization).toBeGreaterThanOrEqual(0);
    } finally {
      monitor.stop();
    }
  });
});
