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
//   post-rest post-GC heapUsed no higher than the load-end sample.
// Control PASS (decimal MB): heap rose more than 500,000,000 bytes above its baseline, or the
//   worker reached its own V8 heap limit (a sample at heap_size_limit, or a timed worker exit whose
//   stderr shows the V8 heap-limit abort), within the first 14,400 seconds of load.
//
// Every record must first pass its type's schema (schema.mjs, derived from what soak.mjs writes):
// a violation makes the run INCONCLUSIVE, naming the record and the rule, and nothing is analysed.
//
// INCONCLUSIVE when anything the judgment rests on is absent, duplicated or contradictory, or the
// load breaks its protocol. A run is judged through its window: the full four hours and the rest
// for a fixed run or a control that shows no leak; for a control that shows the leak, through the
// leak point. Within the window:
//   the header carries the run's label, its mode (control or not), the exact fixture and protocol,
//     no diagnostic copy, the read targets (idle agents only for a control), the worker's real
//     heap limit, and a baseline that observes the seeded fixture;
//   every 30-second slot holds exactly one forced-GC sample, taken within 2 s of its slot;
//   every sample carries its observed running-agent count (7), its cumulative calls and calls by
//     kind (consistent with the minute buckets and never decreasing), its delivered stream chunks
//     (exactly the 7-agent, 2048-chunks-per-30-minutes schedule) and its error and death counters;
//   the stream schedule holds through the window's end: the load-end count reaches it within 2 s;
//   the wall-clock minute buckets are consecutive from 0, each anchored to its index and contiguous
//     with the next, every whole minute with exactly 27 calls in the 15/9/2/1 mix;
//   a full run has one load-end within 2 s of 14,400 s with its heap and counters, and one
//     post-rest 300 s (within 2 s) after it, by the two records' wall-clock `time` fields (the
//     load-end sample's own GC time is not rest); every run has one cleanup record;
//   a control has no RPC error or non-zero error counter of any kind up to its leak point (only
//     failures logged after its heap-limit abort and its last good sample are excused) and no
//     death other than a timed heap-limit abort before it.
// Every redundant pair in the record must agree within its stated tolerance; any disagreement is
// inconclusive. Each record's wall-clock `time` agrees with its `elapsed` (clockProblems); every
// error and death counter equals the events logged by then (counterProblems); the samples'
// cumulative calls, calls by kind and closed minutes agree with the minute buckets, and the end
// records' totals with both. README.md lists every field read and the check that guards it. A
// recorded, consistent error fails a fixed run.

import fs from "node:fs";

import { validateRun } from "./schema.mjs";

const MIB = 1024 ** 2;
const EXPECTED_SECONDS = 14400;
const EXPECTED_REST_SECONDS = 300;
const EXPECTED_RATE = 27;
const EXPECTED_MIX = { logs: 15, inspect: 9, ls: 2, send: 1 };
const MIX_KEYS = ["logs", "inspect", "ls", "send"];
const EXPECTED_MESSAGE_SECONDS = 1800;
const CHUNKS_PER_MESSAGE = 2048; // one 128 KiB message in 64-byte chunks
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
// No four-hour load records a minute past index 240; a larger index is malformed (and must not
// drive the per-index loops).
const MAX_MINUTE_INDEX = EXPECTED_SECONDS / 60;
const TOLERANCE_SECONDS = 2;
// The driver stamps every record with the wall clock (`time`) as it logs it, and takes `elapsed`
// from the same Date.now(), starting as the baseline is logged. A record whose `elapsed` is taken
// as it is logged (worker-exit, post-rest, the last minute) shows both within milliseconds (0 ms on
// the real control); 0.5 s allows for an event-loop stall in the driver.
const CLOCK_TOLERANCE_SECONDS = 0.5;
const HEAP_LIMIT_RE = /Reached heap limit|heap out of memory|Allocation failed/i;
const ERROR_COUNTERS = ["rpcErrors", "streamErrors", "workerDeaths"];
// The driver's errorsByKind keys: the four calls, a stream chunk, a forced-GC sample, other.
const ERROR_KINDS = ["logs", "inspect", "ls", "send", "stream", "sample", "other"];
const LOGGED_STAGES = new Set([
  "baseline",
  "sample",
  "minute",
  "rpc-error",
  "worker-exit",
  "load-end",
  "post-rest",
  "cleanup",
]);
const RECORD_COUNTERS = ["calls", "streamChunks", ...ERROR_COUNTERS];
const SINGLE_STAGES = ["baseline", "load-end", "post-rest", "cleanup"];

const isCount = (v) => Number.isInteger(v) && v >= 0;
const isTime = (v) => Number.isFinite(v) && v >= 0;
const isAbsent = (v) => v === undefined || v === null;
// A record's wall-clock `time` in seconds (the driver stamps every record as it logs it).
const wallSeconds = (rec) => {
  const ms = typeof rec?.time === "string" ? Date.parse(rec.time) : Number.NaN;
  return Number.isFinite(ms) ? ms / 1000 : null;
};
const heapOf = (rec) => {
  const h = rec?.memory?.heapUsed;
  return Number.isFinite(h) && h > 0 ? h : null;
};
const kindsValid = (byKind) => MIX_KEYS.every((k) => isCount(byKind?.[k]));
const kindsTotal = (byKind) => MIX_KEYS.reduce((n, k) => n + byKind[k], 0);
const errorKindsValid = (byKind) => ERROR_KINDS.every((k) => isCount(byKind?.[k]));
const short = (value) => Number(value.toFixed(3));
// The driver streams each agent to floor(elapsed / period * 2048) chunks before it samples.
const scheduledChunks = (elapsed) =>
  EXPECTED_FIXTURE.streamingAgents *
  Math.floor((elapsed / EXPECTED_MESSAGE_SECONDS) * CHUNKS_PER_MESSAGE);
const isHeapLimitAbort = (exit) =>
  isTime(exit.elapsed) &&
  exit.oom !== false &&
  typeof exit.reason === "string" &&
  HEAP_LIMIT_RE.test(exit.reason);

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
  const of = (stage) => records.filter((r) => r?.stage === stage);
  const singles = Object.fromEntries(SINGLE_STAGES.map((stage) => [stage, of(stage)]));
  return {
    singles,
    header: singles.baseline[0] ?? null,
    loadEnd: singles["load-end"].at(-1) ?? null,
    postRest: singles["post-rest"].at(-1) ?? null,
    cleanup: singles.cleanup.at(-1) ?? null,
    sampleRecords: of("sample"),
    minuteRecords: of("minute"),
    workerExits: of("worker-exit"),
    rpcErrorEvents: of("rpc-error"),
    unparseable: of("unparseable").length,
  };
}

// A sample without a time or a heap is reported, never silently dropped.
function readSamples(sampleRecords) {
  const series = [];
  let malformed = 0;
  for (const rec of sampleRecords) {
    const heapUsed = heapOf(rec);
    if (isTime(rec.elapsed) && heapUsed !== null)
      series.push({ rec, elapsed: rec.elapsed, heapUsed });
    else malformed++;
  }
  series.sort((a, b) => a.elapsed - b.elapsed);
  return { series, malformed };
}

