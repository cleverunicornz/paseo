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
// 14,400 s. The driver stamps every record with the wall clock (`time`) as it logs it, on the same
// clock as `elapsed`, which starts as the baseline is logged: a forced-GC sample is logged about
// 0.7 s after its `elapsed` (its stream, call and GC), a minute bucket when the next minute's first
// call has run, load-end after its forced-GC sample, then the 300-second rest, then post-rest.
const SAMPLE_OFFSET = 0.011;
const CALL_OFFSET = 0.004;
const CALL_SECONDS = 0.1;
const LOAD_END_OFFSET = 0.05;
const GC_SAMPLE_SECONDS = 0.7;
const REST_SLEEP_SECONDS = 300;
const LOAD_START_MS = Date.UTC(2026, 9, 14, 23, 48, 25, 478);
const ERROR_KINDS = ["logs", "inspect", "ls", "send", "stream", "sample", "other"];
// A record's wall-clock `time` at this many seconds after the load started.
const wall = (seconds) => new Date(LOAD_START_MS + Math.round(seconds * 1000)).toISOString();

const DEFAULTS = {
  baselineMiB: 200,
  heapAt: null, // (elapsedSeconds) => MiB; defaults to the baseline
  postRestHeapMiB: null,
  control: false,
  readStreaming: false,
  deathAt: null, // the worker's heap-limit abort at this elapsed second (a control's OOM)
  sampleSeconds: () => GC_SAMPLE_SECONDS, // (elapsed) => how long that forced-GC sample took
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
const zeroErrors = () => Object.fromEntries(ERROR_KINDS.map((k) => [k, 0]));

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
// end), a forced-GC sample every 30 seconds carrying every cumulative counter (calls, calls by
// kind, closed minutes, stream chunks, errors, errors by kind, deaths), load-end, post-rest and
// cleanup. With `deathAt`, the worker aborts at its heap limit as the unfixed control did: the
// in-flight stream RPCs, the load-end sample and the post-rest sample fail, and there is no
// post-rest record.
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
      time: wall(t + o.sampleSeconds(t)),
      stage: "sample",
      elapsed: t,
      ...counters(counted, scheduledChunks(t), 0),
      minutes: next === 0 ? 0 : Math.floor(calls[next - 1].elapsed / 60),
      errorsByKind: zeroErrors(),
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
      time: wall(loadEnd + GC_SAMPLE_SECONDS),
      stage: "load-end",
      elapsed: loadEnd,
      ...structuredClone(final),
      minutes: minutes.length,
      errorsByKind: zeroErrors(),
      ...observation(heapAt(SECONDS)),
    });
    const restEnd = loadEnd + GC_SAMPLE_SECONDS + REST_SLEEP_SECONDS + GC_SAMPLE_SECONDS;
    records.push({
      time: wall(restEnd),
      stage: "post-rest",
      elapsed: restEnd,
      ...structuredClone(final),
      ...observation(o.postRestHeapMiB ?? heapAt(SECONDS)),
    });
    records.push({ time: wall(restEnd + 0.5), stage: "cleanup", ...structuredClone(final) });
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
    time: wall(0),
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
        // closed once the next minute's first call has run
        time: wall((i + 1) * 60 + CALL_OFFSET + CALL_SECONDS),
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
  buckets.at(-1).time = wall(loadEnd);
  return buckets;
}

