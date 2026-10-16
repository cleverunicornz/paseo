// Compiled-payload probe: the loop-blocker instrumentation reports the three
// series P-000289 H3 asks for. `argv[2]` is the built server's `dist/server`.
//
// The r1 gate proved the instrumentation by the string `LoopHealthMonitor`,
// which says nothing about whether a snapshot carries the series. Here the
// built monitor is started, a known GC pause and a known timer delay are
// produced, and the snapshot must report the lateness, GC and handle series.
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(process.argv[2] ?? "");
const { LoopHealthMonitor } = await import(pathToFileURL(path.join(root, "server/loop-health.js")));
assert.equal(typeof LoopHealthMonitor, "function", "the built loop-health monitor is absent");

const monitor = new LoopHealthMonitor({ probeIntervalMs: 5 });
// Hold two real handles for the probe's life: the handle series is a count of
// what the process keeps active, so with none held it correctly reads zero and
// proves nothing. A listening socket and an open file descriptor are exactly
// the kinds the H3 series exists to separate.
const { createServer } = await import("node:net");
const { mkdtemp, open, rm, writeFile } = await import("node:fs/promises");
const handleDir = await mkdtemp(path.join((await import("node:os")).tmpdir(), "loop-probe-"));
const handlePath = path.join(handleDir, "handle.txt");
await writeFile(handlePath, "held for the handle series\n");
const server = createServer();
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});
const fileHandle = await open(handlePath, "r");

monitor.start();
try {
  // Burn the loop past its own probe interval so the lateness series sees it.
  const burnUntil = Date.now() + 60;
  while (Date.now() < burnUntil) {
    // Deliberately synchronous: a timer's lateness is what the series measures.
  }
  if (globalThis.gc) {
    for (let index = 0; index < 3; index += 1) globalThis.gc();
  }
  await new Promise((resolve) => setTimeout(resolve, 60));
  const snapshot = monitor.snapshot();

  const observed = {
    probe: "loop-instrumentation",
    timerLatenessCount: snapshot.timerLateness.count,
    timerLatenessMaxMs: snapshot.timerLateness.maxMs,
    gcCount: snapshot.gc.count,
    gcKeys: Object.keys(snapshot.gc).sort(),
    heapKeys: Object.keys(snapshot.heap).sort(),
    nativeHandleTotal: snapshot.nativeHandles.total,
    nativeHandleByTypeIsArray: Array.isArray(snapshot.nativeHandles.byType),
  };
  process.stdout.write(`${JSON.stringify(observed)}\n`);

  assert.ok(snapshot.timerLateness.count > 0, "the microtask-aware lateness series is empty");
  assert.ok(snapshot.timerLateness.maxMs > 0, "the lateness series never saw the deliberate block");
  assert.deepEqual(
    observed.gcKeys,
    ["byKind", "count", "maxPauseMs", "totalPauseMs"],
    "the GC series is absent",
  );
  assert.deepEqual(
    observed.heapKeys,
    ["externalBytes", "heapTotalBytes", "heapUsedBytes", "heapUsedDeltaBytes", "rssBytes"],
    "the heap series is incomplete",
  );
  assert.ok(snapshot.nativeHandles.total > 0, "the native handle count is absent");
  assert.ok(observed.nativeHandleByTypeIsArray, "the native handle breakdown is absent");
} finally {
  monitor.stop();
  await fileHandle.close();
  await new Promise((resolve) => server.close(resolve));
  await rm(handleDir, { recursive: true, force: true });
}