function readMinutes(minuteRecords) {
  const valid = [];
  let malformed = 0;
  for (const m of minuteRecords) {
    const ok =
      Number.isInteger(m.index) &&
      m.index >= 0 &&
      m.index <= MAX_MINUTE_INDEX &&
      isTime(m.elapsedStart) &&
      isTime(m.elapsedEnd) &&
      m.elapsedEnd >= m.elapsedStart &&
      isCount(m.calls) &&
      kindsValid(m.byKind) &&
      kindsTotal(m.byKind) === m.calls;
    if (ok) valid.push(m);
    else malformed++;
  }
  valid.sort((a, b) => a.index - b.index);
  return { valid, malformed };
}

// The bucket with the highest index: the one the driver closes at load end.
function lastMinuteRecord(minuteRecords) {
  return minuteRecords.reduce(
    (last, m) => (Number.isInteger(m.index) && (last === null || m.index > last.index) ? m : last),
    null,
  );
}

// Cumulative calls (total and by kind) before each minute index, from the minute buckets.
function minuteTotals(minutes) {
  const byIndex = new Map(minutes.map((m) => [m.index, m]));
  const last = minutes.at(-1)?.index ?? -1;
  const before = [{ calls: 0, logs: 0, inspect: 0, ls: 0, send: 0 }];
  for (let i = 0; i <= last; i++) {
    const m = byIndex.get(i);
    const prev = before[i];
    const next = { calls: prev.calls + (m?.calls ?? 0) };
    for (const k of MIX_KEYS) next[k] = prev[k] + (m?.byKind[k] ?? 0);
    before.push(next);
  }
  return { byIndex, before, all: before.at(-1) };
}

function structureProblems(r) {
  const problems = [];
  if (r.unparseable > 0) problems.push(`${r.unparseable} unparseable JSONL line(s)`);
  for (const [stage, list] of Object.entries(r.singles)) {
    if (list.length > 1) problems.push(`${list.length} "${stage}" records, expected one`);
  }
  if (!r.cleanup) problems.push("no cleanup record (the run did not finish)");
  return problems;
}

// The header line carries the run's identity. Any altered or absent protocol or fixture setting,
// the diagnostics-only boundary copy, or a mode that contradicts the judgment disqualifies it.
function headerProblems(header, control) {
  if (!header) return ["no baseline record"];
  return [
    ...identityProblems(header, control),
    ...protocolProblems(header.protocol ?? {}),
    ...fixtureProblems(header.fixture ?? {}),
    ...baselineObservationProblems(header.baseline),
  ];
}

function identityProblems(header, control) {
  const problems = [];
  if (typeof header.label !== "string" || header.label === "")
    problems.push("no run label (commit and package set) in the header");
  if (header.control !== control)
    problems.push(
      `header control ${header.control}, but judged as ${control ? "the control" : "a fixed run"}`,
    );
  if (header.boundaryCopy !== false)
    problems.push(`boundaryCopy ${header.boundaryCopy} (only a run without the diagnostic copy)`);
  if (typeof header.readStreaming !== "boolean")
    problems.push(`readStreaming ${header.readStreaming} is not recorded`);
  else if (control && header.readStreaming)
    problems.push("readStreaming true: the control reads the 8 idle agents only");
  if (!(Number.isFinite(header.heapSizeLimitBytes) && header.heapSizeLimitBytes > 0))
    problems.push("the worker's heap_size_limit is not recorded");
  return problems;
}

function protocolProblems(p) {
  const expected = {
    seconds: EXPECTED_SECONDS,
    restSeconds: EXPECTED_REST_SECONDS,
    connectionsPerMinute: EXPECTED_RATE,
    messageSeconds: EXPECTED_MESSAGE_SECONDS,
  };
  const problems = [];
  for (const [k, v] of Object.entries(expected)) {
    if (p[k] !== v) problems.push(`protocol.${k} ${p[k]} != ${v}`);
  }
  if (MIX_KEYS.some((k) => p.mix?.[k] !== EXPECTED_MIX[k]))
    problems.push(`protocol.mix ${JSON.stringify(p.mix)} != ${JSON.stringify(EXPECTED_MIX)}`);
  return problems;
}

function fixtureProblems(f) {
  const problems = [];
  for (const [k, v] of Object.entries({ ...EXPECTED_FIXTURE, rowBytes: EXPECTED_ROW_BYTES })) {
    if (f[k] !== v) problems.push(`fixture.${k} ${f[k]} != ${v}`);
  }
  return problems;
}

// The baseline is sampled after seeding: it must observe the 15 agents, 7 running and 8 idle, and
// at least the seeded rows.
function baselineObservationProblems(baseline) {
  const problems = [];
  if (heapOf(baseline) === null) problems.push("baseline heapUsed missing");
  const a = baseline?.agents;
  const { agents, running, idle, seededRows } = EXPECTED_FIXTURE;
  if (a?.total !== agents || a?.byLifecycle?.running !== running || a?.byLifecycle?.idle !== idle)
    problems.push(
      `the baseline does not observe ${agents} agents, ${running} running and ${idle} idle (${JSON.stringify(a?.byLifecycle ?? null)})`,
    );
  const rows = a?.timelineStats?.totalItems;
  if (!(Number.isInteger(rows) && rows >= seededRows))
    problems.push(`the baseline observes ${rows} timeline rows, not the ${seededRows} seeded`);
  return problems;
}

// Every 30-second slot through the window holds exactly one sample, taken within 2 s of its slot.
// A slot is due once the load has run 2 s past it; the first slot is always due.
function slotProblems(series, malformed, windowEnd, full) {
  const problems = [];
  if (malformed > 0)
    problems.push(`${malformed} sample record(s) without a numeric elapsed or heapUsed`);
  const bySlot = new Map();
  let offSlot = 0;
  for (const s of series) {
    const slot = Math.floor(s.elapsed / SAMPLE_PERIOD_SECONDS);
    if (s.elapsed - slot * SAMPLE_PERIOD_SECONDS > TOLERANCE_SECONDS) offSlot++;
    bySlot.set(slot, (bySlot.get(slot) ?? 0) + 1);
  }
  const lastDue = Math.max(0, Math.floor((windowEnd - TOLERANCE_SECONDS) / SAMPLE_PERIOD_SECONDS));
  const missing = [];
  for (let k = 0; k <= lastDue; k++) if (!bySlot.has(k)) missing.push(k * SAMPLE_PERIOD_SECONDS);
  const doubled = [...bySlot].filter(([, n]) => n > 1).map(([k]) => k * SAMPLE_PERIOD_SECONDS);
  if (missing.length > 0)
    problems.push(`${missing.length} sample slot(s) missing (first at ${missing[0]}s)`);
  if (doubled.length > 0)
    problems.push(`${doubled.length} sample slot(s) with more than one sample (${doubled[0]}s)`);
  if (offSlot > 0)
    problems.push(`${offSlot} sample(s) more than ${TOLERANCE_SECONDS}s after their 30 s slot`);
  const beyond = full ? series.filter((s) => s.elapsed >= windowEnd).length : 0;
  if (beyond > 0) problems.push(`${beyond} sample(s) at or after the ${windowEnd}s load`);
  return problems;
}

