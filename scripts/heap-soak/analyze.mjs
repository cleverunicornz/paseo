#!/usr/bin/env node
// scripts/heap-soak/analyze.mjs
//
// Judge one soak run's JSONL (from soak.mjs) against P-000269 H1 and O-000279's H1 clause.
// Prints each number and exits: 0 PASS, 1 FAIL, 2 INCONCLUSIVE.
//
//   node analyze.mjs <run.jsonl>            a fixed build's run (pass conditions)
//   node analyze.mjs --control <run.jsonl>  the unfixed build's run (leak must show)
//
// Fixed run PASS (P-000269 H1), all required:
//   zero RPC errors (including streaming failures) and zero worker deaths;
//   max post-GC heapUsed no more than 64 MiB above the baseline;
//   least-squares slope over the last hour of load below 16 MiB an hour;
//   post-rest post-GC heapUsed no higher than the last load sample.
// Control PASS (decimal MB): heap rose more than 500,000,000 bytes above its baseline, or the
//   worker reached its own V8 heap limit, at any time within the first 14,400 seconds.
//
// INCONCLUSIVE when a required observation is missing or the load breaks its protocol:
//   a diagnostic copy (--boundary-copy) or altered fixture/protocol settings in the header;
//   a wall-clock minute missing, duplicated or off the 27-call 15/9/2/1 rate or mix;
//   a scheduled 30-second sample missing; a load or rest phase short of its full length;
//   a sample with no observed running-agent count; a worker death that is not a heap-limit abort.
// A control run is not required to reach four hours when it shows the leak early.

import fs from "node:fs";

const MIB = 1024 ** 2;
const EXPECTED_SECONDS = 14400;
const EXPECTED_REST_SECONDS = 300;
const EXPECTED_RATE = 27;
const EXPECTED_MIX = { logs: 15, inspect: 9, ls: 2, send: 1 };
const MIX_KEYS = ["logs", "inspect", "ls", "send"];
const EXPECTED_MESSAGE_SECONDS = 1800;
const EXPECTED_ROW_BYTES = 2048;
const EXPECTED_FIXTURE = {
  agents: 15,
  running: 7,
  idle: 8,
  seededRows: 10900,
  persistentClients: 13,
  subscribedClients: 2,
  streamingAgents: 7,
};
const MAX_ABOVE_BASELINE = 64 * MIB;
const MAX_SLOPE_PER_HOUR = 16 * MIB;
const CONTROL_MIN_RISE = 500_000_000; // decimal MB, H1
const SAMPLE_PERIOD_SECONDS = 30;
const SAMPLE_GAP_TOLERANCE_SECONDS = 2;
const MINUTE_WINDOW_TOLERANCE_SECONDS = 2;
const HEAP_LIMIT_RE = /Reached heap limit|heap out of memory|Allocation failed/i;

const heapOf = (rec) => rec?.memory?.heapUsed ?? rec?.heapUsed ?? null;
const numberOrNull = (v) => (typeof v === "number" ? v : null);

function leastSquaresSlopePerHour(points) {
  if (points.length < 2) return 0;
  const n = points.length;
  const xbar = points.reduce((a, p) => a + p.elapsed, 0) / n;
  const ybar = points.reduce((a, p) => a + p.heapUsed, 0) / n;
  const denom = points.reduce((a, p) => a + (p.elapsed - xbar) ** 2, 0);
  if (denom === 0) return 0;
  const cov = points.reduce((a, p) => a + (p.elapsed - xbar) * (p.heapUsed - ybar), 0);
  return (cov / denom) * 3600;
}

