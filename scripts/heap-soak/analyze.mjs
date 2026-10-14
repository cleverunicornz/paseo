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
//   zero RPC errors, zero worker deaths;
//   max post-GC heapUsed no more than 64 MiB above the baseline;
//   least-squares slope over the last hour of load below 16 MiB an hour;
//   post-rest post-GC heapUsed no higher than the last load sample.
// Control PASS: heap rose more than 500 MB above its baseline, or the worker reached its heap
//   bound (died, or a sample at/over the bound), within the 4 hours.
//
// INCONCLUSIVE when the load breaks its protocol: fewer than 7 streaming agents, a minute off
// the 27-call 15/9/2/1 rate or mix, or — in a fixed run — a missing 30-second sample or a run
// cut short of its load or its rest. The control run is expected to die at the heap bound, so
// its length is not required. The protocol numbers are fixed constants and are never relaxed.

import fs from "node:fs";

const MIB = 1024 ** 2;
const EXPECTED_SECONDS = 14400;
const EXPECTED_REST_SECONDS = 300;
const EXPECTED_RATE = 27;
const EXPECTED_MIX = { logs: 15, inspect: 9, ls: 2, send: 1 };
const MIX_KEYS = ["logs", "inspect", "ls", "send"];
const EXPECTED_STREAMING_AGENTS = 7;
const MAX_ABOVE_BASELINE = 64 * MIB;
const MAX_SLOPE_PER_HOUR = 16 * MIB;
const CONTROL_MIN_RISE = 500 * MIB;
const SAMPLE_PERIOD_SECONDS = 30;
const SAMPLE_GAP_TOLERANCE_SECONDS = 40;
const HEAP_BOUND_FRACTION = 0.95;

const heapOf = (rec) => rec?.memory?.heapUsed ?? rec?.heapUsed ?? null;

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

function collectSeries(records) {
  const samples = records
    .filter((r) => r.stage === "sample")
    .map((r) => ({ elapsed: r.elapsed, heapUsed: heapOf(r) }))
    .filter((s) => typeof s.heapUsed === "number");
  const loadEndRec = records.findLast((r) => r.stage === "load-end") ?? null;
  const loadEndPoint =
    loadEndRec && typeof heapOf(loadEndRec) === "number"
      ? [{ elapsed: loadEndRec.elapsed, heapUsed: heapOf(loadEndRec) }]
      : [];
  return {
    samples,
    loadEndRec,
    loadSamples: [...samples, ...loadEndPoint].sort((a, b) => a.elapsed - b.elapsed),
  };
}

function maxSampleGap(samples) {
  let maxGap = 0;
  for (let i = 1; i < samples.length; i++) {
    maxGap = Math.max(maxGap, samples[i].elapsed - samples[i - 1].elapsed);
  }
  return maxGap;
}

function loadSecondsOf(loadEndRec, loadSamples) {
  return loadEndRec?.elapsed ?? loadSamples.at(-1)?.elapsed ?? 0;
}

// Fixture and the per-minute rate/mix must hold in every run, fixed or control: they are what
// shows the load was the stated one.
function loadShapeProblems({ baselineRec, minutes, runningCounts, offProtocolMinutes }, expected) {
  const problems = [];
  if (!baselineRec) {
    problems.push("no baseline record");
  } else if (baselineRec.fixture?.streamingAgents !== EXPECTED_STREAMING_AGENTS) {
    problems.push(
      `streaming agents ${baselineRec.fixture?.streamingAgents} != ${EXPECTED_STREAMING_AGENTS}`,
    );
  }
  const badRunning = runningCounts.filter((n) => n !== EXPECTED_STREAMING_AGENTS);
  if (badRunning.length > 0)
    problems.push(
      `${badRunning.length} sample(s) with running agents != ${EXPECTED_STREAMING_AGENTS}`,
    );
  const requiredMinutes = Math.floor(expected.seconds / 60) - 1;
  if (minutes.length < requiredMinutes)
    problems.push(`only ${minutes.length} complete minutes, expected ${requiredMinutes}`);
  if (offProtocolMinutes.length > 0)
    problems.push(`${offProtocolMinutes.length} off-protocol minute(s)`);
  return problems;
}