const SAMPLE_INSTRUMENTS = [
  ["without a cumulative call count", (s) => !isCount(s.calls)],
  [
    "without cumulative counts by kind that sum to its calls",
    (s) => !kindsValid(s.byKind) || kindsTotal(s.byKind) !== s.calls,
  ],
  ["without a delivered stream-chunk count", (s) => !isCount(s.streamChunks)],
  ["without a closed-minute count", (s) => !isCount(s.minutes)],
  ["without errors by kind", (s) => !errorKindsValid(s.errorsByKind)],
  [
    "without RPC error, stream error and worker death counters",
    (s) => !ERROR_COUNTERS.every((f) => isCount(s[f])),
  ],
];

function instrumentProblems(series) {
  const problems = [];
  for (const [what, bad] of SAMPLE_INSTRUMENTS) {
    const n = series.filter((s) => bad(s.rec)).length;
    if (n > 0) problems.push(`${n} sample(s) ${what}`);
  }
  return problems;
}

// A sample's cumulative calls lie between the minutes before its own and those through its own
// (a call can trail its sample by a few milliseconds); they never decrease; and its delivered
// stream chunks are exactly the schedule's unless it records a stream error.
function sampleLoadProblems(series, totals) {
  let outsideMinutes = 0;
  let decreasing = 0;
  let offSchedule = 0;
  let wrongMinutes = 0;
  let prev = null;
  for (const { rec, elapsed } of series) {
    if (!isCount(rec.calls) || !kindsValid(rec.byKind) || !isCount(rec.streamChunks)) continue;
    if (!withinMinutes(rec, elapsed, totals)) outsideMinutes++;
    if (prev && decreased(prev, rec)) decreasing++;
    if (!chunksOnSchedule(rec, elapsed)) offSchedule++;
    if (isCount(rec.minutes) && rec.minutes !== closedMinutes(rec.calls, totals)) wrongMinutes++;
    prev = rec;
  }
  const problems = [];
  if (wrongMinutes > 0)
    problems.push(
      `${wrongMinutes} sample(s) whose closed-minute count disagrees with the minute buckets`,
    );
  if (outsideMinutes > 0)
    problems.push(`${outsideMinutes} sample(s) whose cumulative calls disagree with the minutes`);
  if (decreasing > 0) problems.push(`${decreasing} sample(s) with a decreasing cumulative count`);
  if (offSchedule > 0)
    problems.push(`${offSchedule} sample(s) whose delivered stream chunks are off the schedule`);
  return problems;
}

// The driver closes a minute's bucket when a call lands in a later minute, so a sample's closed
// count is the index of the bucket that holds its last call (0 before any call).
function closedMinutes(calls, totals) {
  let index = 0;
  while (index + 1 < totals.before.length && totals.before[index + 1].calls < calls) index++;
  return index;
}

function withinMinutes(rec, elapsed, totals) {
  const index = Math.floor(elapsed / 60);
  const lower = totals.before[Math.min(index, totals.before.length - 1)];
  const upper = totals.byIndex.has(index) ? totals.before[index + 1] : null;
  const fields = [["calls", rec.calls], ...MIX_KEYS.map((k) => [k, rec.byKind[k]])];
  return fields.every(([k, v]) => v >= lower[k] && (upper === null || v <= upper[k]));
}

function decreased(prev, rec) {
  return (
    rec.calls < prev.calls ||
    rec.streamChunks < prev.streamChunks ||
    MIX_KEYS.some((k) => rec.byKind[k] < prev.byKind[k])
  );
}

function chunksOnSchedule(rec, elapsed) {
  const due = scheduledChunks(elapsed);
  return rec.streamErrors > 0 ? rec.streamChunks <= due : rec.streamChunks === due;
}

// Wall-clock minute buckets: consecutive indices from 0 with no hole, each starting at index * 60
// and ending where the next starts (the last one is closed at load end). Every whole minute of the
// window carries exactly 27 calls in the 15/9/2/1 mix over a 60-second window.
function minuteProblems(minutes, windowEnd, full) {
  const { valid, malformed } = minutes;
  const complete = Math.floor(windowEnd / 60);
  const problems = [];
  if (malformed > 0)
    problems.push(
      `${malformed} minute bucket(s) without an index, start and end times, or kinds summing to its calls`,
    );
  const counts = new Map();
  for (const m of valid) counts.set(m.index, (counts.get(m.index) ?? 0) + 1);
  const last = valid.at(-1)?.index ?? -1;
  const missing = [];
  for (let i = 0; i <= Math.max(last, complete - 1); i++) if (!counts.has(i)) missing.push(i);
  const doubled = [...counts].filter(([, n]) => n > 1).length;
  const untimed = valid.filter((m, j) => !minuteTimed(m, valid[j + 1], last)).length;
  const offProtocol = valid.filter((m) => m.index < complete && !minuteOnProtocol(m));
  const beyond = full ? valid.filter((m) => m.index >= complete).length : 0;
  if (missing.length > 0)
    problems.push(`${missing.length} minute index(es) missing (first ${missing[0]})`);
  if (doubled > 0) problems.push(`${doubled} duplicated minute index(es)`);
  if (untimed > 0)
    problems.push(`${untimed} minute bucket(s) not anchored to their index or not contiguous`);
  if (offProtocol.length > 0) problems.push(`${offProtocol.length} off-protocol minute(s)`);
  if (beyond > 0) problems.push(`${beyond} minute bucket(s) beyond the ${windowEnd}s load`);
  return { problems, offProtocol };
}

function minuteTimed(m, next, last) {
  if (Math.abs(m.elapsedStart - m.index * 60) > TOLERANCE_SECONDS) return false;
  if (m.index < last && Math.abs(m.elapsedEnd - (m.index + 1) * 60) > TOLERANCE_SECONDS)
    return false;
  return !(next && next.index === m.index + 1 && next.elapsedStart !== m.elapsedEnd);
}

function minuteOnProtocol(m) {
  return (
    m.calls === EXPECTED_RATE &&
    MIX_KEYS.every((k) => m.byKind[k] === EXPECTED_MIX[k]) &&
    Math.abs(m.elapsedEnd - m.elapsedStart - 60) <= TOLERANCE_SECONDS
  );
}