// The real control's death path (2026-10-15T00:10:42Z): the exit is logged; the exit handler then
// rejects the pending stream RPC and every later RPC fails at once; the loop ends, the load-end
// sample fails, and after the rest so does the post-rest sample. Every failure is an event, and
// every later record counts it.
function buildDeath(deathAt, total, minutes, loadEnd) {
  const records = [
    {
      time: wall(deathAt),
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
    const message = i === 0 ? "worker exit null" : "worker dead";
    const stream = { stage: "rpc-error", elapsed: deathAt - 0.16, kind: "stream", message };
    records.push({ time: wall(deathAt + 0.001), ...stream });
  }
  const sampleFailure = { stage: "rpc-error", elapsed: loadEnd, kind: "sample" };
  records.push({ time: wall(loadEnd), ...sampleFailure, message: "worker dead" });
  const final = {
    ...counters(total, scheduledChunks(deathAt - 0.3), 7),
    rpcErrors: 8,
    workerDeaths: 1,
  };
  records.push({
    time: wall(loadEnd),
    stage: "load-end",
    elapsed: loadEnd,
    ...structuredClone(final),
    minutes,
  });
  const restFailure = { stage: "rpc-error", elapsed: loadEnd + 300.086, kind: "other" };
  records.push({ time: wall(loadEnd + 300.086), ...restFailure, message: "worker dead" });
  records.push({
    time: wall(loadEnd + REST_SLEEP_SECONDS + 15),
    stage: "cleanup",
    ...structuredClone(final),
    rpcErrors: 9,
  });
  return records;
}

const samplesOf = (r) => r.filter((x) => x.stage === "sample");
const minutesOf = (r) => r.filter((x) => x.stage === "minute");
const sampleAt = (r, slot) => samplesOf(r).find((x) => Math.floor(x.elapsed / 30) === slot);
const one = (r, stage) => r.find((x) => x.stage === stage);
const COUNTED = new Set(["sample", "load-end", "post-rest", "cleanup"]);

// Record an RPC failure as the driver does: an event dispatched at `elapsed` and logged at
// `loggedAt`, counted by every later record (rpcErrors, streamErrors for a stream, errorsByKind).
function injectError(r, elapsed, kind, message = "injected", loggedAt = elapsed + CALL_SECONDS) {
  const time = wall(loggedAt);
  r.push({ time, stage: "rpc-error", elapsed, kind, message });
  for (const x of r) {
    if (!COUNTED.has(x.stage) || Date.parse(x.time) < Date.parse(time)) continue;
    x.rpcErrors += 1;
    if (kind === "stream") x.streamErrors += 1;
    if (x.errorsByKind) x.errorsByKind[kind] += 1;
  }
  return r;
}

// Set the rest as the driver would record it: the load-end record logged `loadEndSample` seconds
// after the load end (its forced-GC sample), the post-rest record `rest` seconds after that.
function withRest(r, rest, loadEndSample = GC_SAMPLE_SECONDS) {
  const end = one(r, "load-end");
  const post = one(r, "post-rest");
  const cleanup = one(r, "cleanup");
  end.time = wall(end.elapsed + loadEndSample);
  post.elapsed = end.elapsed + loadEndSample + rest;
  post.time = wall(post.elapsed);
  cleanup.time = wall(post.elapsed + 0.5);
  return r;
}
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

// Every inconclusive case names the problem it reproduces, so an unrelated problem cannot make it
// pass.
function assertInconclusive(records, reason, options) {
  const result = analyze(records, options);
  assert.equal(result.verdict, "inconclusive", JSON.stringify(result.inconclusive));
  assert.ok(
    result.inconclusive.some((p) => reason.test(p)),
    `expected a problem matching ${reason}: ${JSON.stringify(result.inconclusive)}`,
  );
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
  s.minutes = 1; // its last call is then minute 1's last
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
    /1 sample slot\(s\) missing \(first at 600s\)/,
    { control: true },
  );
});

// --- Round 1 findings (kept) -----------------------------------------------------------------

test("round 1 finding 1: a boundary-copy run is inconclusive", () => {
  const r = flat();
  r[0].boundaryCopy = true;
  assertInconclusive(r, /boundaryCopy true/);
});

test("round 1 finding 1: an altered streaming period is inconclusive", () => {
  const r = flat();
  r[0].protocol.messageSeconds = 3600;
  assertInconclusive(r, /protocol.messageSeconds 3600 != 1800/);
});

test("round 1 finding 1: an altered fixture is inconclusive", () => {
  const r = flat();
  r[0].fixture.seededRows = 1;
  assertInconclusive(r, /fixture.seededRows 1 != 10900/);
});

test("round 1 finding 2: a missing, duplicated, stretched or off-mix minute is inconclusive", () => {
  let r = flat().filter((x) => !(x.stage === "minute" && x.index === 239));
  assertInconclusive(r, /minute index\(es\) missing \(first 239\)/);
  r = flat();
  minutesOf(r)[239].index = 238;
  assertInconclusive(r, /1 duplicated minute index/);
  r = flat();
  minutesOf(r)[0].elapsedEnd = 90;
  assertInconclusive(r, /1 off-protocol minute/);
  r = flat();
  minutesOf(r)[239].byKind = { logs: 15, inspect: 9, ls: 3, send: 0 };
  assertInconclusive(r, /1 off-protocol minute/);
});