function readRecords(records) {
  const samples = records
    .filter((r) => r.stage === "sample")
    .map((r) => ({
      elapsed: r.elapsed,
      heapUsed: heapOf(r),
      running: r.agents?.byLifecycle?.running ?? null,
      byKind: r.byKind ?? null,
      rpcErrors: numberOrNull(r.rpcErrors),
      workerDeaths: numberOrNull(r.workerDeaths),
    }))
    .filter((s) => typeof s.elapsed === "number" && typeof s.heapUsed === "number");
  const loadEndRec = records.findLast((r) => r.stage === "load-end") ?? null;
  const loadEnd = loadEndRec
    ? { elapsed: loadEndRec.elapsed, heapUsed: heapOf(loadEndRec) }
    : null;
  const loadSamples = [...samples, ...(loadEnd ? [loadEnd] : [])].sort(
    (a, b) => a.elapsed - b.elapsed,
  );
  return {
    samples,
    loadEnd,
    loadEndRec,
    loadSamples,
    baseline: records.find((r) => r.stage === "baseline") ?? null,
    postRest: records.find((r) => r.stage === "post-rest") ?? null,
    cleanup: records.find((r) => r.stage === "cleanup") ?? null,
    minutes: records.filter((r) => r.stage === "minute"),
    workerExits: records.filter((r) => r.stage === "worker-exit"),
    rpcErrorEvents: records.filter((r) => r.stage === "rpc-error"),
  };
}

// The header line carries the run's identity. Any altered protocol or fixture setting, or the
// diagnostics-only boundary copy, disqualifies the run.
function headerProblems(header, expected) {
  if (!header) return ["no baseline record"];
  const problems = [];
  const b = header.baseline?.memory?.heapUsed;
  if (typeof b !== "number") problems.push("baseline heapUsed missing");
  if (header.boundaryCopy === true)
    problems.push("boundary-copy diagnostic run (never a qualification)");
  const p = header.protocol ?? {};
  if (p.seconds !== expected.seconds) problems.push(`protocol.seconds ${p.seconds} != ${expected.seconds}`);
  if (p.restSeconds !== expected.restSeconds)
    problems.push(`protocol.restSeconds ${p.restSeconds} != ${expected.restSeconds}`);
  if (p.connectionsPerMinute !== expected.rate)
    problems.push(`protocol.connectionsPerMinute ${p.connectionsPerMinute} != ${expected.rate}`);
  if (p.messageSeconds !== EXPECTED_MESSAGE_SECONDS)
    problems.push(`protocol.messageSeconds ${p.messageSeconds} != ${EXPECTED_MESSAGE_SECONDS}`);
  if (MIX_KEYS.some((k) => (p.mix?.[k] ?? null) !== EXPECTED_MIX[k]))
    problems.push(`protocol.mix ${JSON.stringify(p.mix)} != ${JSON.stringify(EXPECTED_MIX)}`);
  const f = header.fixture ?? {};
  for (const [k, v] of Object.entries(EXPECTED_FIXTURE)) {
    if (f[k] !== v) problems.push(`fixture.${k} ${f[k]} != ${v}`);
  }
  if (f.rowBytes !== EXPECTED_ROW_BYTES)
    problems.push(`fixture.rowBytes ${f.rowBytes} != ${EXPECTED_ROW_BYTES}`);
  return problems;
}

// Wall-clock minute buckets: consecutive indices 0..n-1, each a ~60-second window with exactly
// `rate` calls in the 15/9/2/1 mix, covering the analysis window [0, windowEnd]. Any deviation is
// an off-protocol minute.
function minuteProblems(minutes, expected, windowEnd) {
  const complete = Math.floor(windowEnd / 60);
  const problems = [];
  const offProtocol = [];
  const byIndex = new Map();
  for (const m of minutes) {
    if (byIndex.has(m.index)) problems.push(`duplicate minute index ${m.index}`);
    byIndex.set(m.index, m);
    if (m.index >= complete) continue; // a trailing partial bucket is allowed
    const window = m.elapsedEnd - m.elapsedStart;
    const offWindow = Math.abs(window - 60) > MINUTE_WINDOW_TOLERANCE_SECONDS;
    const offMix = MIX_KEYS.some((k) => (m.byKind?.[k] ?? null) !== EXPECTED_MIX[k]);
    if (m.calls !== expected.rate || offMix || offWindow) offProtocol.push(m);
  }
  for (let i = 0; i < complete; i++) {
    if (!byIndex.has(i)) problems.push(`missing minute index ${i}`);
  }
  if (minutes.length < complete)
    problems.push(`only ${minutes.length} minute buckets, expected ${complete}`);
  if (offProtocol.length > 0) problems.push(`${offProtocol.length} off-protocol minute(s)`);
  return { problems, offProtocol };
}