// Load-end, post-rest and cleanup: every counter they carry is a count; their calls equal the
// minute buckets' (no load after the load end); load-end's delivered chunks lie between the last
// sample's and the schedule at load end, and the later records repeat them. No sample follows the
// load end.
function recordProblems({ loadEnd, postRest, cleanup }, totals, series, minutes) {
  const problems = [];
  const named = [
    ["load-end", loadEnd],
    ["post-rest", postRest],
    ["cleanup", cleanup],
  ].filter(([, rec]) => rec);
  for (const [name, rec] of named) {
    const bad = RECORD_COUNTERS.filter((f) => Object.hasOwn(rec, f) && !isCount(rec[f]));
    if (Object.hasOwn(rec, "byKind") && !kindsValid(rec.byKind)) bad.push("byKind");
    if (bad.length > 0) problems.push(`${name} ${bad.join(", ")} not a count`);
    if (isCount(rec.calls) && rec.calls !== totals.all.calls)
      problems.push(`${name} calls ${rec.calls} != ${totals.all.calls} in the minute buckets`);
    if (kindsValid(rec.byKind) && MIX_KEYS.some((k) => rec.byKind[k] !== totals.all[k]))
      problems.push(`${name} calls by kind disagree with the minute buckets`);
  }
  if (loadEnd)
    problems.push(
      ...loadEndCounterProblems(
        loadEnd,
        postRest,
        cleanup,
        series,
        minutes.count,
        minutes.valid.at(-1),
      ),
    );
  return problems;
}

function loadEndCounterProblems(loadEnd, postRest, cleanup, series, minuteCount, lastMinute) {
  const problems = [];
  if (isCount(loadEnd.minutes) && loadEnd.minutes !== minuteCount)
    problems.push(`load-end minutes ${loadEnd.minutes} != ${minuteCount} minute bucket(s)`);
  // The driver closes the last bucket with the very value it records as load-end's elapsed.
  if (lastMinute && lastMinute.elapsedEnd !== loadEnd.elapsed)
    problems.push(
      `the last minute bucket ends at ${short(lastMinute.elapsedEnd)}s, not at load-end ${loadEnd.elapsed}s`,
    );
  const end = isTime(loadEnd.elapsed) ? loadEnd.elapsed : null;
  const after = end === null ? 0 : series.filter((s) => s.elapsed > end).length;
  if (after > 0) problems.push(`${after} sample(s) after load-end`);
  const chunks = loadEnd.streamChunks;
  if (!isCount(chunks)) return problems;
  const lastSampled = series.findLast((s) => isCount(s.rec.streamChunks))?.rec.streamChunks ?? 0;
  if (chunks < lastSampled || (end !== null && chunks > scheduledChunks(end)))
    problems.push(`load-end stream chunks ${chunks} are off the schedule`);
  for (const [name, rec] of [
    ["post-rest", postRest],
    ["cleanup", cleanup],
  ]) {
    if (isCount(rec?.streamChunks) && rec.streamChunks !== chunks)
      problems.push(`${name} stream chunks ${rec.streamChunks} != load-end ${chunks}`);
  }
  return problems;
}

// The harness marks its own stop of the worker (after the rest) as `stopping`; such an exit
// before the run's end would hide a death.
function stopProblems({ workerExits, loadEnd, postRest }) {
  const runEnd = [postRest?.elapsed, loadEnd?.elapsed].find(isTime);
  const early = workerExits.filter(
    (e) =>
      e.stopping === true && !(isTime(e.elapsed) && runEnd !== undefined && e.elapsed >= runEnd),
  ).length;
  return early > 0
    ? [`${early} worker exit(s) marked as the harness's stop before the run ended`]
    : [];
}

// A full run carries its load end (its time, heap and counters) and its rest.
function phaseProblems({ loadEnd, postRest, header }) {
  const problems = [];
  if (loadEnd) problems.push(...loadEndProblems(loadEnd));
  else problems.push("no load-end record: the load's end and last heap are not observed");
  if (!postRest) problems.push("no post-rest record (run cut short)");
  else if (loadEnd) problems.push(...restProblems(loadEnd, postRest, wallSeconds(header)));
  return problems;
}

function loadEndProblems(loadEnd) {
  const problems = [];
  if (!isTime(loadEnd.elapsed)) problems.push("load-end has no elapsed time");
  else if (Math.abs(loadEnd.elapsed - EXPECTED_SECONDS) > TOLERANCE_SECONDS)
    problems.push(`load ran ${loadEnd.elapsed.toFixed(1)}s, expected ${EXPECTED_SECONDS}s`);
  if (heapOf(loadEnd) === null) problems.push("load-end has no heapUsed");
  const absent = [...RECORD_COUNTERS, "byKind", "minutes", "errorsByKind"].filter((f) =>
    isAbsent(loadEnd[f]),
  );
  if (absent.length > 0) problems.push(`load-end without ${absent.join(", ")}`);
  return problems;
}

// The rest is the driver's 300-second sleep. It must hold on both clocks, within 2 s:
//   wall clock: from the load-end record (logged after its forced-GC sample) to the post-rest
//     record (logged after its own; the driver records no start for that sample);
//   elapsed clock: post-rest minus load-end elapsed, less the load-end sample's own duration as
//     its record measures it against the baseline's origin (measurement, not rest).
// The two differ only by post-rest's own clock offset, which the clock check bounds.
function restSpan(loadEnd, postRest, origin) {
  const start = wallSeconds(loadEnd);
  const end = wallSeconds(postRest);
  if (start === null || end === null) return null;
  const valid = origin !== null && isTime(postRest?.elapsed) && isTime(loadEnd?.elapsed);
  const loadEndSample = valid ? start - origin - loadEnd.elapsed : null;
  return {
    rest: end - start,
    elapsed: valid ? postRest.elapsed - loadEnd.elapsed : null,
    loadEndSample,
    elapsedRest: valid ? postRest.elapsed - loadEnd.elapsed - loadEndSample : null,
  };
}

function restProblems(loadEnd, postRest, origin) {
  const problems = [];
  if (!isTime(postRest.elapsed) || !isTime(loadEnd.elapsed))
    problems.push("post-rest or load-end has no elapsed time");
  const span = restSpan(loadEnd, postRest, origin);
  if (span === null) {
    problems.push("load-end or post-rest has no parseable time: the rest is not observed");
  } else {
    if (Math.abs(span.rest - EXPECTED_REST_SECONDS) > TOLERANCE_SECONDS)
      problems.push(`rest ran ${span.rest.toFixed(1)}s, expected ${EXPECTED_REST_SECONDS}s`);
    const elapsedRest = span.elapsedRest;
    if (elapsedRest !== null && Math.abs(elapsedRest - EXPECTED_REST_SECONDS) > TOLERANCE_SECONDS)
      problems.push(
        `elapsed rest ran ${elapsedRest.toFixed(1)}s (less the ${span.loadEndSample.toFixed(1)}s load-end sample), expected ${EXPECTED_REST_SECONDS}s`,
      );
  }
  if (heapOf(postRest) === null) problems.push("post-rest has no heapUsed");
  return problems;
}