test("round 1 finding 3: missing samples and short phases are inconclusive", () => {
  let r = flat();
  assertInconclusive(
    r.filter((x) => x !== sampleAt(r, 240)),
    /1 sample slot\(s\) missing \(first at 7200s\)/,
  );
  r = flat();
  assertInconclusive(
    r.filter((x) => !(x.stage === "sample" && x.elapsed >= 7200)),
    /240 sample slot\(s\) missing \(first at 7200s\)/,
  );
  r = flat();
  one(r, "load-end").elapsed = 14375;
  one(r, "post-rest").elapsed = 14675;
  assertInconclusive(r, /load ran 14375.0s, expected 14400s/);
  assertInconclusive(withRest(flat(), 275), /rest ran 275.0s, expected 300s/);
});

test("round 1 finding 6: samples without an observed running count are inconclusive", () => {
  const r = flat();
  for (const s of samplesOf(r)) delete s.agents;
  assertInconclusive(r, /480 sample\(s\) without an observed running-agent count/);
});

test("round 1 finding 7: a control rising 510,000,000 bytes passes", () => {
  assert.equal(verdictOf(leakingControl(), { control: true }), "pass");
});

test("round 1 finding 8: a control leaking only after four hours is inconclusive", () => {
  const r = buildRun({ control: true });
  one(r, "load-end").elapsed = 18000;
  one(r, "load-end").memory.heapUsed = 200 * MIB + 800_000_000;
  assertInconclusive(r, /load ran 18000.0s, expected 14400s/, { control: true });
});

test("round 1 finding 9: 95% of the requested bound is not the bound", () => {
  const r = buildRun({ control: true, baselineMiB: 400, heapAt: () => 740 });
  assert.equal(verdictOf(r, { control: true }), "fail");
});

test("round 1 finding 9: a flat control with an unexplained death is inconclusive", () => {
  const r = buildRun({ control: true });
  r.push({
    time: wall(3600),
    stage: "worker-exit",
    elapsed: 3600,
    code: 1,
    signal: null,
    oom: false,
    reason: null,
  });
  assertInconclusive(r, /1 worker death\(s\) that are not a timed heap-limit abort/, {
    control: true,
  });
});

test("round 1 finding 10: a sample error or death that later counters drop is inconclusive", () => {
  // No event explains the count, and the later records contradict it.
  for (const field of ["rpcErrors", "workerDeaths"]) {
    const r = flat();
    sampleAt(r, 240)[field] = 1;
    assertInconclusive(r, /counters disagree with the events logged by then/);
  }
});

test("a fixed run with a recorded RPC error fails", () => {
  const result = analyze(injectError(flat(), 7200.011, "logs", "socket hang up"));
  assert.deepEqual(result.inconclusive, []);
  assert.equal(result.verdict, "fail");
  assert.equal(result.numbers.rpcErrors, 1);
});

// --- Round 2 finding 1 (analyze.mjs:129): minute buckets must be timed and consecutive ------

test("round 2 finding 1: 240 minute buckets all covering [0, 60] are inconclusive", () => {
  const r = flat();
  for (const m of minutesOf(r)) {
    m.elapsedStart = 0;
    m.elapsedEnd = 60;
  }
  assertInconclusive(r, /minute bucket\(s\) not anchored to their index or not contiguous/);
});

test("round 2 finding 1: minute buckets without start or end times are inconclusive", () => {
  const r = flat();
  for (const m of minutesOf(r)) {
    delete m.elapsedStart;
    delete m.elapsedEnd;
  }
  assertInconclusive(r, /240 minute bucket\(s\) without an index, start and end times/);
});

// --- Round 2 finding 2 (analyze.mjs:155): a duplicate must not hide a missing sample ---------

test("round 2 finding 2: a missing initial sample replaced by a duplicate is inconclusive", () => {
  const r = flat();
  const first = sampleAt(r, 0);
  const second = sampleAt(r, 1);
  const out = r.filter((x) => x !== first);
  out.push(structuredClone(second));
  assertInconclusive(out, /sample slot\(s\) missing \(first at 0s\)/);
});

// --- Round 2 finding 3 (analyze.mjs:172): instruments must be present and agree --------------

test("round 2 finding 3: samples with empty per-kind counts are inconclusive", () => {
  const r = flat();
  for (const s of samplesOf(r)) s.byKind = {};
  assertInconclusive(r, /480 sample\(s\) without cumulative counts by kind that sum to its calls/);
});

