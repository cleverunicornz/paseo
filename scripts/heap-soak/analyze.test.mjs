import assert from "node:assert/strict";
import test from "node:test";

import { analyze } from "./analyze.mjs";

const MIB = 1024 ** 2;
const SECONDS = 14400;
const REST_SECONDS = 300;
const RATE = 27;
const MIX = { logs: 15, inspect: 9, ls: 2, send: 1 };

// A full-shape run (default 4 hours) so the analyzer's real protocol numbers are exercised. Every
// record matches soak.mjs's JSONL: a header line, 30-second samples with cumulative per-kind
// counts, wall-clock minute buckets, load-end, post-rest and cleanup.
const DEFAULTS = {
  seconds: SECONDS,
  restSeconds: REST_SECONDS,
  rate: RATE,
  mix: MIX,
  messageSeconds: 1800,
  rowBytes: 2048,
  streamingAgents: 7,
  running: 7,
  seededRows: 10900,
  baselineMiB: 200,
  heapAt: null, // (elapsedSeconds) => MiB; defaults to the baseline
  postRestHeapMiB: null,
  control: false,
  boundaryCopy: false,
  readStreaming: false,
  heapSizeLimitMiB: 960,
  workerHeapBoundMiB: 768,
  workerDeaths: 0,
  workerExit: null,
  rpcErrors: 0,
  streamErrors: 0,
  sampleErrorAt: null,
  sampleDeathAt: null,
  hideSampleRunning: false,
};

function buildRun(overrides = {}) {
  const o = { ...DEFAULTS, ...overrides };
  const heapAt = o.heapAt ?? (() => o.baselineMiB);
  const records = [];
  records.push(
    buildHeader({ ...o, heapAt, baseline: o.baselineMiB * MIB }),
  );

  const calls = buildSamples(records, { ...o, heapAt });

  const minuteCount = Math.round(o.seconds / 60);
  for (let i = 0; i < minuteCount; i++) {
    records.push({
      stage: "minute",
      index: i,
      elapsedStart: i * 60,
      elapsedEnd: (i + 1) * 60,
      calls: o.rate,
      byKind: { ...o.mix },
    });
  }
  records.push({
    stage: "load-end",
    elapsed: o.seconds,
    calls: calls.total,
    byKind: { ...calls.byKind },
    minutes: minuteCount,
    streamChunks: o.seconds,
    streamErrors: o.streamErrors,
    rpcErrors: o.rpcErrors,
    workerDeaths: o.workerDeaths,
    memory: { heapUsed: heapAt(o.seconds) * MIB },
  });
  const restHeap = o.postRestHeapMiB ?? heapAt(o.seconds);
  records.push({
    stage: "post-rest",
    elapsed: o.seconds + o.restSeconds,
    memory: { heapUsed: restHeap * MIB },
    rpcErrors: o.rpcErrors,
    workerDeaths: o.workerDeaths,
  });
  if (o.workerExit)
    records.push({ stage: "worker-exit", elapsed: o.workerExit.elapsed, ...o.workerExit });
  records.push({ stage: "cleanup", rpcErrors: o.rpcErrors, workerDeaths: o.workerDeaths, calls: calls.total });
  return records;
}

function buildHeader(o) {
  return {
    stage: "baseline",
    label: "synthetic",
    control: o.control,
    boundaryCopy: o.boundaryCopy,
    readStreaming: o.readStreaming,
    fixture: {
      agents: 15,
      running: 7,
      idle: 8,
      seededRows: o.seededRows,
      rowBytes: o.rowBytes,
      persistentClients: 13,
      subscribedClients: 2,
      streamingAgents: o.streamingAgents,
    },
    protocol: {
      seconds: o.seconds,
      restSeconds: o.restSeconds,
      connectionsPerMinute: o.rate,
      messageSeconds: o.messageSeconds,
      mix: o.mix,
    },
    workerHeapBoundBytes: o.workerHeapBoundMiB * MIB,
    heapSizeLimitBytes: o.heapSizeLimitMiB * MIB,
    baseline: { memory: { heapUsed: o.baseline } },
  };
}

function kindOf(op) {
  if (op < 15) return "logs";
  if (op < 24) return "inspect";
  if (op < 26) return "ls";
  return "send";
}