// Every record's `time` agrees with the moment it records: with the baseline's time as origin, a
// record is logged `time - origin - moment` seconds after that moment, within its band:
//   worker-exit, post-rest and the last minute (closed at load end) take `elapsed` as they are
//     logged: within 0.5 s;
//   a periodic sample is logged after its stream, call and forced GC, and a minute bucket after the
//     call that closes it: within one 30-second sample period;
//   load-end is logged after its forced GC, the same sample the periodic ones take without their
//     stream and call work: no later than the run's slowest periodic sample, plus 0.5 s;
//   an RPC failure is logged at or after its dispatch (it may be in flight until the worker dies).
// The cleanup record is logged last.
function clockProblems(records, r, lastMinute) {
  const problems = [];
  const untimed = records.filter(
    (x) => LOGGED_STAGES.has(x?.stage) && wallSeconds(x) === null,
  ).length;
  if (untimed > 0) problems.push(`${untimed} record(s) without a parseable time`);
  const origin = wallSeconds(r.header);
  if (origin === null)
    return [...problems, "the baseline has no parseable time: the clock has no origin"];
  const offset = (rec, moment) => {
    const t = wallSeconds(rec);
    return t === null || !isTime(moment) ? null : t - origin - moment;
  };
  const sampleOffsets = r.sampleRecords.map((x) => offset(x, x.elapsed)).filter((d) => d !== null);
  const slowest = Math.max(0, ...sampleOffsets);
  const C = CLOCK_TOLERANCE_SECONDS;
  const closedAtEnd = (m) => r.loadEnd !== null && m === lastMinute;
  const bands = [
    ["sample", r.sampleRecords, "elapsed", -C, SAMPLE_PERIOD_SECONDS],
    [
      "minute",
      r.minuteRecords.filter((m) => !closedAtEnd(m)),
      "elapsedEnd",
      -C,
      SAMPLE_PERIOD_SECONDS,
    ],
    ["last minute", r.minuteRecords.filter(closedAtEnd), "elapsedEnd", -C, C],
    ["worker-exit", r.workerExits, "elapsed", -C, C],
    ["post-rest", r.singles["post-rest"], "elapsed", -C, C],
    ["load-end", r.singles["load-end"], "elapsed", -C, Infinity],
    ["rpc-error", r.rpcErrorEvents, "elapsed", -C, Infinity],
  ];
  for (const [name, list, field, lo, hi] of bands) {
    const off = list
      .map((x) => offset(x, x[field]))
      .filter((d) => d !== null && (d < lo || d > hi));
    if (off.length > 0)
      problems.push(
        `${name}: ${off.length} record(s) logged ${off[0].toFixed(1)}s from their elapsed moment (allowed ${lo} to ${hi} s)`,
      );
  }
  for (const end of r.singles["load-end"]) {
    const d = offset(end, end.elapsed);
    if (d !== null && d > slowest + C)
      problems.push(
        `the load-end sample took ${d.toFixed(1)}s, longer than the slowest periodic sample (${slowest.toFixed(1)}s) + ${C} s`,
      );
  }
  const cleanupTime = wallSeconds(r.cleanup);
  const latest = Math.max(
    ...records.filter((x) => x?.stage !== "cleanup").map((x) => wallSeconds(x) ?? -Infinity),
  );
  if (cleanupTime !== null && cleanupTime < latest)
    problems.push("the cleanup record is not logged last");
  return problems;
}

// Every error counter on every record that carries it equals the events logged by then: rpcErrors
// the RPC failures, streamErrors the stream failures, errorsByKind each kind's failures, and
// workerDeaths the worker exits that were not the harness's own stop. A counter with no event, or
// an event no later counter records, is a contradiction.
function counterProblems(r) {
  const events = r.rpcErrorEvents.map((e) => ({ t: wallSeconds(e), kind: e.kind }));
  const exits = r.workerExits.filter((e) => e.stopping !== true).map(wallSeconds);
  const recs = [
    ...r.sampleRecords,
    ...r.singles["load-end"],
    ...r.singles["post-rest"],
    ...r.singles.cleanup,
  ];
  let off = 0;
  let first = null;
  for (const rec of recs) {
    const t = wallSeconds(rec);
    if (t === null) continue;
    const before = events.filter((e) => e.t !== null && e.t <= t);
    const mismatch = counterMismatch(rec, before, exits.filter((x) => x !== null && x <= t).length);
    if (!mismatch) continue;
    off++;
    first ??= `${rec.stage} at ${rec.elapsed}s: ${mismatch}`;
  }
  return off > 0
    ? [
        `${off} record(s) whose error or death counters disagree with the events logged by then (first: ${first})`,
      ]
    : [];
}

function counterMismatch(rec, before, deaths) {
  const expected = [
    ["rpcErrors", before.length],
    ["streamErrors", before.filter((e) => e.kind === "stream").length],
    ["workerDeaths", deaths],
  ];
  if (rec.errorsByKind && typeof rec.errorsByKind === "object") {
    const kinds = new Set([...Object.keys(rec.errorsByKind), ...before.map((e) => String(e.kind))]);
    for (const k of kinds)
      expected.push([`errorsByKind.${k}`, before.filter((e) => String(e.kind) === k).length]);
  }
  for (const [field, n] of expected) {
    const value = field.startsWith("errorsByKind.")
      ? (rec.errorsByKind[field.slice(13)] ?? 0)
      : rec[field];
    if (field.startsWith("errorsByKind.") || isCount(value)) {
      if (value !== n) return `${field} ${value}, ${n} event(s)`;
    }
  }
  return null;
}

// Cumulative error and death counters are never erased by a later, smaller one: take the maximum
// over every record that carries them and the event records. Deaths are classified by their
// worker-exit events; a death counted without an event is untimed.
function reconcileCounters({
  sampleRecords,
  loadEnd,
  postRest,
  cleanup,
  workerExits,
  rpcErrorEvents,
}) {
  const recs = [...sampleRecords, loadEnd, postRest, cleanup].filter(Boolean);
  const maxOf = (field, events) =>
    recs.reduce((m, r) => Math.max(m, isCount(r[field]) ? r[field] : 0), events);
  const deathEvents = workerExits.filter((e) => e.stopping !== true);
  const deaths = maxOf("workerDeaths", deathEvents.length);
  return {
    errors: maxOf("rpcErrors", rpcErrorEvents.length),
    streamErrors: maxOf("streamErrors", rpcErrorEvents.filter((e) => e.kind === "stream").length),
    deaths,
    oomDeaths: deathEvents.filter(isHeapLimitAbort),
    otherDeaths: deathEvents.filter((e) => !isHeapLimitAbort(e)),
    untimedDeaths: deaths - deathEvents.length,
  };
}