test("round 2 finding 3: zero per-kind counts against 6,480 calls in minutes are inconclusive", () => {
  const r = flat();
  for (const s of samplesOf(r)) s.byKind = zeroKinds();
  assertInconclusive(r, /sample\(s\) whose cumulative calls disagree with the minutes/);
});

test("round 2 finding 3: zero delivered stream chunks are inconclusive", () => {
  const r = flat();
  for (const x of r) if ("streamChunks" in x) x.streamChunks = 0;
  assertInconclusive(r, /delivered stream chunks are off the schedule/);
});

test("round 2 finding 3: absent error and death counters are inconclusive", () => {
  const r = flat();
  for (const x of r) {
    delete x.rpcErrors;
    delete x.streamErrors;
    delete x.workerDeaths;
  }
  assertInconclusive(
    r,
    /480 sample\(s\) without RPC error, stream error and worker death counters/,
  );
});

// --- Round 2 finding 4 (analyze.mjs:66): a sample's stream error must survive ----------------

test("round 2 finding 4: a sample's stream error is never dropped", () => {
  // Recorded with its event, it fails the run; counted with no event, the run is inconclusive.
  const result = analyze(injectError(flat(), 7200.011, "stream", "worker dead"));
  assert.equal(result.verdict, "fail");
  assert.equal(result.numbers.streamErrors, 1);
  const r = flat();
  sampleAt(r, 240).streamErrors = 1;
  assertInconclusive(r, /counters disagree with the events logged by then/);
});

// --- Round 2 finding 5 (analyze.mjs:224): only a timed heap-limit abort qualifies -----------

test("round 2 finding 5: an unrelated SIGABRT does not qualify a flat control", () => {
  const r = buildRun({ control: true });
  r.push({
    time: wall(600.5),
    stage: "worker-exit",
    elapsed: 600.5,
    code: null,
    signal: "SIGABRT",
    oom: false,
    reason: "intentional process.abort()",
  });
  assertInconclusive(r, /1 worker death\(s\) that are not a timed heap-limit abort/, {
    control: true,
  });
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
  assertInconclusive(r, /1 worker death\(s\) that are not a timed heap-limit abort/, {
    control: true,
  });
});

test("round 2 finding 5: a timed heap-limit abort without the load before it does not qualify", () => {
  const r = buildRun({ control: true, heapAt: (t) => 200 + t / 10, deathAt: 1337.011 }).filter(
    (x) => !["sample", "minute"].includes(x.stage),
  );
  assertInconclusive(r, /sample slot\(s\) missing \(first at 0s\)/, { control: true });
});

// --- Round 2 finding 6 (analyze.mjs:99): the control reads the idle agents ---------------------

test("round 2 finding 6: a control reading streaming agents is inconclusive", () => {
  assertInconclusive(leakingControl({ readStreaming: true }), /control reads the 8 idle agents/, {
    control: true,
  });
});

// --- Round 2 finding 7 (analyze.mjs:253): the last-hour window needs the load end ----------

test("round 2 finding 7: a last-hour rise without a load-end record does not pass", () => {
  const r = buildRun({ heapAt: (t) => 200 + (Math.max(0, t - 10800) / 3600) * 20 });
  assert.equal(verdictOf(r), "fail");
  // The validator's control: the final load point recorded as one more sample, not as load-end.
  one(r, "load-end").stage = "sample";
  assertInconclusive(r, /no load-end record/);
  assert.ok(analyze(r).numbers.slopeBytesPerHour >= 16 * MIB);
});

// --- Round 3 finding 1 (analyze.mjs:482): the rest is 300 s, within 2 s ---------------------

test("round 3 finding 1: a 330-second rest is inconclusive", () => {
  assertInconclusive(withRest(flat(), 330), /rest ran 330.0s, expected 300s/);
});

test("round 3 finding 1: the rest bound is 298 to 302 seconds", () => {
  for (const [rest, verdict] of [
    [297.9, "inconclusive"],
    [298.1, "pass"],
    [301.9, "pass"],
    [302.1, "inconclusive"],
  ]) {
    assert.equal(verdictOf(withRest(flat(), rest)), verdict, String(rest));
  }
});

// --- Lead decision: the rest is measured on the records' wall clock ------------------------
//
// From the load-end record (logged after its forced-GC sample) to the post-rest record, by their
// `time` fields, within 300 s ± 2 s. The load-end sample's own GC time is measurement, not rest.

