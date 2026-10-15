import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { analyze } from "./analyze.mjs";

const MIB = 1024 ** 2;
const SECONDS = 14400;
const RATE = 27;
const MIX = { logs: 15, inspect: 9, ls: 2, send: 1 };
// The offsets a real run shows (the 2026-10-14 23:48Z runs): a sample lands a few milliseconds
// after its 30-second slot, a call a few milliseconds after its schedule, the load ends just past
// 14,400 s, and the post-rest record follows two forced-GC passes and the 300-second rest.
const SAMPLE_OFFSET = 0.011;
const CALL_OFFSET = 0.004;
const LOAD_END_OFFSET = 0.05;
const REST_ELAPSED = 301.2;

const DEFAULTS = {
  baselineMiB: 200,
  heapAt: null, // (elapsedSeconds) => MiB; defaults to the baseline
  postRestHeapMiB: null,
  control: false,
  readStreaming: false,
  deathAt: null, // the worker's heap-limit abort at this elapsed second (a control's OOM)
};

function callKind(n) {
  const op = n % 27;
  if (op < 15) return "logs";
  if (op < 24) return "inspect";
  if (op < 26) return "ls";
  return "send";
}

const scheduledChunks = (t) => 7 * Math.floor((t / 1800) * 2048);
const zeroKinds = () => ({ logs: 0, inspect: 0, ls: 0, send: 0 });

function observation(heapMiB) {
  return {
    memory: { heapUsed: heapMiB * MIB },
    agents: {
      total: 15,
      byLifecycle: { running: 7, idle: 8 },
      withActiveForegroundTurn: 7,
      timelineStats: { totalItems: 10907 },
    },
  };
}

// A run in soak.mjs's JSONL, built the way the driver records it: calls on their 60/27-second
// schedule in the fixed 15/9/2/1 order, wall-clock minute buckets (the last one closed at load
// end), a forced-GC sample every 30 seconds carrying every cumulative counter, load-end,
// post-rest and cleanup. With `deathAt`, the worker aborts at its heap limit as the unfixed
// control did: the in-flight stream RPCs and the load-end sample fail, and there is no post-rest.
function buildRun(overrides = {}) {
  const o = { ...DEFAULTS, ...overrides };
  const heapAt = o.heapAt ?? (() => o.baselineMiB);
  const dies = o.deathAt !== null;
  const end = dies ? o.deathAt : SECONDS;
  const loadEnd = dies ? o.deathAt + 0.105 : SECONDS + LOAD_END_OFFSET;
  const calls = [];
  for (let n = 0; (n * 60) / RATE + CALL_OFFSET < end; n++) {
    calls.push({ elapsed: (n * 60) / RATE + CALL_OFFSET, kind: callKind(n) });
  }
  const records = [buildHeader(o)];
  const counted = { calls: 0, byKind: zeroKinds() };
  let next = 0;
  for (let k = 0; k * 30 + SAMPLE_OFFSET < end - (dies ? 1 : 0); k++) {
    const t = k * 30 + SAMPLE_OFFSET;
    while (next < calls.length && calls[next].elapsed <= t) {
      counted.byKind[calls[next].kind]++;
      counted.calls++;
      next++;
    }
    records.push({
      stage: "sample",
      elapsed: t,
      ...counters(counted, scheduledChunks(t), 0),
      ...observation(heapAt(t)),
    });
  }
  const minutes = buildMinutes(calls, loadEnd);
  records.push(...minutes);
  const total = { calls: calls.length, byKind: zeroKinds() };
  for (const c of calls) total.byKind[c.kind]++;
  if (dies) {
    records.push(...buildDeath(o.deathAt, total, minutes.length, loadEnd));
  } else {
    const final = counters(total, scheduledChunks(loadEnd - 0.1), 0);
    records.push({
      stage: "load-end",
      elapsed: loadEnd,
      ...structuredClone(final),
      minutes: minutes.length,
      ...observation(heapAt(SECONDS)),
    });
    records.push({
      stage: "post-rest",
      elapsed: loadEnd + REST_ELAPSED,
      ...structuredClone(final),
      ...observation(o.postRestHeapMiB ?? heapAt(SECONDS)),
    });
    records.push({ stage: "cleanup", removed: true, ...structuredClone(final) });
  }
  return records;
}