// Every scheduled 30-second sample through the window must be present and must carry its
// cumulative per-kind counts and the observed running-agent count that establishes seven streams.
// The load-end sample (at windowEnd) counts toward the window's span.
function sampleProblems(samples, loadSamples, windowEnd) {
  const problems = [];
  const expectedCount = Math.floor(windowEnd / SAMPLE_PERIOD_SECONDS);
  const inWindow = loadSamples.filter((s) => s.elapsed <= windowEnd);
  if (samples.length < expectedCount)
    problems.push(`only ${samples.length} samples, expected ${expectedCount}`);
  let maxGap = 0;
  for (let i = 1; i < inWindow.length; i++) {
    maxGap = Math.max(maxGap, inWindow[i].elapsed - inWindow[i - 1].elapsed);
  }
  if (maxGap > SAMPLE_PERIOD_SECONDS + SAMPLE_GAP_TOLERANCE_SECONDS)
    problems.push(`sample gap ${maxGap.toFixed(1)}s > ${SAMPLE_PERIOD_SECONDS}s (a missing sample)`);
  const spanEnd = inWindow.at(-1)?.elapsed ?? 0;
  if (spanEnd < windowEnd - SAMPLE_GAP_TOLERANCE_SECONDS)
    problems.push(`sampled span ${spanEnd.toFixed(0)}s < ${windowEnd}s`);
  const missingInstrument = samples.filter((s) => s.byKind === null).length;
  if (missingInstrument > 0)
    problems.push(`${missingInstrument} sample(s) without cumulative counts by kind`);
  const missingRunning = samples.filter((s) => s.running === null).length;
  if (missingRunning > 0)
    problems.push(`${missingRunning} sample(s) without an observed running-agent count`);
  const wrongRunning = samples.filter(
    (s) => s.running !== null && s.running !== EXPECTED_FIXTURE.running,
  ).length;
  if (wrongRunning > 0)
    problems.push(`${wrongRunning} sample(s) with running agents != ${EXPECTED_FIXTURE.running}`);
  return { problems, maxGap };
}

// A fixed run must carry its full load and its rest. A control that shows the leak early is judged
// only through that point, so this is required of a control only when no leak is demonstrated.
function phaseProblems(loadEnd, postRest, samples, expected) {
  const problems = [];
  const loadSeconds = loadEnd?.elapsed ?? samples.at(-1)?.elapsed ?? 0;
  if (loadSeconds < expected.seconds - SAMPLE_GAP_TOLERANCE_SECONDS)
    problems.push(`load ran ${loadSeconds.toFixed(0)}s, expected ${expected.seconds}s`);
  if (loadSeconds > expected.seconds + SAMPLE_GAP_TOLERANCE_SECONDS)
    problems.push(`load ran ${loadSeconds.toFixed(0)}s, past its ${expected.seconds}s window`);
  if (!postRest) {
    problems.push("no post-rest record (run cut short)");
  } else {
    const restSeconds = postRest.elapsed - loadSeconds;
    if (restSeconds < expected.restSeconds - SAMPLE_GAP_TOLERANCE_SECONDS)
      problems.push(`rest ran ${restSeconds.toFixed(0)}s, expected ${expected.restSeconds}s`);
  }
  return problems;
}

// Cumulative counters must never be erased by a later, smaller one: take the maximum observed and
// reconcile with the event records.
function reconcileCounters({ samples, loadEndRec, postRest, cleanup, workerExits, rpcErrorEvents }) {
  const observed = [loadEndRec, postRest, cleanup, ...samples];
  const maxOf = (field, events) =>
    Math.max(
      ...observed.map((r) => numberOrNull(r?.[field]) ?? 0),
      events.length,
      0,
    );
  const deaths = maxOf("workerDeaths", workerExits.filter((r) => r.stopping !== true));
  const errors = maxOf("rpcErrors", rpcErrorEvents);
  const streamErrors = Math.max(...observed.map((r) => numberOrNull(r?.streamErrors) ?? 0), 0);
  const oomDeaths = workerExits.filter(
    (r) =>
      r.stopping !== true &&
      (r.oom === true || (typeof r.reason === "string" && HEAP_LIMIT_RE.test(r.reason)) || r.signal === "SIGABRT"),
  );
  return { errors, deaths, streamErrors, oomDeaths, unexplainedDeaths: Math.max(0, deaths - oomDeaths.length) };
}