// The control shows the load leaks when its heap rises more than 500,000,000 bytes (decimal MB)
// above its own baseline, or reaches the worker's own V8 heap limit, within the first 14,400
// seconds and no later than its load end. Returns the earliest such point: the window's end.
function leakEvidence({ series, loadEnd, baseline, heapLimit, oomDeaths }) {
  const endAt = isTime(loadEnd?.elapsed) ? loadEnd.elapsed : Infinity;
  const limit = Math.min(EXPECTED_SECONDS + TOLERANCE_SECONDS, endAt);
  const points = series.map(({ elapsed, heapUsed }) => ({ elapsed, heapUsed }));
  if (heapOf(loadEnd) !== null && endAt !== Infinity)
    points.push({ elapsed: endAt, heapUsed: heapOf(loadEnd) });
  let elapsed = Infinity;
  for (const p of points) {
    if (p.elapsed > limit) continue;
    const rose = baseline !== null && p.heapUsed - baseline > CONTROL_MIN_RISE;
    const bound = heapLimit !== null && p.heapUsed >= heapLimit;
    if (rose || bound) elapsed = Math.min(elapsed, p.elapsed);
  }
  for (const d of oomDeaths) if (d.elapsed <= limit) elapsed = Math.min(elapsed, d.elapsed);
  const leakShown = elapsed !== Infinity;
  return { leakShown, leakElapsed: leakShown ? elapsed : null };
}

// A failure is excused only when the worker's heap-limit abort caused it: logged at or after a
// recorded heap-limit worker-exit, after the last good sample was logged, and dispatched no earlier
// than that sample. Its message plays no part.
function excusedByAbort(workerExits, series) {
  const abortTimes = workerExits
    .filter((e) => e.stopping !== true && isHeapLimitAbort(e))
    .map(wallSeconds)
    .filter((t) => t !== null);
  if (abortTimes.length === 0) return () => false;
  const abortAt = Math.min(...abortTimes);
  const last = series.at(-1);
  const lastLogged = last ? (wallSeconds(last.rec) ?? Infinity) : -Infinity;
  const lastElapsed = last?.elapsed ?? -Infinity;
  return (e) => {
    const t = wallSeconds(e);
    return (
      t !== null && t >= abortAt && t > lastLogged && isTime(e.elapsed) && e.elapsed >= lastElapsed
    );
  };
}

// Up to its leak point, the control's load must have been delivered: any failure dispatched by
// then that its abort did not cause, and any non-zero error or death counter of any kind on a
// sample in the window, disqualifies it. (Every counter equals its events: counterProblems.) No
// death other than a timed heap-limit abort may come at or before the window's end.
function controlProblems({ series, counters, rpcErrorEvents, workerExits, windowEnd }) {
  const problems = [];
  const excused = excusedByAbort(workerExits, series);
  const dispatched = rpcErrorEvents.filter(
    (e) => !excused(e) && (!isTime(e.elapsed) || e.elapsed <= windowEnd),
  ).length;
  const counted = series
    .filter((s) => s.elapsed <= windowEnd)
    .reduce((m, { rec }) => Math.max(m, ...errorCounts(rec)), 0);
  const errors = Math.max(dispatched, counted);
  if (errors > 0)
    problems.push(
      `${errors} RPC error(s) or death(s) before the leak point: the load was not delivered as stated`,
    );
  const otherDeaths = counters.otherDeaths.filter(
    (e) => !isTime(e.elapsed) || e.elapsed <= windowEnd,
  ).length;
  const unexplained = otherDeaths + Math.max(0, counters.untimedDeaths);
  if (unexplained > 0)
    problems.push(`${unexplained} worker death(s) that are not a timed heap-limit abort`);
  return problems;
}

// Every error and death counter a record carries, by kind as well.
function errorCounts(rec) {
  const byKind = rec.errorsByKind && typeof rec.errorsByKind === "object" ? rec.errorsByKind : {};
  return [...ERROR_COUNTERS.map((f) => rec[f]), ...Object.values(byKind)].map((v) =>
    isCount(v) ? v : 0,
  );
}

// The stream schedule holds through the end of the judged window, not only at the last 30 s
// sample: the count delivered by the load end reaches the schedule 2 s before the window's end (the
// driver streams at the start of every loop iteration, about every 100 ms). A window that ends on a
// sample is already checked exactly by that sample.
function deliveryProblems(loadEnd, series, windowEnd, full, explained) {
  // A fixed run's recorded stream failures explain the shortfall; they fail the run.
  if (explained) return [];
  const through = full ? loadEnd?.elapsed : windowEnd;
  if (!isTime(through) || series.some((s) => s.elapsed === through)) return [];
  const chunks = loadEnd?.streamChunks;
  if (!isCount(chunks))
    return [
      `no delivered stream-chunk count at the load end: delivery to ${through}s not observed`,
    ];
  const due = scheduledChunks(through - TOLERANCE_SECONDS);
  return chunks < due
    ? [`load-end stream chunks ${chunks} short of the ${due} due by ${through}s`]
    : [];
}

// Seven agents run and stream throughout: every sample and the load-end sample observe 7 running
// agents (a control's, up to its leak point). One that stops running is a malfunction. If the
// fixed run recorded stream failures, its stream stopped: the run FAILs on those errors and the
// count is not a protocol break. Otherwise fewer than 7 streaming agents is inconclusive
// (O-000279). An agent that is closed or errors changes the total or adds a lifecycle, which the
// schema rejects.
function runningProblems(series, loadEnd, { control, windowEnd, streamFailed }) {
  const observed = [...series.map((s) => s.rec), ...(loadEnd?.agents ? [loadEnd] : [])];
  const judged = control ? observed.filter((x) => x.elapsed <= windowEnd) : observed;
  const off = judged.filter((x) => x.agents.byLifecycle.running !== EXPECTED_FIXTURE.running);
  if (off.length === 0 || (!control && streamFailed)) return [];
  return [
    `${off.length} observation(s) with running agents != ${EXPECTED_FIXTURE.running} (first at ${off[0].elapsed}s): fewer than 7 streaming agents`,
  ];
}

// The client fixture: 13 persistent clients, 2 of them subscribed to agent updates (soak.mjs opens
// them before the baseline and holds them; reconnect is off). The worker observes them as its TCP
// socket handles, one per connected client (the short-lived call clients have closed by the time
// a sample is taken), and as the agent manager's subscriptions: the 2 subscribed clients plus the
// daemon's own persistence listener (persistence-hooks.ts). The baseline shows exactly 13 and 3;
// every sample and the live load-end through the end of load (a control's up to its leak point)
// shows no fewer. A drop is a fixture break: inconclusive.
const DAEMON_SUBSCRIPTIONS = 1;

function clientFixtureProblems(header, series, loadEnd, { control, windowEnd }) {
  const sockets = EXPECTED_FIXTURE.persistentClients;
  const subscriptions = EXPECTED_FIXTURE.subscribedClients + DAEMON_SUBSCRIPTIONS;
  const seen = (stage, elapsed, o) => ({
    stage,
    elapsed,
    sockets: o.handles.TCPSocketWrap ?? 0,
    subscriptions: o.agents.subscriptionCount,
    exact: stage === "baseline",
  });
  const observed = [
    seen("baseline", 0, header.baseline),
    ...series.map((s) => seen("sample", s.elapsed, s.rec)),
    ...(loadEnd?.agents ? [seen("load-end", loadEnd.elapsed, loadEnd)] : []),
  ];
  const judged = control ? observed.filter((x) => x.elapsed <= windowEnd) : observed;
  const off = judged.filter((x) =>
    x.exact
      ? x.sockets !== sockets || x.subscriptions !== subscriptions
      : x.sockets < sockets || x.subscriptions < subscriptions,
  );
  if (off.length === 0) return [];
  const f = off[0];
  return [
    `${off.length} observation(s) without the client fixture of ${sockets} persistent clients, ${EXPECTED_FIXTURE.subscribedClients} subscribed (first: ${f.stage} at ${f.elapsed}s: ${f.sockets} socket(s), ${f.subscriptions} subscription(s) with the daemon's own)`,
  ];
}