function counters(counted, streamChunks, streamErrors) {
  return {
    calls: counted.calls,
    byKind: { ...counted.byKind },
    streamChunks,
    streamErrors,
    rpcErrors: streamErrors,
    workerDeaths: 0,
  };
}

function buildHeader(o) {
  return {
    stage: "baseline",
    label: o.control ? "A-unfixed" : "B-fixed",
    control: o.control,
    boundaryCopy: false,
    readStreaming: o.readStreaming,
    fixture: {
      agents: 15,
      running: 7,
      idle: 8,
      seededRows: 10900,
      rowBytes: 2048,
      persistentClients: 13,
      subscribedClients: 2,
      streamingAgents: 7,
    },
    protocol: {
      seconds: SECONDS,
      restSeconds: 300,
      connectionsPerMinute: RATE,
      messageSeconds: 1800,
      mix: { ...MIX },
    },
    workerHeapBoundBytes: 768 * MIB,
    heapSizeLimitBytes: 960 * MIB,
    baseline: observation(o.baselineMiB),
  };
}

function buildMinutes(calls, loadEnd) {
  const buckets = [];
  for (const c of calls) {
    const index = Math.floor(c.elapsed / 60);
    while (buckets.length <= index) {
      const i = buckets.length;
      buckets.push({
        stage: "minute",
        index: i,
        elapsedStart: i * 60,
        elapsedEnd: (i + 1) * 60,
        byKind: zeroKinds(),
        calls: 0,
      });
    }
    buckets[index].byKind[c.kind]++;
    buckets[index].calls++;
  }
  buckets.at(-1).elapsedEnd = loadEnd;
  return buckets;
}

function buildDeath(deathAt, total, minutes, loadEnd) {
  const records = [
    {
      stage: "worker-exit",
      elapsed: deathAt,
      code: null,
      signal: "SIGABRT",
      stopping: false,
      oom: true,
      reason: "Reached heap limit",
    },
  ];
  for (let i = 0; i < 7; i++) {
    records.push({ stage: "rpc-error", elapsed: deathAt - 0.16, kind: "stream", message: "dead" });
  }
  records.push({ stage: "rpc-error", elapsed: loadEnd, kind: "sample", message: "worker dead" });
  const final = {
    ...counters(total, scheduledChunks(deathAt - 0.3), 7),
    rpcErrors: 8,
    workerDeaths: 1,
  };
  records.push({ stage: "load-end", elapsed: loadEnd, ...structuredClone(final), minutes });
  records.push({ stage: "cleanup", removed: true, ...structuredClone(final) });
  return records;
}

const samplesOf = (r) => r.filter((x) => x.stage === "sample");
const minutesOf = (r) => r.filter((x) => x.stage === "minute");
const sampleAt = (r, slot) => samplesOf(r).find((x) => Math.floor(x.elapsed / 30) === slot);
const one = (r, stage) => r.find((x) => x.stage === stage);
const flat = () => buildRun({ postRestHeapMiB: 199 });
// A control that rises 510,000,000 bytes over its first 30 minutes and stays there.
const leakingControl = (extra = {}) =>
  buildRun({
    control: true,
    heapAt: (t) => 200 + (Math.min(t / 1800, 1) * 510_000_000) / MIB,
    ...extra,
  });

function verdictOf(records, options) {
  return analyze(records, options).verdict;
}

function assertInconclusive(records, options, reason) {
  const result = analyze(records, options);
  assert.equal(result.verdict, "inconclusive", JSON.stringify(result.inconclusive));
  if (reason) {
    assert.ok(
      result.inconclusive.some((p) => reason.test(p)),
      `expected a problem matching ${reason}: ${JSON.stringify(result.inconclusive)}`,
    );
  }
}

