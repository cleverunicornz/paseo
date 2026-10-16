import { setImmediate as scheduleImmediate } from "node:timers";
import { afterEach, describe, expect, test, vi } from "vitest";

import {
  DEFAULT_GIT_PROCESS_POLICY,
  GitProcessScheduler,
  resolveGitProcessPolicy,
} from "./git-process-scheduler.js";

function createConcurrencyTask(
  index: number,
  started: number[],
  releases: Array<() => void>,
): () => { result: Promise<void>; exited: Promise<void> } {
  return () => {
    started.push(index);
    if (index >= 2) {
      const completed = Promise.resolve();
      return { result: completed, exited: completed };
    }
    const completed = new Promise<void>((resolve) => {
      releases.push(resolve);
    });
    return { result: completed, exited: completed };
  };
}

describe("GitProcessScheduler", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test("limits unresolved processes independently of their start rate", async () => {
    const scheduler = new GitProcessScheduler({
      maxProcessesPerSecond: 100,
      maxProcessConcurrency: 2,
    });
    const releases: Array<() => void> = [];
    const started: number[] = [];
    const tasks = Array.from({ length: 4 }, (_, index) =>
      scheduler.run(createConcurrencyTask(index, started, releases)),
    );

    await vi.waitFor(() => expect(started).toEqual([0, 1]));
    releases.shift()?.();
    await vi.waitFor(() => expect(started).toContain(2));
    releases.shift()?.();
    await Promise.all(tasks);

    expect(scheduler.activeCount).toBe(0);
    expect(scheduler.pendingCount).toBe(0);
  });

  test("admits a high-priority user operation before queued observation work", async () => {
    const scheduler = new GitProcessScheduler({
      maxProcessesPerSecond: 100,
      maxProcessConcurrency: 1,
    });
    const releases: Array<() => void> = [];
    const started: number[] = [];

    const activeObservation = scheduler.run(createConcurrencyTask(0, started, releases));
    await vi.waitFor(() => expect(started).toEqual([0]));
    const queuedObservation = scheduler.run(createConcurrencyTask(2, started, releases));
    const userOperation = scheduler.run(createConcurrencyTask(3, started, releases), {
      priority: "high",
    });

    releases.shift()?.();
    await Promise.all([activeObservation, queuedObservation, userOperation]);

    expect(started).toEqual([0, 3, 2]);
  });

  test("yields to daemon liveness work between process starts", async () => {
    const scheduler = new GitProcessScheduler({
      maxProcessesPerSecond: 100,
      maxProcessConcurrency: 8,
    });
    const started: number[] = [];
    const start = () => {
      started.push(started.length);
      const completed = Promise.resolve();
      return { result: completed, exited: completed };
    };

    const livenessTurn = new Promise<void>((resolve) => setImmediate(resolve));
    const tasks = Array.from({ length: 8 }, () => scheduler.run(start));
    await livenessTurn;

    expect(started).toHaveLength(1);
    await Promise.all(tasks);
  });

  test("starts an isolated process without an extra event-loop turn", async () => {
    const scheduler = new GitProcessScheduler({
      maxProcessesPerSecond: 100,
      maxProcessConcurrency: 8,
    });
    let started = false;

    const result = scheduler.run(() => {
      started = true;
      const completed = Promise.resolve();
      return { result: completed, exited: completed };
    });

    expect(started).toBe(true);
    await result;
  });

  test("queued processes keep moving while application timers are faked", async () => {
    vi.useFakeTimers();
    const scheduler = new GitProcessScheduler({
      maxProcessesPerSecond: 100,
      maxProcessConcurrency: 1,
    });
    const releases: Array<() => void> = [];
    const started: number[] = [];

    const first = scheduler.run(createConcurrencyTask(0, started, releases));
    const second = scheduler.run(createConcurrencyTask(2, started, releases));
    expect(started).toEqual([0]);

    releases.shift()?.();
    await Promise.resolve();
    await new Promise<void>((resolve) => scheduleImmediate(resolve));

    expect(started).toEqual([0, 2]);
    await Promise.all([first, second]);
  });

  test("limits process starts in each strict one-second interval", async () => {
    vi.useFakeTimers();
    const scheduler = new GitProcessScheduler({
      maxProcessesPerSecond: 2,
      maxProcessConcurrency: 4,
    });
    const startedAt: number[] = [];
    const recordStart = () => {
      startedAt.push(Date.now());
      const completed = Promise.resolve();
      return { result: completed, exited: completed };
    };
    const tasks = Array.from({ length: 4 }, () => scheduler.run(recordStart));

    await vi.advanceTimersByTimeAsync(999);
    expect(startedAt.length).toBeLessThanOrEqual(2);
    while (startedAt.length < 3) {
      await vi.advanceTimersToNextTimerAsync();
    }
    while (startedAt.length < 4) {
      await vi.advanceTimersToNextTimerAsync();
    }
    await Promise.all(tasks);

    expect(startedAt).toHaveLength(4);
    expect(startedAt[2]! - startedAt[0]!).toBeGreaterThanOrEqual(1_000);
  });
});