function buildSamples(records, o) {
  const byKind = { logs: 0, inspect: 0, ls: 0, send: 0 };
  let total = 0;
  const sampleCount = Math.floor(o.seconds / 30);
  for (let i = 0; i < sampleCount; i++) {
    const t = i * 30;
    // 27 calls a minute, in the fixed order, up to time t.
    const due = Math.floor((t / 60) * o.rate);
    while (total < due) {
      byKind[kindOf(total % 27)]++;
      total++;
    }
    records.push({
      stage: "sample",
      elapsed: t,
      memory: { heapUsed: o.heapAt(t) * MIB },
      calls: total,
      byKind: { ...byKind },
      minutes: Math.min(Math.floor(t / 60), Math.round(o.seconds / 60)),
      streamChunks: Math.floor(t),
      streamErrors: o.streamErrors,
      rpcErrors: o.sampleErrorAt === t ? o.rpcErrors + 1 : o.rpcErrors,
      workerDeaths: o.sampleDeathAt === t ? o.workerDeaths + 1 : o.workerDeaths,
      ...(o.hideSampleRunning ? {} : { agents: { byLifecycle: { running: o.running } } }),
    });
  }
  return { total, byKind };
}

function veto(result) {
  return result.verdict === "inconclusive";
}

// --- Finding 1: a diagnostic copy or altered protocol settings must never PASS ---------------

test("finding 1: a boundary-copy run is inconclusive", () => {
  const result = analyze(buildRun({ boundaryCopy: true, postRestHeapMiB: 200 }));
  assert.ok(veto(result), "boundary-copy must not qualify");
});

test("finding 1: an altered streaming period is inconclusive", () => {
  const result = analyze(buildRun({ messageSeconds: 3600, postRestHeapMiB: 200 }));
  assert.ok(veto(result));
});

test("finding 1: an altered fixture is inconclusive", () => {
  const result = analyze(buildRun({ seededRows: 1, postRestHeapMiB: 200 }));
  assert.ok(veto(result));
});

// --- Finding 2: wall-clock minutes, complete consecutive coverage ---------------------------

test("finding 2: a missing minute is inconclusive", () => {
  const r = buildRun({ postRestHeapMiB: 200 }).filter(
    (x) => !(x.stage === "minute" && x.index === 239),
  );
  assert.ok(veto(analyze(r)));
});

test("finding 2: a duplicated minute index is inconclusive", () => {
  const r = buildRun({ postRestHeapMiB: 200 });
  r.find((x) => x.stage === "minute" && x.index === 239).index = 238;
  assert.ok(veto(analyze(r)));
});

test("finding 2: a 90-second minute bucket is inconclusive", () => {
  const r = buildRun({ postRestHeapMiB: 200 });
  r.find((x) => x.stage === "minute" && x.index === 0).elapsedEnd = 90;
  assert.ok(veto(analyze(r)));
});

test("finding 2: an off-mix minute is inconclusive", () => {
  const r = buildRun({ postRestHeapMiB: 200 });
  r.find((x) => x.stage === "minute" && x.index === 239).byKind = { logs: 15, inspect: 9, ls: 3, send: 0 };
  assert.ok(veto(analyze(r)));
});

// --- Finding 3: missing samples and shortened phases ----------------------------------------

test("finding 3: a missing 30-second sample is inconclusive", () => {
  const r = buildRun({ postRestHeapMiB: 200 }).filter(
    (x) => !(x.stage === "sample" && x.elapsed === 7200),
  );
  assert.ok(veto(analyze(r)));
});

test("finding 3: half the samples missing is inconclusive", () => {
  const r = buildRun({ postRestHeapMiB: 200 }).filter(
    (x) => !(x.stage === "sample" && x.elapsed >= 7200),
  );
  assert.ok(veto(analyze(r)));
});

test("finding 3: a load 25 seconds short is inconclusive", () => {
  const r = buildRun({ postRestHeapMiB: 200 });
  r.find((x) => x.stage === "load-end").elapsed = 14375;
  r.find((x) => x.stage === "post-rest").elapsed = 14675;
  assert.ok(veto(analyze(r)));
});

test("finding 3: a rest 25 seconds short is inconclusive", () => {
  const r = buildRun({ postRestHeapMiB: 200 });
  r.find((x) => x.stage === "post-rest").elapsed = 14675;
  assert.ok(veto(analyze(r)));
});

// --- Finding 6: altered observations must not qualify ---------------------------------------

test("finding 6: a sample without an observed running count is inconclusive", () => {
  const result = analyze(buildRun({ hideSampleRunning: true, postRestHeapMiB: 200 }));
  assert.ok(veto(result));
});