// --- The driver's own format: what a real run looks like ------------------------------------

test("a flat fixed run in the driver's format passes", () => {
  const result = analyze(flat());
  assert.deepEqual(result.inconclusive, []);
  assert.equal(result.verdict, "pass");
  assert.equal(result.checks.length, 4);
});

test("a sample one call behind its schedule still passes (the real 120 s sample)", () => {
  // Floating-point accumulation of 60/27 puts a call a hair after its sample; the minute still
  // carries its 27 calls.
  const r = flat();
  const s = sampleAt(r, 4);
  s.calls -= 1;
  s.byKind.logs -= 1;
  assert.equal(verdictOf(r), "pass");
});

test("a leak above 64 MiB fails on the bound check", () => {
  const result = analyze(
    buildRun({ heapAt: (t) => 200 + (t / SECONDS) * 100, postRestHeapMiB: 300 }),
  );
  assert.equal(result.verdict, "fail");
});

test("a control that stays flat fails", () => {
  const r = buildRun({ control: true, postRestHeapMiB: 199 });
  assert.equal(verdictOf(r, { control: true }), "fail");
});

test("the real control's shape passes: a sample rises past 500 MB, then the heap-limit abort", () => {
  // As recorded at 2026-10-15T00:10Z: the 1320 s sample is 506.9 MB above baseline; the worker
  // aborts at 1337 s; the in-flight streams and the load-end sample fail; no post-rest.
  const r = buildRun({
    control: true,
    baselineMiB: 183,
    heapAt: (t) => 183 + (t / 1320) * (506_900_000 / MIB),
    deathAt: 1337.011,
  });
  const result = analyze(r, { control: true });
  assert.equal(result.verdict, "pass", JSON.stringify(result.inconclusive));
  assert.equal(result.numbers.leakElapsed, sampleAt(r, 44).elapsed);
});

test("a control whose only evidence is a timed heap-limit abort passes", () => {
  const r = buildRun({ control: true, heapAt: (t) => 200 + t / 10, deathAt: 1337.011 });
  const result = analyze(r, { control: true });
  assert.equal(result.verdict, "pass", JSON.stringify(result.inconclusive));
  assert.equal(result.numbers.leakElapsed, 1337.011);
});

test("a heap-limit abort with a sample missing before it is inconclusive", () => {
  const r = buildRun({ control: true, heapAt: (t) => 200 + t / 10, deathAt: 1337.011 });
  assertInconclusive(
    r.filter((x) => x !== sampleAt(r, 20)),
    { control: true },
    /slot/,
  );
});

// --- Round 1 findings (kept) -----------------------------------------------------------------

test("round 1 finding 1: a boundary-copy run is inconclusive", () => {
  const r = flat();
  r[0].boundaryCopy = true;
  assertInconclusive(r);
});

test("round 1 finding 1: an altered streaming period is inconclusive", () => {
  const r = flat();
  r[0].protocol.messageSeconds = 3600;
  assertInconclusive(r);
});

test("round 1 finding 1: an altered fixture is inconclusive", () => {
  const r = flat();
  r[0].fixture.seededRows = 1;
  assertInconclusive(r);
});

test("round 1 finding 2: a missing, duplicated, stretched or off-mix minute is inconclusive", () => {
  let r = flat().filter((x) => !(x.stage === "minute" && x.index === 239));
  assertInconclusive(r);
  r = flat();
  minutesOf(r)[239].index = 238;
  assertInconclusive(r);
  r = flat();
  minutesOf(r)[0].elapsedEnd = 90;
  assertInconclusive(r);
  r = flat();
  minutesOf(r)[239].byKind = { logs: 15, inspect: 9, ls: 3, send: 0 };
  assertInconclusive(r);
});