describe("GitProcessScheduler queue bound", () => {
  test("refuses a background submission with a named error when the queue is full", async () => {
    const scheduler = new GitProcessScheduler({
      maxProcessesPerSecond: 100,
      maxProcessConcurrency: 1,
      maxQueueDepth: 2,
    });
    const releases: Array<() => void> = [];
    const started: number[] = [];

    const active = scheduler.run(createConcurrencyTask(0, started, releases));
    await vi.waitFor(() => expect(started).toEqual([0]));
    const queuedA = scheduler.run(createConcurrencyTask(2, started, releases), {
      class: "background",
    });
    const queuedB = scheduler.run(createConcurrencyTask(2, started, releases), {
      class: "background",
    });

    // The third background command has no slot: it is deferred, not appended.
    await expect(
      scheduler.run(createConcurrencyTask(2, started, releases), { class: "background" }),
    ).rejects.toMatchObject({
      name: "GitProcessQueueFullError",
      code: "GIT_PROCESS_QUEUE_FULL",
    });
    expect(scheduler.pendingCount).toBe(2);

    releases.shift()?.();
    await Promise.all([active, queuedA, queuedB]);
    expect(scheduler.pendingCount).toBe(0);
  });

  test("a deferral never leaves the queue stuck", async () => {
    const scheduler = new GitProcessScheduler({
      maxProcessesPerSecond: 100,
      maxProcessConcurrency: 2,
      maxQueueDepth: 1,
    });
    const releases: Array<() => void> = [];
    const started: number[] = [];

    const a = scheduler.run(createConcurrencyTask(0, started, releases));
    const b = scheduler.run(createConcurrencyTask(0, started, releases));
    await vi.waitFor(() => expect(started).toEqual([0, 0]));
    const queued = scheduler.run(createConcurrencyTask(2, started, releases), {
      class: "background",
    });
    await expect(
      scheduler.run(createConcurrencyTask(2, started, releases), { class: "background" }),
    ).rejects.toThrow(/queue is full/i);

    releases.shift()?.();
    releases.shift()?.();
    await Promise.all([a, b, queued]);
    expect(scheduler.pendingCount).toBe(0);
    expect(scheduler.activeCount).toBe(0);
  });

  test("a bounded scheduler still admits interactive work ahead of observation work", async () => {
    const scheduler = new GitProcessScheduler({
      maxProcessesPerSecond: 100,
      maxProcessConcurrency: 1,
      maxQueueDepth: 4,
    });
    const releases: Array<() => void> = [];
    const started: number[] = [];

    const active = scheduler.run(createConcurrencyTask(0, started, releases));
    await vi.waitFor(() => expect(started).toEqual([0]));
    const observation = scheduler.run(createConcurrencyTask(2, started, releases), {
      class: "background",
    });
    const interactive = scheduler.run(createConcurrencyTask(3, started, releases), {
      priority: "high",
    });

    releases.shift()?.();
    await Promise.all([active, observation, interactive]);
    expect(started).toEqual([0, 3, 2]);
  });

  test("never defers a foreground submission, however deep the queue is", async () => {
    const scheduler = new GitProcessScheduler({
      maxProcessesPerSecond: 100,
      maxProcessConcurrency: 1,
      maxQueueDepth: 2,
    });
    const releases: Array<() => void> = [];
    const started: number[] = [];

    const active = scheduler.run(createConcurrencyTask(0, started, releases));
    await vi.waitFor(() => expect(started).toEqual([0]));

    // The queue is filled by background work, which yields at the bound.
    const background: Array<Promise<void>> = [];
    for (let index = 0; index < 2; index += 1) {
      background.push(
        scheduler.run(createConcurrencyTask(2, started, releases), { class: "background" }),
      );
    }
    await expect(
      scheduler.run(createConcurrencyTask(2, started, releases), { class: "background" }),
    ).rejects.toMatchObject({ name: "GitProcessQueueFullError" });

    // Every foreground command beyond the bound still enqueues and runs: a
    // workspace.create or a checkout read is never dropped for queue depth.
    const foreground = Array.from({ length: 5 }, (_, index) =>
      scheduler.run(createConcurrencyTask(3 + index, started, releases)),
    );

    releases.shift()?.();
    releases.shift()?.();
    releases.shift()?.();
    releases.shift()?.();
    releases.shift()?.();
    releases.shift()?.();
    await Promise.all([active, ...background, ...foreground]);

    expect(started).toContain(3);
    expect(started).toContain(7);
    expect(scheduler.pendingCount).toBe(0);
  });

  test("a foreground command jumps ahead of background commands already waiting", async () => {
    const scheduler = new GitProcessScheduler({
      maxProcessesPerSecond: 100,
      maxProcessConcurrency: 1,
      maxQueueDepth: 8,
    });
    const releases: Array<() => void> = [];
    const started: number[] = [];

    const active = scheduler.run(createConcurrencyTask(0, started, releases));
    await vi.waitFor(() => expect(started).toEqual([0]));
    const firstBackground = scheduler.run(createConcurrencyTask(2, started, releases), {
      class: "background",
    });
    const secondBackground = scheduler.run(createConcurrencyTask(2, started, releases), {
      class: "background",
    });
    const foreground = scheduler.run(createConcurrencyTask(3, started, releases));

    releases.shift()?.();
    await vi.waitFor(() => expect(started).toContain(3));
    releases.shift()?.();
    await vi.waitFor(() => expect(started).toContain(2));
    releases.shift()?.();
    await Promise.all([active, firstBackground, secondBackground, foreground]);

    // The foreground command overtakes both waiting sweep commands.
    expect(started).toEqual([0, 3, 2, 2]);
  });

  test("a waiting background command is admitted within the reservation, so the sweep cannot starve", async () => {
    const scheduler = new GitProcessScheduler({
      maxProcessesPerSecond: 100,
      maxProcessConcurrency: 1,
      maxQueueDepth: 64,
    });
    const started: number[] = [];
    const task = (index: number) => () => {
      started.push(index);
      const completed = Promise.resolve();
      return { result: completed, exited: completed };
    };

    // A foreground command is already running, then five more wait, and the
    // sweep's read is submitted behind them.
    const foreground = Array.from({ length: 6 }, (_, index) => scheduler.run(task(3 + index)));
    const background = scheduler.run(task(2), { class: "background" });
    await Promise.all([background, ...foreground]);

    // Foreground work has priority, but a waiting background command is
    // admitted within the reservation window, so a continuous foreground
    // stream cannot starve the sweep: it is not last in an unbounded queue.
    const backgroundIndex = started.indexOf(2);
    expect(backgroundIndex).toBeGreaterThan(0);
    expect(backgroundIndex).toBeLessThanOrEqual(2);
    expect(scheduler.pendingCount).toBe(0);
  });
});

describe("resolveGitProcessPolicy", () => {
  test("defaults the queue depth to a bounded value and honours the override", () => {
    expect(resolveGitProcessPolicy({ env: {} }).maxQueueDepth).toBe(
      DEFAULT_GIT_PROCESS_POLICY.maxQueueDepth,
    );
    expect(
      resolveGitProcessPolicy({
        env: { PASEO_GIT_MAX_QUEUE_DEPTH: "7" },
      }).maxQueueDepth,
    ).toBe(7);
  });
});

describe("resolveGitProcessPolicy", () => {
  test("prefers renamed environment variables over legacy and persisted values", () => {
    expect(
      resolveGitProcessPolicy({
        env: {
          PASEO_GIT_MAX_PROCESSES_PER_SECOND: "12",
          PASEO_GIT_MAX_PROCESS_CONCURRENCY: "7",
          PASEO_GIT_CONCURRENCY: "3",
        },
        persisted: { maxProcessesPerSecond: 5, maxProcessConcurrency: 4 },
      }),
    ).toEqual({
      maxProcessesPerSecond: 12,
      maxProcessConcurrency: 7,
      maxQueueDepth: DEFAULT_GIT_PROCESS_POLICY.maxQueueDepth,
    });
  });
});