// The worker does not come back after it exits: no record observes it afterwards. After the
// harness's own stop only cleanup follows. After a death only cleanup follows, except in a control
// whose leak point the death does not precede: there the driver's death path follows (the
// failures the exit causes, the last minute bucket and the sample-less load-end, both closed at
// load end).
const DEATH_PATH = new Set(["rpc-error", "minute", "load-end", "cleanup"]);

function afterExitProblems(records, r, { control, leak }) {
  const exits = r.workerExits
    .map((e) => ({ e, t: wallSeconds(e) }))
    .filter((x) => x.t !== null)
    .sort((a, b) => a.t - b.t);
  if (exits.length === 0) return [];
  const { e: exit, t: exitAt } = exits[0];
  const deathPath =
    control && exit.stopping !== true && leak.leakShown && leak.leakElapsed <= exit.elapsed;
  const problems = [];
  records.forEach((x, i) => {
    const t = wallSeconds(x);
    if (x === exit || t === null || t <= exitAt) return;
    if (x.memory)
      problems.push(
        `record ${i + 1} (${x.stage}) observes the worker after its exit at ${exit.elapsed}s`,
      );
    else if (x.stage !== "cleanup" && !(deathPath && DEATH_PATH.has(x.stage)))
      problems.push(`record ${i + 1} (${x.stage}) follows the worker's exit at ${exit.elapsed}s`);
  });
  return problems.length > 3
    ? [...problems.slice(0, 3), `... and ${problems.length - 3} more record(s) after the exit`]
    : problems;
}

// The load's heap series: every sample, then the load-end sample when it has a heap.
function loadSeries(series, loadEnd) {
  const points = series.map(({ elapsed, heapUsed }) => ({ elapsed, heapUsed }));
  if (heapOf(loadEnd) !== null && isTime(loadEnd.elapsed))
    points.push({ elapsed: loadEnd.elapsed, heapUsed: heapOf(loadEnd) });
  return points.sort((a, b) => a.elapsed - b.elapsed);
}

function maxGapSeconds(series) {
  let maxGap = 0;
  for (let i = 1; i < series.length; i++)
    maxGap = Math.max(maxGap, series[i].elapsed - series[i - 1].elapsed);
  return maxGap;
}

function buildNumbers(ctx) {
  const { baseline, series, loadEnd, postRest, counters, header, minutes, offProtocol, leak } = ctx;
  const loadSamples = loadSeries(series, loadEnd);
  // The last hour ends at the actual final load point: the load-end sample, or the last sample.
  const endAt = loadSamples.at(-1)?.elapsed ?? 0;
  const tail = loadSamples.filter((s) => s.elapsed >= endAt - 3600);
  const maxHeap = loadSamples.reduce((m, s) => Math.max(m, s.heapUsed), baseline ?? 0);
  const heapBound = Number.isFinite(header?.heapSizeLimitBytes) ? header.heapSizeLimitBytes : null;
  return {
    baselineBytes: baseline,
    baselineMiB: mib(baseline),
    maxSampleBytes: maxHeap,
    maxAboveBaselineBytes: baseline === null ? null : maxHeap - baseline,
    lastLoadSampleBytes: loadSamples.at(-1)?.heapUsed ?? null,
    postRestBytes: heapOf(postRest),
    ...restNumbers(loadEnd, postRest, wallSeconds(header)),
    slopeBytesPerHour: leastSquaresSlopePerHour(tail),
    tailSamples: tail.length,
    rpcErrors: counters.errors,
    streamErrors: counters.streamErrors,
    workerDeaths: counters.deaths,
    oomDeaths: counters.oomDeaths.length,
    heapBoundBytes: heapBound,
    reachedHeapBound:
      counters.oomDeaths.length > 0 ||
      (heapBound !== null && loadSamples.some((s) => s.heapUsed >= heapBound)),
    leakElapsed: leak.leakElapsed,
    samples: series.length,
    maxSampleGapSeconds: maxGapSeconds(series),
    loadSeconds: isTime(loadEnd?.elapsed) ? loadEnd.elapsed : endAt,
    minutes: minutes.length,
    offProtocolMinutes: offProtocol.length,
    streamingAgents: series[0]?.rec.agents?.byLifecycle?.running ?? null,
    mixPerMinute: totalMix(minutes),
    ...identity(header),
  };
}

function restNumbers(loadEnd, postRest, origin) {
  const span = loadEnd && postRest ? restSpan(loadEnd, postRest, origin) : null;
  return { restSeconds: span?.rest ?? null, restElapsedSeconds: span?.elapsed ?? null };
}