test("round 1 finding 3: missing samples and short phases are inconclusive", () => {
  let r = flat();
  assertInconclusive(r.filter((x) => x !== sampleAt(r, 240)));
  r = flat();
  assertInconclusive(r.filter((x) => !(x.stage === "sample" && x.elapsed >= 7200)));
  r = flat();
  one(r, "load-end").elapsed = 14375;
  one(r, "post-rest").elapsed = 14675;
  assertInconclusive(r);
  r = flat();
  one(r, "post-rest").elapsed = 14675;
  assertInconclusive(r);
});

test("round 1 finding 6: samples without an observed running count are inconclusive", () => {
  const r = flat();
  for (const s of samplesOf(r)) delete s.agents;
  assertInconclusive(r);
});

test("round 1 finding 7: a control rising 510,000,000 bytes passes", () => {
  assert.equal(verdictOf(leakingControl(), { control: true }), "pass");
});

test("round 1 finding 8: a control leaking only after four hours is inconclusive", () => {
  const r = buildRun({ control: true });
  one(r, "load-end").elapsed = 18000;
  one(r, "load-end").memory.heapUsed = 200 * MIB + 800_000_000;
  assertInconclusive(r, { control: true });
});

test("round 1 finding 9: 95% of the requested bound is not the bound", () => {
  const r = buildRun({ control: true, baselineMiB: 400, heapAt: () => 740 });
  assert.equal(verdictOf(r, { control: true }), "fail");
});

test("round 1 finding 9: a flat control with an unexplained death is inconclusive", () => {
  const r = buildRun({ control: true });
  r.push({ stage: "worker-exit", elapsed: 3600, code: 1, signal: null, oom: false, reason: null });
  assertInconclusive(r, { control: true });
});

test("round 1 finding 10: a sample error or death hidden by zero final counters fails", () => {
  for (const field of ["rpcErrors", "workerDeaths"]) {
    const r = flat();
    sampleAt(r, 240)[field] = 1;
    assert.equal(verdictOf(r), "fail", field);
  }
});

// --- Round 2 finding 1 (analyze.mjs:129): minute buckets must be timed and consecutive ------

test("round 2 finding 1: 240 minute buckets all covering [0, 60] are inconclusive", () => {
  const r = flat();
  for (const m of minutesOf(r)) {
    m.elapsedStart = 0;
    m.elapsedEnd = 60;
  }
  assertInconclusive(r, undefined, /minute/);
});

test("round 2 finding 1: minute buckets without start or end times are inconclusive", () => {
  const r = flat();
  for (const m of minutesOf(r)) {
    delete m.elapsedStart;
    delete m.elapsedEnd;
  }
  assertInconclusive(r, undefined, /minute/);
});

// --- Round 2 finding 2 (analyze.mjs:155): a duplicate must not hide a missing sample ---------

test("round 2 finding 2: a missing initial sample replaced by a duplicate is inconclusive", () => {
  const r = flat();
  const first = sampleAt(r, 0);
  const second = sampleAt(r, 1);
  const out = r.filter((x) => x !== first);
  out.push(structuredClone(second));
  assertInconclusive(out, undefined, /slot/);
});

// --- Round 2 finding 3 (analyze.mjs:172): instruments must be present and agree --------------

test("round 2 finding 3: samples with empty per-kind counts are inconclusive", () => {
  const r = flat();
  for (const s of samplesOf(r)) s.byKind = {};
  assertInconclusive(r);
});

test("round 2 finding 3: zero per-kind counts against 6,480 calls in minutes are inconclusive", () => {
  const r = flat();
  for (const s of samplesOf(r)) s.byKind = zeroKinds();
  assertInconclusive(r);
});

test("round 2 finding 3: zero delivered stream chunks are inconclusive", () => {
  const r = flat();
  for (const x of r) if ("streamChunks" in x) x.streamChunks = 0;
  assertInconclusive(r, undefined, /stream/);
});