// A fixed run must carry its full load and its rest; the control is not required to.
function fixedRunLengthProblems({ samples, loadEndRec, loadSamples, postRestRec }, expected) {
  const problems = [];
  const loadSeconds = loadSecondsOf(loadEndRec, loadSamples);
  if (loadSeconds < expected.seconds - SAMPLE_PERIOD_SECONDS)
    problems.push(`load ran ${loadSeconds.toFixed(0)}s, expected ${expected.seconds}s`);
  const expectedSamples = Math.floor(expected.seconds / SAMPLE_PERIOD_SECONDS) + 1;
  if (samples.length < expectedSamples - 2)
    problems.push(`only ${samples.length} samples, expected ~${expectedSamples}`);
  const gap = maxSampleGap(samples);
  if (gap > SAMPLE_GAP_TOLERANCE_SECONDS + SAMPLE_PERIOD_SECONDS)
    problems.push(`sample gap ${gap.toFixed(0)}s > ${SAMPLE_PERIOD_SECONDS}s`);
  if (!postRestRec) {
    problems.push("no post-rest record (run cut short)");
  } else {
    const restSeconds = postRestRec.elapsed - loadSeconds;
    if (restSeconds < expected.restSeconds - SAMPLE_PERIOD_SECONDS)
      problems.push(`rest ran ${restSeconds.toFixed(0)}s, expected ${expected.restSeconds}s`);
  }
  return problems;
}