function identity(header) {
  return {
    expectedRate: EXPECTED_RATE,
    readStreaming: header?.readStreaming ?? null,
    control: header?.control ?? null,
    label: header?.label ?? null,
  };
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

function evaluateControl(leak, numbers) {
  return {
    checks: [
      {
        name: "control leak shown",
        ok: leak.leakShown,
        detail: `rose > ${CONTROL_MIN_RISE} bytes above baseline or reached the heap limit (${mib(numbers.heapBoundBytes)} MiB) within ${EXPECTED_SECONDS}s${leak.leakShown ? `, at ${leak.leakElapsed}s` : ""}`,
      },
    ],
    verdict: leak.leakShown ? "pass" : "fail",
  };
}

// A result that judges nothing: the run cannot be analysed, so it is INCONCLUSIVE.
function unanalysed(control, why, problems, extra = {}) {
  return {
    verdict: "inconclusive",
    control,
    unanalysed: why,
    inconclusive: problems,
    checks: [],
    numbers: {},
    offProtocolMinutes: [],
    ...extra,
  };
}

// A run that fails before its baseline (the worker does not start, or seeding the fixture fails)
// leaves only the driver's failure records: its fixture was never observed, and nothing can be
// judged.
function preBaselineProblem(records) {
  const exits = records
    .filter((x) => x?.stage === "worker-exit")
    .map((e) => `the worker exited at ${e.elapsed}s (code ${e.code}, signal ${e.signal})`);
  const failures = records.filter((x) => x?.stage === "rpc-error").length;
  const seen = [...exits, ...(failures > 0 ? [`${failures} RPC failure(s)`] : [])];
  return `no baseline record: the run never reached its baseline${seen.length > 0 ? ` (${seen.join("; ")})` : ""}`;
}

// Judge a run. No exception decides the verdict: an internal error makes the run INCONCLUSIVE,
// naming the error.
export function analyze(records, options = {}) {
  const control = options.control === true;
  try {
    return analyzeRun(records, control);
  } catch (error) {
    return unanalysed(control, "internal error", [`internal error: ${errorText(error)}`]);
  }
}

function errorText(error) {
  return error instanceof Error ? error.message : String(error);
}

function analyzeRun(records, control) {
  // The schema runs first: a record that is not exactly what the driver writes is not analysed.
  const schemaViolations = validateRun(records);
  if (schemaViolations.length > 0)
    return unanalysed(control, "schema", schemaViolations, { schemaViolations });
  const r = readRecords(records);
  const header = r.header;
  if (!header) return unanalysed(control, "no baseline", [preBaselineProblem(records)]);
  const baseline = heapOf(header?.baseline);
  const heapLimit =
    Number.isFinite(header?.heapSizeLimitBytes) && header.heapSizeLimitBytes > 0
      ? header.heapSizeLimitBytes
      : null;
  const { series, malformed } = readSamples(r.sampleRecords);
  const minutes = readMinutes(r.minuteRecords);
  const totals = minuteTotals(minutes.valid);
  const counters = reconcileCounters(r);
  const leak = control
    ? leakEvidence({
        series,
        loadEnd: r.loadEnd,
        baseline,
        heapLimit,
        oomDeaths: counters.oomDeaths,
      })
    : { leakShown: false, leakElapsed: null };

  // A control that shows the leak is judged through its leak point; every other run through the
  // full four hours and its rest.
  const full = !leak.leakShown;
  const streamFailed = counters.streamErrors > 0;
  const windowEnd = full ? EXPECTED_SECONDS : leak.leakElapsed;
  const minuteCheck = minuteProblems(minutes, windowEnd, full);

  const inconclusive = [
    ...structureProblems(r),
    ...headerProblems(header, control),
    ...minuteCheck.problems,
    ...slotProblems(series, malformed, windowEnd, full),
    ...instrumentProblems(series),
    ...sampleLoadProblems(series, totals),
    ...recordProblems(r, totals, series, { count: r.minuteRecords.length, valid: minutes.valid }),
    ...clockProblems(records, r, lastMinuteRecord(r.minuteRecords)),
    ...counterProblems(r),
    ...stopProblems(r),
    ...afterExitProblems(records, r, { control, leak }),
    ...runningProblems(series, r.loadEnd, { control, windowEnd, streamFailed }),
    ...clientFixtureProblems(header, series, r.loadEnd, { control, windowEnd }),
    ...deliveryProblems(r.loadEnd, series, windowEnd, full, !control && streamFailed),
    ...(full ? phaseProblems(r) : []),
    ...(control ? controlProblems({ series, counters, ...r, windowEnd }) : []),
  ];

  const numbers = buildNumbers({
    baseline,
    series,
    loadEnd: r.loadEnd,
    postRest: r.postRest,
    counters,
    header,
    minutes: minutes.valid,
    offProtocol: minuteCheck.offProtocol,
    leak,
  });
  const evaluation = control ? evaluateControl(leak, numbers) : evaluateFixed(numbers);

  return {
    verdict: inconclusive.length > 0 ? "inconclusive" : evaluation.verdict,
    control,
    inconclusive,
    checks: inconclusive.length > 0 ? [] : evaluation.checks,
    numbers,
    offProtocolMinutes: minuteCheck.offProtocol,
  };
}

function seconds(value) {
  return typeof value === "number" ? `${value.toFixed(1)} s` : "(not observed)";
}

function mib(bytes) {
  return typeof bytes === "number" ? Number((bytes / MIB).toFixed(2)) : null;
}

function printReport(result, source) {
  if (result.unanalysed) {
    return [
      `run:            ${source}${result.control ? "  [control]" : ""}`,
      `not analysed:   ${result.unanalysed}`,
      "",
      ...result.inconclusive.map((p) => `INCONCLUSIVE  ${p}`),
      "",
      `VERDICT: ${result.verdict.toUpperCase()}`,
      JSON.stringify(result),
    ].join("\n");
  }
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
  out.push(
    `rest:           ${seconds(n.restSeconds)} on the wall clock (elapsed ${seconds(n.restElapsedSeconds)}; expected ${EXPECTED_REST_SECONDS} s)`,
  );
  out.push(`rpc errors:     ${n.rpcErrors} (${n.streamErrors} of them stream)`);
  out.push(
    `worker deaths:  ${n.workerDeaths} (${n.oomDeaths} at the heap limit)${n.reachedHeapBound ? " [heap bound reached]" : ""}`,
  );
  if (result.control) out.push(`leak point:     ${n.leakElapsed ?? "(none)"}s`);
  out.push(
    `calls/minute:   ${n.expectedRate} expected; ${n.minutes} minute(s), ${n.offProtocolMinutes} off-protocol`,
  );
  out.push(
    `mix (total):    ${JSON.stringify(n.mixPerMinute)} (per minute ${JSON.stringify(EXPECTED_MIX)})`,
  );
  out.push(
    `streaming:      ${n.streamingAgents} agent(s) (expected ${EXPECTED_FIXTURE.streamingAgents})`,
  );
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

// An unreadable line is kept as a record the analyzer reports, never dropped.
function parseLine(line) {
  try {
    const value = JSON.parse(line);
    return value !== null && typeof value === "object" ? value : { stage: "unparseable" };
  } catch {
    return { stage: "unparseable" };
  }
}

const isMain =
  process.argv[1] &&
  fs.realpathSync(process.argv[1]) === fs.realpathSync(new URL(import.meta.url).pathname);

// The CLI's last resort: whatever fails while reading, analysing or reporting, the verdict is
// INCONCLUSIVE (exit 2), naming the error. It builds its text without the report's helpers.
function failInconclusive(source, error) {
  process.stdout.write(
    [
      `run:            ${source}`,
      "not analysed:   internal error",
      "",
      `INCONCLUSIVE  internal error: ${errorText(error)}`,
      "",
      "VERDICT: INCONCLUSIVE",
      "",
    ].join("\n"),
  );
  process.exit(2);
}

function main(args) {
  const control = args.includes("--control");
  const file = args.find((a) => !a.startsWith("--"));
  if (!file) {
    process.stderr.write("usage: analyze.mjs [--control] <run.jsonl>\n");
    process.exit(2);
  }
  process.on("uncaughtException", (error) => failInconclusive(file, error));
  try {
    const text = file === "-" ? fs.readFileSync(0, "utf8") : fs.readFileSync(file, "utf8");
    const records = text
      .split("\n")
      .filter((l) => l.trim())
      .map(parseLine);
    const result = analyze(records, { control });
    process.stdout.write(printReport(result, file) + "\n");
    process.exit(exitCodeFor(result.verdict));
  } catch (error) {
    failInconclusive(file, error);
  }
}

if (isMain) main(process.argv.slice(2));
