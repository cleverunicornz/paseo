// Compiled-payload probe: the git scheduler's queue bound behaves as the fix
// specifies. `argv[2]` is the built server's `dist/server`.
//
// This is a behavioral probe, not a marker search. The validator's r1 negative
// control disabled the bound by removing the admission check while leaving
// every marker string in place; a marker gate passed it. Here the built
// scheduler must actually refuse the overflow and admit the foreground work.
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(process.argv[2] ?? "");
const { GitProcessScheduler, GitProcessQueueFullError } = await import(
  pathToFileURL(path.join(root, "utils/git-process-scheduler.js"))
);
assert.equal(typeof GitProcessScheduler, "function", "the built scheduler is absent");
assert.equal(typeof GitProcessQueueFullError, "function", "the named refusal is absent");

const policy = { maxProcessConcurrency: 1, maxProcessesPerSecond: 20_000, maxQueueDepth: 4 };
const scheduler = new GitProcessScheduler(policy);

// One long command holds the single concurrency slot while the queue fills.
const held = Promise.withResolvers();
const started = Promise.withResolvers();
const active = scheduler.run(() => {
  started.resolve();
  return { result: held.promise, exited: held.promise };
});
await started.promise;

let backgroundStarted = 0;
let backgroundRefused = 0;
const background = Array.from({ length: 100 }, () =>
  scheduler
    .run(
      () => {
        backgroundStarted += 1;
        return { result: Promise.resolve(), exited: Promise.resolve() };
      },
      { class: "background" },
    )
    .catch((error) => {
      if (error instanceof GitProcessQueueFullError && error.code === "GIT_PROCESS_QUEUE_FULL") {
        backgroundRefused += 1;
        return;
      }
      throw error;
    }),
);
await Promise.resolve();
const backgroundPending = scheduler.pendingCount;

let foregroundCompleted = 0;
const foreground = Array.from({ length: 64 }, () =>
  scheduler.run(() => ({
    result: Promise.resolve().then(() => {
      foregroundCompleted += 1;
    }),
    exited: Promise.resolve(),
  })),
);

held.resolve();
await Promise.all([active, ...background, ...foreground]);

const observed = {
  probe: "scheduler-bound",
  maxQueueDepth: policy.maxQueueDepth,
  backgroundSubmissions: 100,
  backgroundPending,
  backgroundRefused,
  backgroundStarted,
  foregroundCompleted,
};
process.stdout.write(`${JSON.stringify(observed)}\n`);

assert.equal(backgroundPending, 4, "the bound did not hold: the queue admitted past its depth");
assert.equal(backgroundRefused, 96, "the overflow was not refused: the backlog can grow unbounded");
assert.equal(backgroundStarted, 4, "more background commands started than the bound allows");
assert.equal(foregroundCompleted, 64, "foreground work was refused for queue depth");