function buildNumbers(ctx) {
  const {
    baseline,
    loadSamples,
    loadEnd,
    postRest,
    counters,
    header,
    minutes,
    samples,
    offProtocol,
    maxGap,
  } = ctx;
  const tail = loadSamples.filter((s) => s.elapsed >= (loadEnd?.elapsed ?? 0) - 3600);
  const maxHeap = loadSamples.reduce((m, s) => Math.max(m, s.heapUsed), baseline ?? 0);
  const heapBound = header?.heapSizeLimitBytes ?? header?.workerHeapBoundBytes ?? null;
  const reachedBound = counters.oomDeaths.length > 0 || reachedBoundByHeap(loadSamples, heapBound);
  return {
    baselineBytes: baseline,
    baselineMiB: mib(baseline),
    maxSampleBytes: maxHeap,
    maxAboveBaselineBytes: baseline === null ? null : maxHeap - baseline,
    lastLoadSampleBytes: loadSamples.at(-1)?.heapUsed ?? null,
    postRestBytes: heapOf(postRest),
    slopeBytesPerHour: leastSquaresSlopePerHour(tail),
    tailSamples: tail.length,
    rpcErrors: counters.errors,
    streamErrors: counters.streamErrors,
    workerDeaths: counters.deaths,
    oomDeaths: counters.oomDeaths.length,
    unexplainedDeaths: counters.unexplainedDeaths,
    heapBoundBytes: heapBound,
    reachedHeapBound: reachedBound,
    samples: samples.length,
    maxSampleGapSeconds: maxGap,
    loadSeconds: loadEnd?.elapsed ?? loadSamples.at(-1)?.elapsed ?? 0,
    minutes: minutes.length,
    offProtocolMinutes: offProtocol.length,
    streamingAgents: samples.find((s) => s.running !== null)?.running ?? null,
    mixPerMinute: totalMix(minutes),
    ...identity(header, ctx.expected),
  };
}

function identity(header, expected) {
  return {
    expectedRate: expected.rate,
    readStreaming: header?.readStreaming ?? null,
    control: header?.control ?? null,
    label: header?.label ?? null,
  };
}

function reachedBoundByHeap(loadSamples, heapBound) {
  if (typeof heapBound !== "number") return false;
  return loadSamples.some((s) => s.heapUsed >= heapBound);
}

function totalMix(minutes) {
  return Object.fromEntries(
    MIX_KEYS.map((k) => [k, minutes.reduce((n, m) => n + (m.byKind?.[k] ?? 0), 0)]),
  );
}

function evaluateFixed(numbers) {
  const checks = [
    {
      name: "zero RPC errors and worker deaths",
      ok: numbers.rpcErrors === 0 && numbers.streamErrors === 0 && numbers.workerDeaths === 0,
      detail: `${numbers.rpcErrors} rpc error(s), ${numbers.streamErrors} stream error(s), ${numbers.workerDeaths} death(s)`,
    },
    {
      name: "max sample within 64 MiB of baseline",
      ok:
        numbers.maxAboveBaselineBytes !== null && numbers.maxAboveBaselineBytes <= MAX_ABOVE_BASELINE,
      detail: `+${mib(numbers.maxAboveBaselineBytes)} MiB (limit ${mib(MAX_ABOVE_BASELINE)})`,
    },
    {
      name: "last-hour slope below 16 MiB/h",
      ok: numbers.slopeBytesPerHour < MAX_SLOPE_PER_HOUR,
      detail: `${mib(numbers.slopeBytesPerHour)} MiB/h over ${numbers.tailSamples} sample(s) (limit ${mib(MAX_SLOPE_PER_HOUR)})`,
    },
    {
      name: "post-rest no higher than last load sample",
      ok:
        numbers.postRestBytes !== null &&
        numbers.lastLoadSampleBytes !== null &&
        numbers.postRestBytes <= numbers.lastLoadSampleBytes,
      detail: `post-rest ${mib(numbers.postRestBytes)} MiB vs last load ${mib(numbers.lastLoadSampleBytes)} MiB`,
    },
  ];
  return { checks, verdict: checks.every((c) => c.ok) ? "pass" : "fail" };
}