test("rest on the wall clock: a 297-second rest is inconclusive", () => {
  assertInconclusive(withRest(flat(), 297), /rest ran 297.0s, expected 300s/);
});

test("rest on the wall clock: a 303-second rest is inconclusive", () => {
  assertInconclusive(withRest(flat(), 303), /rest ran 303.0s, expected 300s/);
});

test("rest on the wall clock: a 301.4-second rest after 2.7 s of GC sample time passes", () => {
  // The run's own forced-GC samples reach 2.7 s (the real runs' slowest is 2.68 s).
  const r = buildRun({
    postRestHeapMiB: 199,
    sampleSeconds: (t) => (Math.floor(t / 30) === 240 ? 2.7 : GC_SAMPLE_SECONDS),
  });
  const result = analyze(withRest(r, 301.4, 2.7));
  assert.equal(result.verdict, "pass", JSON.stringify(result.inconclusive));
  assert.equal(result.numbers.restSeconds.toFixed(1), "301.4");
  assert.equal(result.numbers.restElapsedSeconds.toFixed(1), "304.1");
});

test("rest on the wall clock: an absent or unparseable time on load-end or post-rest is inconclusive", () => {
  for (const [stage, value] of [
    ["load-end", undefined],
    ["post-rest", undefined],
    ["load-end", "not a time"],
    ["post-rest", 14701.4],
  ]) {
    const r = flat();
    if (value === undefined) delete one(r, stage).time;
    else one(r, stage).time = value;
    assertInconclusive(r, /no parseable time: the rest is not observed/);
    assertInconclusive(r, /1 record\(s\) without a parseable time/);
  }
});

test("rest on the wall clock: elapsed and time that disagree by a sample period are inconclusive", () => {
  // The round-3 probe's shape: post-rest elapsed 330 s after load end, its time 300 s after the
  // load-end record; the load-end sample would have taken 30 s.
  const r = withRest(flat(), 300, 0);
  one(r, "post-rest").elapsed += 30;
  assertInconclusive(r, /elapsed rest ran 330.0s \(less the 0.0s load-end sample\), expected 300s/);
  assertInconclusive(r, /post-rest: 1 record\(s\) logged -30.0s from their elapsed moment/);
  // And a load-end record logged before the load end it records.
  assertInconclusive(
    withRest(flat(), 300, -1),
    /load-end: 1 record\(s\) logged -1.0s from their elapsed moment/,
  );
});

// --- Round 3 finding 2 (analyze.mjs:550): every control error up to the leak point counts ---

// A control flat through its samples whose only leak evidence is the load-end sample.
function controlLeakingAtLoadEnd() {
  const r = buildRun({ control: true, postRestHeapMiB: 200 });
  one(r, "load-end").memory.heapUsed = 200 * MIB + 510_000_000;
  return r;
}

test("round 3 finding 2: a control read failure after the last sample, before the leak, counts", () => {
  const r = controlLeakingAtLoadEnd();
  assert.equal(verdictOf(r, { control: true }), "pass");
  injectError(r, 14390, "inspect", "socket hang up");
  assertInconclusive(r, /1 RPC error\(s\) or death\(s\) before the leak point/, { control: true });
});

test("round 3 finding 2: a control error in the end counters with no event counts", () => {
  const r = controlLeakingAtLoadEnd();
  for (const stage of ["load-end", "post-rest", "cleanup"]) one(r, stage).rpcErrors = 1;
  assertInconclusive(r, /counters disagree with the events logged by then/, { control: true });
});

test("round 3 finding 2: before a heap-limit abort, only the abort's own failures are excused", () => {
  const r = buildRun({ control: true, heapAt: (t) => 200 + t / 10, deathAt: 1337.011 });
  injectError(r, 1332.2, "logs", "socket hang up");
  assertInconclusive(r, /1 RPC error\(s\) or death\(s\) before the leak point/, { control: true });
});

test("round 3 finding 2: a 'worker dead' failure before the last sample is not excused", () => {
  const r = buildRun({ control: true, heapAt: (t) => 200 + t / 10, deathAt: 1337.011 });
  injectError(r, 600.2, "stream", "worker dead");
  assertInconclusive(r, /1 RPC error\(s\) or death\(s\) before the leak point/, { control: true });
});