test("round 2 finding 3: absent error and death counters are inconclusive", () => {
  const r = flat();
  for (const x of r) {
    delete x.rpcErrors;
    delete x.streamErrors;
    delete x.workerDeaths;
  }
  assertInconclusive(r);
});

// --- Round 2 finding 4 (analyze.mjs:66): a sample's stream error must survive ----------------

test("round 2 finding 4: a sample's stream error hidden by zero final counters fails", () => {
  const r = flat();
  sampleAt(r, 240).streamErrors = 1;
  const result = analyze(r);
  assert.equal(result.verdict, "fail");
  assert.equal(result.numbers.streamErrors, 1);
});

// --- Round 2 finding 5 (analyze.mjs:224): only a timed heap-limit abort qualifies -----------

test("round 2 finding 5: an unrelated SIGABRT does not qualify a flat control", () => {
  const r = buildRun({ control: true });
  r.push({
    stage: "worker-exit",
    elapsed: 600.5,
    code: null,
    signal: "SIGABRT",
    oom: false,
    reason: "intentional process.abort()",
  });
  assertInconclusive(r, { control: true });
});

test("round 2 finding 5: an untimed heap-limit abort with no load does not qualify", () => {
  const r = [buildRun({ control: true })[0]];
  r.push({
    stage: "worker-exit",
    code: null,
    signal: "SIGABRT",
    oom: true,
    reason: "Reached heap limit",
  });
  assertInconclusive(r, { control: true });
});

test("round 2 finding 5: a timed heap-limit abort without the load before it does not qualify", () => {
  const r = buildRun({ control: true, heapAt: (t) => 200 + t / 10, deathAt: 1337.011 }).filter(
    (x) => !["sample", "minute"].includes(x.stage),
  );
  assertInconclusive(r, { control: true });
});

// --- Round 2 finding 6 (analyze.mjs:99): the control reads the idle agents ---------------------

test("round 2 finding 6: a control reading streaming agents is inconclusive", () => {
  assertInconclusive(leakingControl({ readStreaming: true }), { control: true }, /readStreaming/);
});

// --- Round 2 finding 7 (analyze.mjs:253): the last-hour window needs the load end ----------

test("round 2 finding 7: a last-hour rise without a load-end record does not pass", () => {
  const r = buildRun({ heapAt: (t) => 200 + (Math.max(0, t - 10800) / 3600) * 20 });
  assert.equal(verdictOf(r), "fail");
  // The validator's control: the final load point recorded as one more sample, not as load-end.
  one(r, "load-end").stage = "sample";
  assertInconclusive(r, undefined, /load-end/);
  assert.ok(analyze(r).numbers.slopeBytesPerHour >= 16 * MIB);
});

// --- Audit: anything absent, duplicated or contradictory is never PASS ----------------------

test("audit: a header whose control flag contradicts the mode is inconclusive", () => {
  assertInconclusive(flat(), { control: true }, /control/);
  assertInconclusive(leakingControl(), undefined, /control/);
});

test("audit: absent run identity in the header is inconclusive", () => {
  for (const drop of [
    (h) => delete h.boundaryCopy,
    (h) => delete h.readStreaming,
    (h) => delete h.heapSizeLimitBytes,
    (h) => delete h.label,
    (h) => delete h.baseline.agents,
    (h) => (h.baseline.agents.byLifecycle.running = 6),
    (h) => (h.baseline.agents.timelineStats.totalItems = 100),
  ]) {
    const r = flat();
    drop(r[0]);
    assertInconclusive(r);
  }
});

test("audit: a duplicated baseline, load-end, post-rest or cleanup record is inconclusive", () => {
  for (const stage of ["baseline", "load-end", "post-rest", "cleanup"]) {
    const r = flat();
    r.push(structuredClone(one(r, stage)));
    assertInconclusive(r, undefined, new RegExp(stage));
  }
});

test("audit: a missing load-end, post-rest or cleanup record is inconclusive", () => {
  for (const stage of ["load-end", "post-rest", "cleanup"]) {
    assertInconclusive(
      flat().filter((x) => x.stage !== stage),
      undefined,
      new RegExp(stage),
    );
  }
});