// The control shows the load leaks when its heap rises more than 500,000,000 bytes (decimal MB)
// above its own baseline, or reaches the worker's own V8 heap limit, at any time within the first
// 14,400 seconds. Returns the earliest such point, which bounds what completeness is required.
function leakEvidence({ loadSamples, counters, baseline, heapBoundBytes, expectedSeconds }) {
  const limit = expectedSeconds + SAMPLE_GAP_TOLERANCE_SECONDS;
  let elapsed = Infinity;
  for (const s of loadSamples) {
    if (s.elapsed > limit) continue;
    const rose = baseline !== null && s.heapUsed - baseline > CONTROL_MIN_RISE;
    const bound = typeof heapBoundBytes === "number" && s.heapUsed >= heapBoundBytes;
    if (rose || bound) elapsed = Math.min(elapsed, s.elapsed);
  }
  for (const d of counters.oomDeaths) {
    const e = typeof d.elapsed === "number" ? d.elapsed : 0;
    if (e <= limit) elapsed = Math.min(elapsed, e);
  }
  const leakShown = elapsed !== Infinity;
  return { leakShown, leakElapsed: leakShown ? elapsed : null };
}

function evaluateControl(leakShown, numbers) {
  return {
    checks: [
      {
        name: "control leak shown",
        ok: leakShown,
        detail: `rose > ${CONTROL_MIN_RISE} bytes above baseline or reached the heap limit (${mib(numbers.heapBoundBytes)} MiB) within ${EXPECTED_SECONDS}s`,
      },
    ],
    verdict: leakShown ? "pass" : "fail",
  };
}

export function analyze(records, options = {}) {
  const control = options.control ?? false;
  const expected = {
    seconds: options.expectedSeconds ?? EXPECTED_SECONDS,
    restSeconds: options.expectedRestSeconds ?? EXPECTED_REST_SECONDS,
    rate: options.expectedRate ?? EXPECTED_RATE,
  };
  const r = readRecords(records);
  const baseline =
    typeof r.baseline?.baseline?.memory?.heapUsed === "number"
      ? r.baseline.baseline.memory.heapUsed
      : null;
  const counters = reconcileCounters(r);
  const header = r.baseline;
  const heapBoundBytes = header?.heapSizeLimitBytes ?? header?.workerHeapBoundBytes ?? null;
  const leak = leakEvidence({
    loadSamples: r.loadSamples,
    counters,
    baseline,
    heapBoundBytes,
    expectedSeconds: expected.seconds,
  });

  // A control that shows the leak early must be complete only through the leak point; every other
  // run must be complete through the full four hours.
  const windowEnd = control && leak.leakShown ? leak.leakElapsed : expected.seconds;
  const minutes = minuteProblems(r.minutes, expected, windowEnd);
  const sampleCheck = sampleProblems(r.samples, r.loadSamples, windowEnd);

  const numbers = buildNumbers({
    baseline,
    loadSamples: r.loadSamples,
    loadEnd: r.loadEnd,
    postRest: r.postRest,
    counters,
    header,
    minutes: r.minutes,
    samples: r.samples,
    offProtocol: minutes.offProtocol,
    maxGap: sampleCheck.maxGap,
    expected,
  });

  const inconclusive = [
    ...headerProblems(header, expected),
    ...minutes.problems,
    ...sampleCheck.problems,
    ...phaseKindProblems(control, leak.leakShown, counters.unexplainedDeaths),
    ...phaseProblems(r.loadEnd, r.postRest, r.samples, expected),
  ];

  const evaluation = control ? evaluateControl(leak.leakShown, numbers) : evaluateFixed(numbers);

  return {
    verdict: inconclusive.length > 0 ? "inconclusive" : evaluation.verdict,
    control,
    inconclusive,
    checks: inconclusive.length > 0 ? [] : evaluation.checks,
    numbers,
    offProtocolMinutes: minutes.offProtocol,
  };
}