// --- Round 3 finding 3 (analyze.mjs:435): delivery holds through the end of the load --------

test("round 3 finding 3: no stream delivered after the last sample is inconclusive", () => {
  const r = flat();
  const last = samplesOf(r).at(-1).streamChunks;
  for (const stage of ["load-end", "post-rest", "cleanup"]) one(r, stage).streamChunks = last;
  assertInconclusive(r, /load-end stream chunks 114443 short of the 114667 due by 14400.05s/);
});

test("round 3 finding 3: a control's delivery must reach its heap-limit abort", () => {
  const r = buildRun({ control: true, heapAt: (t) => 200 + t / 10, deathAt: 1337.011 });
  const last = samplesOf(r).at(-1).streamChunks;
  for (const stage of ["load-end", "cleanup"]) one(r, stage).streamChunks = last;
  assertInconclusive(r, /load-end stream chunks 10507 short of the 10626 due by 1337.011s/, {
    control: true,
  });
});

test("round 3 finding 3: a control leak point between samples needs the delivered count", () => {
  const r = controlLeakingAtLoadEnd();
  for (const stage of ["load-end", "post-rest", "cleanup"]) delete one(r, stage).streamChunks;
  assertInconclusive(r, /no delivered stream-chunk count at the load end/, { control: true });
});

// --- Round 4 finding 1 (analyze.mjs:519): every clock pair agrees; the rest holds on both ----
//
// Every record carries the driver's wall-clock `time` beside its `elapsed`. With the baseline's
// time as origin, a record is logged `time - origin - elapsed` seconds after the moment it records:
// at once for worker-exit, post-rest and the last minute (closed at load end); within a sample
// period for samples and minutes; within the run's slowest periodic sample for load-end; never
// before its moment for an RPC failure. Cleanup is logged last.

const shiftTime = (rec, seconds) => {
  rec.time = new Date(Date.parse(rec.time) + seconds * 1000).toISOString();
};

test("round 4 finding 1: a 320 s rest with post-rest time moved back 20 s is inconclusive", () => {
  const r = withRest(flat(), 320);
  assertInconclusive(r, /rest ran 320.0s, expected 300s/);
  shiftTime(one(r, "post-rest"), -20);
  assertInconclusive(r, /post-rest: 1 record\(s\) logged -20.0s from their elapsed moment/);
  assertInconclusive(r, /elapsed rest ran 320.0s \(less the 0.7s load-end sample\)/);
});

test("round 4 finding 1: post-rest elapsed moved 20 s later alone is inconclusive", () => {
  const r = flat();
  one(r, "post-rest").elapsed += 20;
  assertInconclusive(r, /post-rest: 1 record\(s\) logged -20.0s from their elapsed moment/);
  assertInconclusive(r, /elapsed rest ran 320.7s/);
});

test("round 4 finding 1: a load-end sample slower than every periodic sample is inconclusive", () => {
  // A 320 s rest made to read 300.3 s on both clocks by moving only load-end's time.
  const r = withRest(flat(), 320);
  shiftTime(one(r, "load-end"), 19.7);
  assertInconclusive(r, /load-end sample took 20.4s, longer than the slowest periodic sample/);
});

test("round 4 finding 1: any record logged off its own elapsed moment is inconclusive", () => {
  for (const [mutate, reason, options] of [
    [(r) => shiftTime(sampleAt(r, 100), -1.7), /sample: 1 record\(s\) logged -1.0s/],
    [(r) => shiftTime(sampleAt(r, 100), 30), /sample: 1 record\(s\) logged 30.7s/],
    [(r) => shiftTime(minutesOf(r)[10], -1), /minute: 1 record\(s\) logged -0.9s/],
    [(r) => shiftTime(minutesOf(r).at(-1), 1), /last minute: 1 record\(s\) logged 1.0s/],
    [(r) => delete minutesOf(r)[10].time, /1 record\(s\) without a parseable time/],
    [(r) => delete r[0].time, /the baseline has no parseable time/],
    [(r) => shiftTime(one(r, "cleanup"), -400), /the cleanup record is not logged last/],
  ]) {
    const r = flat();
    mutate(r);
    assertInconclusive(r, reason, options);
  }
  const control = () => buildRun({ control: true, heapAt: (t) => 200 + t / 10, deathAt: 1337.011 });
  let r = control();
  shiftTime(one(r, "worker-exit"), 1);
  assertInconclusive(r, /worker-exit: 1 record\(s\) logged 1.0s/, { control: true });
  r = control();
  shiftTime(
    r.find((x) => x.stage === "rpc-error"),
    -1,
  );
  assertInconclusive(r, /rpc-error: 1 record\(s\) logged -0.8s/, { control: true });
});