test("audit: a sample without a numeric heapUsed is not silently dropped", () => {
  const r = flat();
  delete sampleAt(r, 240).memory;
  assertInconclusive(r, undefined, /sample/);
});

test("audit: an extra sample off its 30-second slot is inconclusive", () => {
  const r = flat();
  r.push({ ...structuredClone(sampleAt(r, 0)), elapsed: 15 });
  assertInconclusive(r, undefined, /slot/);
});

test("audit: a sample after the four hours of load is inconclusive", () => {
  const r = flat();
  r.push({ ...structuredClone(sampleAt(r, 479)), elapsed: 14400.02 });
  assertInconclusive(r);
});

test("audit: a minute beyond the four hours is inconclusive", () => {
  const r = flat();
  const last = minutesOf(r)[239];
  r.push({ ...structuredClone(last), index: 240, elapsedStart: last.elapsedEnd });
  assertInconclusive(r, undefined, /minute/);
});

test("audit: a minute index far past the load is malformed and does not stall the analyzer", () => {
  const r = flat();
  minutesOf(r)[239].index = 1e12;
  assertInconclusive(r, undefined, /minute/);
});

test("audit: a counter that is present but not a count is inconclusive", () => {
  const r = flat();
  one(r, "load-end").rpcErrors = "0";
  assertInconclusive(r, undefined, /load-end/);
});

test("audit: a decreasing cumulative call count is inconclusive", () => {
  const r = flat();
  const s = sampleAt(r, 101);
  s.calls = sampleAt(r, 100).calls - 1;
  s.byKind = { ...sampleAt(r, 100).byKind, logs: sampleAt(r, 100).byKind.logs - 1 };
  assertInconclusive(r);
});

test("audit: load-end calls that disagree with the minutes are inconclusive", () => {
  const r = flat();
  one(r, "load-end").calls += 27;
  one(r, "load-end").byKind.logs += 27;
  assertInconclusive(r, undefined, /load-end/);
});

test("audit: calls during the rest are inconclusive", () => {
  const r = flat();
  one(r, "post-rest").calls += 1;
  one(r, "post-rest").byKind.ls += 1;
  assertInconclusive(r, undefined, /post-rest/);
});

test("audit: a rest far longer than five minutes is inconclusive", () => {
  const r = flat();
  one(r, "post-rest").elapsed += 3 * 3600;
  assertInconclusive(r, undefined, /rest/);
});

test("audit: an RPC error event missing from every counter still fails", () => {
  const r = flat();
  r.push({ stage: "rpc-error", elapsed: 7200, kind: "logs", message: "injected" });
  assert.equal(verdictOf(r), "fail");
});

test("audit: a worker exit marked as the harness's own stop mid-run is inconclusive", () => {
  const r = flat();
  r.push({ stage: "worker-exit", elapsed: 7200, code: null, signal: "SIGTERM", stopping: true });
  assertInconclusive(r, undefined, /stop/);
});

test("audit: a control with an RPC error before its leak point is inconclusive", () => {
  const r = leakingControl();
  for (const s of samplesOf(r)) if (s.elapsed > 300) s.rpcErrors = 1;
  assertInconclusive(r, { control: true }, /before the leak point/);
});

test("audit: an unparseable JSONL line makes the CLI inconclusive", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "heap-soak-test-"));
  try {
    const file = path.join(dir, "run.jsonl");
    const lines = flat().map((x) => JSON.stringify(x));
    lines.splice(300, 0, '{"stage":"sample","elapsed":');
    fs.writeFileSync(file, lines.join("\n") + "\n");
    const analyzer = fileURLToPath(new URL("./analyze.mjs", import.meta.url));
    const run = spawnSync(process.execPath, [analyzer, file], { encoding: "utf8" });
    assert.equal(run.status, 2, run.stdout + run.stderr);
    assert.match(run.stdout, /unparseable/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