function mib(bytes) {
  return typeof bytes === "number" ? Number((bytes / MIB).toFixed(2)) : null;
}

function printReport(result, source) {
  const n = result.numbers;
  const out = [];
  out.push(`run:            ${source}`);
  out.push(`label:          ${n.label ?? "(none)"}${result.control ? "  [control]" : ""}`);
  out.push(`read targets:   ${n.readStreaming ? "all 15 agents (uniform)" : "the 8 idle agents"}`);
  out.push("");
  out.push(`baseline:       ${n.baselineMiB} MiB`);
  out.push(
    `max sample:     +${mib(n.maxAboveBaselineBytes)} MiB above baseline (limit ${mib(MAX_ABOVE_BASELINE)})`,
  );
  out.push(`last-hour slope:${mib(n.slopeBytesPerHour)} MiB/h (limit ${mib(MAX_SLOPE_PER_HOUR)})`);
  out.push(
    `post-rest:      ${mib(n.postRestBytes)} MiB vs last load ${mib(n.lastLoadSampleBytes)} MiB`,
  );
  out.push(`rpc errors:     ${n.rpcErrors} (+${n.streamErrors} stream)`);
  out.push(
    `worker deaths:  ${n.workerDeaths} (${n.oomDeaths} at the heap limit)${n.reachedHeapBound ? " [heap bound reached]" : ""}`,
  );
  out.push(
    `calls/minute:   ${n.expectedRate} expected; ${n.minutes} minute(s), ${n.offProtocolMinutes} off-protocol`,
  );
  out.push(
    `mix per minute: ${JSON.stringify(n.mixPerMinute)} (expected ${JSON.stringify(EXPECTED_MIX)})`,
  );
  out.push(`streaming:      ${n.streamingAgents} agent(s) (expected ${EXPECTED_FIXTURE.streamingAgents})`);
  out.push(`samples:        ${n.samples}, max gap ${n.maxSampleGapSeconds.toFixed(1)}s`);
  out.push("");
  for (const m of result.offProtocolMinutes.slice(0, 20)) {
    out.push(
      `  off-protocol minute #${m.index}: ${(m.elapsedEnd - m.elapsedStart).toFixed(1)}s, ${m.calls} calls ${JSON.stringify(m.byKind)}`,
    );
  }
  for (const c of result.checks) out.push(`${c.ok ? "PASS" : "FAIL"}  ${c.name}: ${c.detail}`);
  for (const p of result.inconclusive) out.push(`INCONCLUSIVE  ${p}`);
  out.push("");
  out.push(`VERDICT: ${result.verdict.toUpperCase()}`);
  out.push(JSON.stringify(result));
  return out.join("\n");
}

function exitCodeFor(verdict) {
  if (verdict === "pass") return 0;
  if (verdict === "fail") return 1;
  return 2;
}

const isMain =
  process.argv[1] &&
  fs.realpathSync(process.argv[1]) === fs.realpathSync(new URL(import.meta.url).pathname);

if (isMain) {
  const args = process.argv.slice(2);
  const control = args.includes("--control");
  const file = args.find((a) => !a.startsWith("--"));
  if (!file) {
    process.stderr.write("usage: analyze.mjs [--control] <run.jsonl>\n");
    process.exit(2);
  }
  const text = file === "-" ? fs.readFileSync(0, "utf8") : fs.readFileSync(file, "utf8");
  const records = text
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
  const result = analyze(records, { control });
  process.stdout.write(printReport(result, file) + "\n");
  process.exit(exitCodeFor(result.verdict));
}