test("round 4 finding 1: sample minute counts and the last bucket agree with the buckets", () => {
  let r = flat();
  sampleAt(r, 100).minutes += 1;
  assertInconclusive(
    r,
    /1 sample\(s\) whose closed-minute count disagrees with the minute buckets/,
  );
  r = flat();
  delete sampleAt(r, 100).minutes;
  assertInconclusive(r, /1 sample\(s\) without a closed-minute count/);
  r = flat();
  minutesOf(r).at(-1).elapsedEnd -= 1;
  assertInconclusive(r, /the last minute bucket ends at 14399.05s, not at load-end 14400.05s/);
});

// --- Round 4 finding 2 (analyze.mjs:584): only the heap-limit exit excuses, by time ---------

const abortControl = () =>
  buildRun({ control: true, heapAt: (t) => 200 + t / 10, deathAt: 1337.011 });

test("round 4 finding 2: a failure logged before the exit is not excused by its message", () => {
  for (const [kind, message] of [
    ["stream", "worker dead"],
    ["logs", "worker dead"],
    ["inspect", "worker exit null"],
  ]) {
    const r = injectError(abortControl(), 1332.2, kind, message, 1332.2);
    assertInconclusive(r, /1 RPC error\(s\) or death\(s\) before the leak point/, {
      control: true,
    });
  }
});

test("round 4 finding 2: a failure logged after the heap-limit exit is excused, whatever it says", () => {
  // Dispatched after the last good sample and logged after the exit: the exit caused it.
  const r = injectError(abortControl(), 1336.9, "logs", "socket hang up", 1337.2);
  const result = analyze(r, { control: true });
  assert.equal(result.verdict, "pass", JSON.stringify(result.inconclusive));
  assert.equal(result.numbers.rpcErrors, 10);
});

// --- Round 4 finding 3 (analyze.mjs:595): every error counter of every kind counts ----------

test("round 4 finding 3: an end stream-error counter with no event is inconclusive", () => {
  const r = controlLeakingAtLoadEnd();
  for (const stage of ["load-end", "post-rest", "cleanup"]) one(r, stage).streamErrors = 1;
  assertInconclusive(r, /counters disagree with the events logged by then/, { control: true });
});

test("round 4 finding 3: a by-kind error counter with no event is inconclusive", () => {
  const r = controlLeakingAtLoadEnd();
  sampleAt(r, 10).errorsByKind.sample = 1;
  assertInconclusive(r, /counters disagree with the events logged by then/, { control: true });
  const s = flat();
  delete sampleAt(s, 10).errorsByKind;
  assertInconclusive(s, /1 sample\(s\) without errors by kind/);
});

test("round 4 finding 3: a recorded error of any kind before the leak point disqualifies a control", () => {
  for (const kind of ["stream", "sample", "other", "send"]) {
    const r = injectError(leakingControl(), 600.5, kind);
    assertInconclusive(r, /before the leak point/, { control: true });
  }
});

// --- Audit: anything absent, duplicated or contradictory is never PASS ----------------------

test("audit: a header whose control flag contradicts the mode is inconclusive", () => {
  assertInconclusive(flat(), /header control false, but judged as the control/, { control: true });
  assertInconclusive(leakingControl(), /header control true, but judged as a fixed run/);
});

test("audit: absent run identity in the header is inconclusive", () => {
  for (const [drop, reason] of [
    [(h) => delete h.boundaryCopy, /boundaryCopy undefined/],
    [(h) => delete h.readStreaming, /readStreaming undefined is not recorded/],
    [(h) => delete h.heapSizeLimitBytes, /heap_size_limit is not recorded/],
    [(h) => delete h.label, /no run label/],
    [(h) => delete h.baseline.agents, /the baseline does not observe 15 agents/],
    [(h) => (h.baseline.agents.byLifecycle.running = 6), /the baseline does not observe 15 agents/],
    [(h) => (h.baseline.agents.timelineStats.totalItems = 100), /observes 100 timeline rows/],
  ]) {
    const r = flat();
    drop(r[0]);
    assertInconclusive(r, reason);
  }
});

