import assert from "node:assert/strict";
import test from "node:test";

import { analyze } from "./analyze.mjs";

const MIB = 1024 ** 2;

// Build a synthetic run at a short duration (default 300 s) so the pass/fail/inconclusive logic
// is tested without a four-hour series. The record shapes match soak.mjs's JSONL.
function buildRun({
  seconds = 300,
  restSeconds = 60,
  rate = 27,
  mix = { logs: 15, inspect: 9, ls: 2, send: 1 },
  baselineMiB = 200,
  heapAt = () => baselineMiB, // (elapsedSeconds) => MiB
  postRestHeapMiB = null,
  streamingAgents = 7,
  runningPerSample = 7,
  failMinute = null, // index of a minute whose mix/rate is wrong
  rpcErrors = 0,
  workerDeaths = 0,
  control = false,
} = {}) {
  const records = [];
  const baseline = baselineMiB * MIB;
  records.push({
    stage: "baseline",
    label: "synthetic",
    control,
    readStreaming: false,
    fixture: { agents: 15, running: 7, idle: 8, streamingAgents },
    protocol: { seconds, restSeconds, connectionsPerMinute: rate, messageSeconds: 1800, mix },
    workerHeapBoundBytes: 768 * MIB,
    baseline: { memory: { heapUsed: baseline } },
  });
  let runningNow = runningPerSample;
  for (let t = 0; t <= seconds; t += 30) {
    records.push({
      stage: "sample",
      elapsed: t,
      heapUsed: heapAt(t) * MIB,
      calls: 0,
      rpcErrors,
      workerDeaths,
      memory: { heapUsed: heapAt(t) * MIB },
      agents: { byLifecycle: { running: runningNow } },
    });
    runningNow = runningPerSample;
  }
  const minuteCount = Math.floor(seconds / 60);
  for (let i = 0; i < minuteCount; i++) {
    const bad = failMinute === i;
    records.push({
      stage: "minute",
      index: i,
      elapsed: i * 60,
      elapsedEnd: (i + 1) * 60,
      calls: bad ? rate - 1 : rate,
      byKind: bad ? { ...mix, send: mix.send - 1 } : { ...mix },
    });
  }
  records.push({
    stage: "load-end",
    elapsed: seconds,
    calls: minuteCount * rate,
    minutes: minuteCount,
    rpcErrors,
    workerDeaths,
    memory: { heapUsed: heapAt(seconds) * MIB },
  });
  if (postRestHeapMiB !== null) {
    records.push({
      stage: "post-rest",
      elapsed: seconds + restSeconds,
      memory: { heapUsed: postRestHeapMiB * MIB },
    });
  }
  records.push({ stage: "cleanup", rpcErrors, workerDeaths });
  return {
    records,
    options: {
      control,
      expectedSeconds: seconds,
      expectedRestSeconds: restSeconds,
      expectedRate: rate,
    },
  };
}

test("a flat fixed run with a clean protocol passes", () => {
  const { records, options } = buildRun({ heapAt: () => 200, postRestHeapMiB: 199 });
  const result = analyze(records, options);
  assert.equal(result.verdict, "pass");
  assert.equal(result.checks.length, 4);
  assert.ok(result.checks.every((c) => c.ok));
  assert.equal(result.numbers.workerDeaths, 0);
  assert.equal(result.numbers.streamingAgents, 7);
});

test("a leak above 64 MiB fails on the bound check", () => {
  // 300 s rising 100 MiB: within 500 MiB so this is a fixed-run failure, not a control pass.
  const { records, options } = buildRun({
    heapAt: (t) => 200 + (t / 300) * 100,
    postRestHeapMiB: 300,
  });
  const result = analyze(records, options);
  assert.equal(result.verdict, "fail");
  const bound = result.checks.find((c) => c.name.includes("64 MiB"));
  assert.equal(bound.ok, false);
});

test("a high last-hour slope fails", () => {
  // Flat then a late climb: under 64 MiB total but every MiB earned in the last hour.
  const { records, options } = buildRun({
    heapAt: (t) => 200 + (t < 240 ? 0 : ((t - 240) / 60) * 40),
    postRestHeapMiB: 240,
  });
  const result = analyze(records, options);
  assert.equal(result.verdict, "fail");
  const slope = result.checks.find((c) => c.name.includes("slope"));
  assert.equal(slope.ok, false);
});

test("post-rest heap above the last load sample fails", () => {
  const { records, options } = buildRun({ heapAt: () => 200, postRestHeapMiB: 210 });
  const result = analyze(records, options);
  assert.equal(result.verdict, "fail");
  const rest = result.checks.find((c) => c.name.includes("post-rest"));
  assert.equal(rest.ok, false);
});

test("rpc errors or worker deaths fail", () => {
  const { records, options } = buildRun({ postRestHeapMiB: 199, rpcErrors: 2, workerDeaths: 1 });
  const result = analyze(records, options);
  assert.equal(result.verdict, "fail");
  const errors = result.checks.find((c) => c.name.includes("zero RPC"));
  assert.equal(errors.ok, false);
});

test("an off-protocol minute makes the run inconclusive", () => {
  const { records, options } = buildRun({ postRestHeapMiB: 199, failMinute: 2 });
  const result = analyze(records, options);
  assert.equal(result.verdict, "inconclusive");
  assert.equal(result.numbers.offProtocolMinutes, 1);
  assert.equal(result.offProtocolMinutes[0].index, 2);
});

test("fewer than 7 streaming agents makes the run inconclusive", () => {
  const { records, options } = buildRun({ postRestHeapMiB: 199, streamingAgents: 6 });
  const result = analyze(records, options);
  assert.equal(result.verdict, "inconclusive");
});

test("a sample with the wrong running-agent count makes the run inconclusive", () => {
  const { records, options } = buildRun({ postRestHeapMiB: 199, runningPerSample: 6 });
  const result = analyze(records, options);
  assert.equal(result.verdict, "inconclusive");
});

test("a cut-short load makes the run inconclusive", () => {
  const { records, options } = buildRun({ postRestHeapMiB: 199 });
  // Drop the last half of the samples: fewer than the expected count and a short load.
  const short = records.filter((r) => !(r.stage === "sample" && r.elapsed > 150));
  const result = analyze(short, options);
  assert.equal(result.verdict, "inconclusive");
});

test("a missing post-rest makes a fixed run inconclusive", () => {
  const { records, options } = buildRun({ postRestHeapMiB: null });
  const result = analyze(records, options);
  assert.equal(result.verdict, "inconclusive");
});

test("a control run that rises over 500 MB passes", () => {
  const { records, options } = buildRun({
    control: true,
    heapAt: (t) => 200 + (t / 300) * 800,
    postRestHeapMiB: 1000,
  });
  const result = analyze(records, options);
  assert.equal(result.verdict, "pass");
});

test("a control run that reaches the heap bound (worker death) passes", () => {
  const { records, options } = buildRun({
    control: true,
    heapAt: () => 700,
    postRestHeapMiB: null,
    workerDeaths: 1,
  });
  const result = analyze(records, options);
  assert.equal(result.verdict, "pass");
});

test("a control run that stays flat fails", () => {
  const { records, options } = buildRun({ control: true, heapAt: () => 200, postRestHeapMiB: 199 });
  const result = analyze(records, options);
  assert.equal(result.verdict, "fail");
});