// --- Finding 7: the control threshold is decimal MB -----------------------------------------

test("finding 7: a control rising 510,000,000 bytes passes", () => {
  const result = analyze(
    buildRun({
      control: true,
      heapAt: (t) => 200 + Math.min(t / 1800, 1) * (510_000_000 / MIB),
      postRestHeapMiB: 200 + 510_000_000 / MIB,
    }),
    { control: true },
  );
  assert.equal(result.verdict, "pass");
});

// --- Finding 8: control success is bounded to the first four hours --------------------------

test("finding 8: a control reaching the bound at 600 s passes", () => {
  const r = buildRun({ control: true, heapAt: () => 200 }).filter(
    (x) => !["sample", "minute", "load-end", "post-rest"].includes(x.stage) || (x.elapsed ?? 0) < 600,
  );
  r.push({ stage: "worker-exit", elapsed: 600, code: null, signal: "SIGABRT", reason: "Reached heap limit" });
  r.push({ stage: "load-end", elapsed: 600, memory: { heapUsed: 955 * MIB }, workerDeaths: 1, rpcErrors: 0 });
  r.find((x) => x.stage === "cleanup").workerDeaths = 1;
  const result = analyze(r, { control: true });
  assert.equal(result.verdict, "pass");
});

test("finding 8: a control leaking only after four hours is inconclusive", () => {
  const r = buildRun({ control: true, heapAt: () => 200 });
  r.find((x) => x.stage === "load-end").elapsed = 18000;
  r.find((x) => x.stage === "load-end").memory.heapUsed = 200 * MIB + 800_000_000;
  assert.ok(veto(analyze(r, { control: true })));
});

// --- Finding 9: a heap-bound event is the worker's own heap limit ---------------------------

test("finding 9: a control flat below the bound but with an unexplained death is inconclusive", () => {
  const r = buildRun({ control: true, heapAt: () => 200, workerDeaths: 1 });
  r.push({ stage: "worker-exit", elapsed: 3600, code: 1, signal: null, reason: null, oom: false });
  r.find((x) => x.stage === "cleanup").workerDeaths = 1;
  assert.ok(veto(analyze(r, { control: true })));
});

test("finding 9: 95% of the requested bound is not the bound", () => {
  const result = analyze(
    buildRun({
      control: true,
      baselineMiB: 400,
      heapAt: () => 740,
      postRestHeapMiB: 740,
      heapSizeLimitMiB: 960,
    }),
    { control: true },
  );
  assert.equal(result.verdict, "fail");
});

// --- Finding 10: final counters must not erase observed errors or deaths ---------------------

test("finding 10: a sample error hidden by zero cleanup counters fails", () => {
  const r = buildRun({ sampleErrorAt: 7200, postRestHeapMiB: 200 });
  r.find((x) => x.stage === "sample" && x.elapsed === 7200).rpcErrors = 1;
  r.find((x) => x.stage === "cleanup").rpcErrors = 0;
  r.find((x) => x.stage === "load-end").rpcErrors = 0;
  assert.equal(analyze(r).verdict, "fail");
});

test("finding 10: a sample death hidden by zero cleanup counters fails", () => {
  const r = buildRun({ sampleDeathAt: 7200, postRestHeapMiB: 200 });
  r.find((x) => x.stage === "sample" && x.elapsed === 7200).workerDeaths = 1;
  r.find((x) => x.stage === "cleanup").workerDeaths = 0;
  r.find((x) => x.stage === "load-end").workerDeaths = 0;
  assert.equal(analyze(r).verdict, "fail");
});

// --- Baseline pass/fail shapes ---------------------------------------------------------------

test("a flat fixed run with a clean protocol passes", () => {
  const result = analyze(buildRun({ heapAt: () => 200, postRestHeapMiB: 199 }));
  assert.equal(result.verdict, "pass");
  assert.equal(result.checks.length, 4);
});

test("a leak above 64 MiB fails on the bound check", () => {
  const result = analyze(
    buildRun({ heapAt: (t) => 200 + (t / SECONDS) * 100, postRestHeapMiB: 300 }),
  );
  assert.equal(result.verdict, "fail");
});

test("a control that stays flat fails", () => {
  const result = analyze(buildRun({ control: true, heapAt: () => 200, postRestHeapMiB: 199 }), {
    control: true,
  });
  assert.equal(result.verdict, "fail");
});