function evaluateFixed(numbers) {
  const checks = [
    {
      name: "zero RPC errors and worker deaths",
      ok: numbers.rpcErrors === 0 && numbers.workerDeaths === 0,
      detail: `${numbers.rpcErrors} error(s), ${numbers.workerDeaths} death(s)`,
    },
    {
      name: "max sample within 64 MiB of baseline",
      ok:
        numbers.maxAboveBaselineBytes !== null &&
        numbers.maxAboveBaselineBytes <= MAX_ABOVE_BASELINE,
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

function evaluateControl(numbers) {
  const leakShown = numbers.maxAboveBaselineBytes > CONTROL_MIN_RISE || numbers.reachedHeapBound;
  const checks = [
    {
      name: "control leak shown",
      ok: leakShown,
      detail: `max +${mib(numbers.maxAboveBaselineBytes)} MiB above baseline (>${mib(CONTROL_MIN_RISE)} MiB) or heap bound reached (${numbers.reachedHeapBound})`,
    },
  ];
  return { checks, verdict: leakShown ? "pass" : "fail" };
}

function errorCount(cleanupRec, loadEndRec, records) {
  if (typeof cleanupRec?.rpcErrors === "number") return cleanupRec.rpcErrors;
  if (typeof loadEndRec?.rpcErrors === "number") return loadEndRec.rpcErrors;
  return records.filter((r) => r.stage === "rpc-error").length;
}

function totalMix(minutes) {
  return Object.fromEntries(
    MIX_KEYS.map((k) => [k, minutes.reduce((n, m) => n + (m.byKind?.[k] ?? 0), 0)]),
  );
}

function buildNumbers(ctx) {
  const {
    baseline,
    maxHeap,
    loadSamples,
    postRestRec,
    cleanupRec,
    loadEndRec,
    samples,
    minutes,
    baselineRec,
    offProtocolMinutes,
    records,
    workerHeapBoundBytes,
    expected,
  } = ctx;
  const tail = loadSamples.filter(
    (s) => s.elapsed >= loadSecondsOf(loadEndRec, loadSamples) - 3600,
  );
  const numbers = {
    baselineBytes: baseline,
    baselineMiB: mib(baseline),
    maxSampleBytes: maxHeap,
    maxAboveBaselineBytes: baseline === null ? null : maxHeap - baseline,
    lastLoadSampleBytes: loadSamples.at(-1)?.heapUsed ?? null,
    postRestBytes: heapOf(postRestRec),
    slopeBytesPerHour: leastSquaresSlopePerHour(tail),
    tailSamples: tail.length,
    rpcErrors: errorCount(cleanupRec, loadEndRec, records),
    workerDeaths: cleanupRec?.workerDeaths ?? loadEndRec?.workerDeaths ?? 0,
    workerHeapBoundBytes,
    samples: samples.length,
    maxSampleGapSeconds: maxSampleGap(samples),
    loadSeconds: loadSecondsOf(loadEndRec, loadSamples),
    minutes: minutes.length,
    offProtocolMinutes: offProtocolMinutes.length,
    streamingAgents: baselineRec?.fixture?.streamingAgents ?? null,
    expectedRate: expected.rate,
    mixPerMinute: totalMix(minutes),
    readStreaming: baselineRec?.readStreaming ?? null,
    label: baselineRec?.label ?? null,
  };
  numbers.reachedHeapBound =
    numbers.workerDeaths > 0 ||
    (baseline !== null && maxHeap >= workerHeapBoundBytes * HEAP_BOUND_FRACTION);
  return numbers;
}

export function analyze(records, options = {}) {
  const control = options.control ?? false;
  const expected = {
    control,
    seconds: options.expectedSeconds ?? EXPECTED_SECONDS,
    restSeconds: options.expectedRestSeconds ?? EXPECTED_REST_SECONDS,
    rate: options.expectedRate ?? EXPECTED_RATE,
  };

  const baselineRec = records.find((r) => r.stage === "baseline") ?? null;
  const postRestRec = records.find((r) => r.stage === "post-rest") ?? null;
  const cleanupRec = records.find((r) => r.stage === "cleanup") ?? null;
  const { samples, loadEndRec, loadSamples } = collectSeries(records);
  const minutes = records.filter((r) => r.stage === "minute");
  const runningCounts = records
    .filter((r) => r.stage === "sample")
    .map((r) => r.agents?.byLifecycle?.running)
    .filter((n) => typeof n === "number");
  const offProtocolMinutes = minutes.filter(
    (m) =>
      m.calls !== expected.rate || MIX_KEYS.some((k) => (m.byKind?.[k] ?? 0) !== EXPECTED_MIX[k]),
  );

  const baseline =
    typeof baselineRec?.baseline?.memory?.heapUsed === "number"
      ? baselineRec.baseline.memory.heapUsed
      : null;
  const workerHeapBoundBytes =
    baselineRec?.workerHeapBoundBytes ?? options.workerHeapBoundBytes ?? 768 * MIB;

  const inconclusive = loadShapeProblems(
    { baselineRec, minutes, runningCounts, offProtocolMinutes },
    expected,
  );
  if (baseline === null && !inconclusive.includes("no baseline record"))
    inconclusive.push("baseline heapUsed missing");
  if (!control)
    inconclusive.push(
      ...fixedRunLengthProblems({ samples, loadEndRec, loadSamples, postRestRec }, expected),
    );

  const maxHeap = loadSamples.reduce((m, s) => Math.max(m, s.heapUsed), baseline ?? 0);
  const numbers = buildNumbers({
    baseline,
    maxHeap,
    loadSamples,
    postRestRec,
    cleanupRec,
    loadEndRec,
    samples,
    minutes,
    baselineRec,
    offProtocolMinutes,
    records,
    workerHeapBoundBytes,
    expected,
  });

  const evaluation = decide({ inconclusive, control, numbers });

  return {
    verdict: evaluation.verdict,
    control,
    inconclusive,
    checks: evaluation.checks,
    numbers,
    offProtocolMinutes,
  };
}

function decide({ inconclusive, control, numbers }) {
  if (inconclusive.length > 0) return { verdict: "inconclusive", checks: [] };
  return control ? evaluateControl(numbers) : evaluateFixed(numbers);
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
  out.push(`rpc errors:     ${n.rpcErrors}`);
  out.push(`worker deaths:  ${n.workerDeaths}${n.reachedHeapBound ? " (heap bound reached)" : ""}`);
  out.push(
    `calls/minute:   ${n.expectedRate} expected; ${n.minutes} complete minute(s), ${n.offProtocolMinutes} off-protocol`,
  );
  out.push(
    `mix per minute: ${JSON.stringify(n.mixPerMinute)} (expected ${JSON.stringify(EXPECTED_MIX)})`,
  );
  out.push(`streaming:      ${n.streamingAgents} agent(s) (expected ${EXPECTED_STREAMING_AGENTS})`);
  out.push(`samples:        ${n.samples}, max gap ${n.maxSampleGapSeconds.toFixed(0)}s`);
  out.push("");
  for (const m of result.offProtocolMinutes.slice(0, 20)) {
    out.push(`  off-protocol minute #${m.index}: ${m.calls} calls ${JSON.stringify(m.byKind)}`);
  }
  for (const c of result.checks) out.push(`${c.ok ? "PASS" : "FAIL"}  ${c.name}: ${c.detail}`);
  for (const r of result.inconclusive) out.push(`INCONCLUSIVE  ${r}`);
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