test("audit: a duplicated baseline, load-end, post-rest or cleanup record is inconclusive", () => {
  for (const stage of ["baseline", "load-end", "post-rest", "cleanup"]) {
    const r = flat();
    r.push(structuredClone(one(r, stage)));
    assertInconclusive(r, new RegExp(`2 "${stage}" records, expected one`));
  }
});

test("audit: a missing load-end, post-rest or cleanup record is inconclusive", () => {
  for (const stage of ["load-end", "post-rest", "cleanup"]) {
    assertInconclusive(
      flat().filter((x) => x.stage !== stage),
      new RegExp(`no ${stage} record`),
    );
  }
});

test("audit: a sample without a numeric heapUsed is not silently dropped", () => {
  const r = flat();
  delete sampleAt(r, 240).memory;
  assertInconclusive(r, /1 sample record\(s\) without a numeric elapsed or heapUsed/);
});

test("audit: an extra sample off its 30-second slot is inconclusive", () => {
  const r = flat();
  r.push({ ...structuredClone(sampleAt(r, 0)), elapsed: 15 });
  assertInconclusive(r, /sample slot\(s\) with more than one sample \(0s\)/);
});

test("audit: a sample after the four hours of load is inconclusive", () => {
  const r = flat();
  r.push({ ...structuredClone(sampleAt(r, 479)), elapsed: 14400.02 });
  assertInconclusive(r, /1 sample\(s\) at or after the 14400s load/);
});

test("audit: a minute beyond the four hours is inconclusive", () => {
  const r = flat();
  const last = minutesOf(r)[239];
  r.push({ ...structuredClone(last), index: 240, elapsedStart: last.elapsedEnd });
  assertInconclusive(r, /1 minute bucket\(s\) beyond the 14400s load/);
});

test("audit: a minute index far past the load is malformed and does not stall the analyzer", () => {
  const r = flat();
  minutesOf(r)[239].index = 1e12;
  assertInconclusive(r, /1 minute bucket\(s\) without an index/);
});

test("audit: a counter that is present but not a count is inconclusive", () => {
  const r = flat();
  one(r, "load-end").rpcErrors = "0";
  assertInconclusive(r, /load-end rpcErrors not a count/);
});

test("audit: a decreasing cumulative call count is inconclusive", () => {
  const r = flat();
  const s = sampleAt(r, 101);
  s.calls = sampleAt(r, 100).calls - 1;
  s.byKind = { ...sampleAt(r, 100).byKind, logs: sampleAt(r, 100).byKind.logs - 1 };
  assertInconclusive(r, /1 sample\(s\) with a decreasing cumulative count/);
});

test("audit: load-end calls that disagree with the minutes are inconclusive", () => {
  const r = flat();
  one(r, "load-end").calls += 27;
  one(r, "load-end").byKind.logs += 27;
  assertInconclusive(r, /load-end calls 6507 != 6480 in the minute buckets/);
});

test("audit: calls during the rest are inconclusive", () => {
  const r = flat();
  one(r, "post-rest").calls += 1;
  one(r, "post-rest").byKind.ls += 1;
  assertInconclusive(r, /post-rest calls 6481 != 6480 in the minute buckets/);
});

test("audit: a rest far longer than five minutes is inconclusive", () => {
  assertInconclusive(withRest(flat(), 300 + 3 * 3600), /rest ran 11100.0s, expected 300s/);
});

test("audit: an RPC error event that no counter records is inconclusive", () => {
  const r = flat();
  r.push({ time: wall(7200.1), stage: "rpc-error", elapsed: 7200, kind: "logs", message: "x" });
  assertInconclusive(r, /counters disagree with the events logged by then/);
});

test("audit: a worker exit marked as the harness's own stop mid-run is inconclusive", () => {
  const r = flat();
  r.push({
    time: wall(7200),
    stage: "worker-exit",
    elapsed: 7200,
    code: null,
    signal: "SIGTERM",
    stopping: true,
  });
  assertInconclusive(r, /marked as the harness's stop before the run ended/);
});

test("audit: a control with an RPC error before its leak point is inconclusive", () => {
  const r = leakingControl();
  for (const s of samplesOf(r)) if (s.elapsed > 300) s.rpcErrors = 1;
  assertInconclusive(r, /before the leak point/, { control: true });
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
