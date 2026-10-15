// scripts/heap-soak/schema.mjs
//
// The record schemas of a soak run's JSONL, derived from what soak.mjs writes (its `logger` calls)
// and what worker.mjs's `metrics()` returns. analyze.mjs runs validateRun() before any analysis;
// any violation makes the run inconclusive, naming the record (1-based, the JSONL line when the
// file has no blank lines) and the rule.
//
// Every record has exactly its type's fields: required, exact types, counts as integers >= 0,
// times as ISO strings, enumerations where the driver writes a fixed set, and no unknown record
// types or fields. Each type's intra-record invariants hold, and across the run every worker
// observation comes from the same worker (pid) with the same V8 heap limit as the header.

const ISO_TIME = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;
const CALL_KINDS = ["logs", "inspect", "ls", "send"];
const ERROR_KINDS = [...CALL_KINDS, "stream", "sample", "other"];
const FIXTURE_AGENTS = 15;
const MAX_MINUTE_INDEX = 240;
// worker.mjs reports v8.getHeapStatistics() whole; these are its keys on the Node that ran the soak.
const HEAP_STATISTICS = [
  "total_heap_size",
  "total_heap_size_executable",
  "total_physical_size",
  "total_available_size",
  "used_heap_size",
  "heap_size_limit",
  "malloced_memory",
  "peak_malloced_memory",
  "does_zap_garbage",
  "number_of_native_contexts",
  "number_of_detached_contexts",
  "total_global_handles_size",
  "used_global_handles_size",
  "external_memory",
];
// soak.mjs records the first match of its heap-limit pattern in the worker's stderr.
const HEAP_LIMIT_REASON = /^(Reached heap limit|heap out of memory|Allocation failed)$/i;

// --- Field rules: each returns null when the value conforms, or what it must be -------------

const count = (v) => (Number.isInteger(v) && v >= 0 ? null : "an integer >= 0");
const positive = (v) => (Number.isInteger(v) && v > 0 ? null : "an integer > 0");
const seconds = (v) => (Number.isFinite(v) && v >= 0 ? null : "a finite number >= 0");
const text = (v) => (typeof v === "string" ? null : "a string");
const name = (v) => (typeof v === "string" && v !== "" ? null : "a non-empty string");
const flag = (v) => (typeof v === "boolean" ? null : "a boolean");
const time = (v) =>
  typeof v === "string" && ISO_TIME.test(v) && Number.isFinite(Date.parse(v))
    ? null
    : "an ISO-8601 UTC time";
const port = (v) => (Number.isInteger(v) && v > 0 && v < 65536 ? null : "a TCP port");
const minuteIndex = (v) =>
  Number.isInteger(v) && v >= 0 && v <= MAX_MINUTE_INDEX
    ? null
    : `an integer 0..${MAX_MINUTE_INDEX}`;
const oneOf = (values) => (v) => (values.includes(v) ? null : `one of ${values.join(", ")}`);
const orNull = (rule) => (v) => (v === null ? null : rule(v) && `${rule(v)} or null`);
const reason = (v) =>
  v === null || (typeof v === "string" && HEAP_LIMIT_REASON.test(v))
    ? null
    : "null or the V8 heap-limit banner";

// An object with exactly these fields; a field's rule is a function or a nested shape.
const shape = (fields) => ({ fields });
// An object of any keys, every value by one rule (libuv's handle types vary).
const mapOf = (rule) => ({ values: rule });

const byKind = shape(Object.fromEntries(CALL_KINDS.map((k) => [k, count])));
const errorsByKind = shape(Object.fromEntries(ERROR_KINDS.map((k) => [k, count])));

// worker.mjs metrics(): spread into sample, load-end and post-rest; nested as the header's
// baseline.
const METRICS = {
  pid: positive,
  memory: shape({
    rss: count,
    heapTotal: count,
    heapUsed: count,
    external: count,
    arrayBuffers: count,
  }),
  heapStatistics: shape(Object.fromEntries(HEAP_STATISTICS.map((k) => [k, count]))),
  agents: shape({
    total: count,
    subscriptionCount: count,
    byLifecycle: shape({ running: count, idle: count }),
    withActiveForegroundTurn: count,
    timelineStats: shape({ totalItems: count, maxItemsPerAgent: count }),
  }),
  resident: count,
  retainedParentStates: count,
  retainedRows: count,
  handles: mapOf(count),
};

const COUNTERS = {
  calls: count,
  byKind,
  streamChunks: count,
  streamErrors: count,
  rpcErrors: count,
  workerDeaths: count,
};

const logged = (stage, fields) => ({ time, stage: oneOf([stage]), ...fields });

// One schema per record type soak.mjs writes. load-end has two forms: with the load-end sample
// (the worker alive) or without it (the sample failed, as after the control's abort).
export const SCHEMAS = {
  baseline: [
    logged("baseline", {
      root: name,
      port,
      label: orNull(name),
      control: flag,
      boundaryCopy: flag,
      readStreaming: flag,
      fixture: shape({
        agents: count,
        running: count,
        idle: count,
        seededRows: count,
        rowBytes: count,
        persistentClients: count,
        subscribedClients: count,
        streamingAgents: count,
      }),
      protocol: shape({
        seconds: positive,
        restSeconds: count,
        connectionsPerMinute: positive,
        messageSeconds: positive,
        mix: byKind,
      }),
      workerHeapBoundBytes: positive,
      heapSizeLimitBytes: positive,
      baseline: shape(METRICS),
    }),
  ],
  sample: [
    logged("sample", {
      elapsed: seconds,
      ...COUNTERS,
      minutes: count,
      errorsByKind,
      ...METRICS,
    }),
  ],
  minute: [
    logged("minute", {
      index: minuteIndex,
      elapsedStart: seconds,
      elapsedEnd: seconds,
      byKind,
      calls: count,
    }),
  ],
  "rpc-error": [logged("rpc-error", { elapsed: seconds, kind: oneOf(ERROR_KINDS), message: text })],
  "worker-exit": [
    logged("worker-exit", {
      elapsed: seconds,
      code: orNull(count),
      signal: orNull(name),
      stopping: flag,
      oom: flag,
      reason,
    }),
  ],
  "load-end": [
    logged("load-end", { elapsed: seconds, ...COUNTERS, minutes: count, errorsByKind, ...METRICS }),
    logged("load-end", { elapsed: seconds, ...COUNTERS, minutes: count }),
  ],
  "post-rest": [logged("post-rest", { elapsed: seconds, ...COUNTERS, ...METRICS })],
  snapshot: [logged("snapshot", { file: orNull(text) })],
  cleanup: [logged("cleanup", { root: name, removed: flag, ...COUNTERS })],
};

// --- Structural check ----------------------------------------------------------------------

function fieldViolations(value, rule, path, out) {
  if (typeof rule === "function") {
    const want = rule(value);
    if (want) out.push(`${path} must be ${want} (got ${JSON.stringify(value)})`);
    return;
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    out.push(`${path} must be an object (got ${JSON.stringify(value)})`);
    return;
  }
  if (rule.values) {
    for (const [k, v] of Object.entries(value))
      fieldViolations(v, rule.values, `${path}.${k}`, out);
    return;
  }
  objectViolations(value, rule.fields, path, out);
}

function objectViolations(value, fields, path, out) {
  const prefix = path ? `${path}.` : "";
  for (const [k, rule] of Object.entries(fields)) {
    if (!(k in value)) out.push(`${prefix}${k} is missing`);
    else fieldViolations(value[k], rule, `${prefix}${k}`, out);
  }
  for (const k of Object.keys(value)) {
    if (!(k in fields)) out.push(`${prefix}${k} is not a field of this record type`);
  }
}

// --- Intra-record invariants ---------------------------------------------------------------

const sum = (o, keys) => keys.reduce((n, k) => n + o[k], 0);

function metricsInvariants(m, path) {
  const out = [];
  const p = path ? `${path}.` : "";
  const a = m.agents;
  const { running, idle } = a.byLifecycle;
  if (a.total !== running + idle)
    out.push(`${p}agents.total ${a.total} != running ${running} + idle ${idle}`);
  if (a.total !== FIXTURE_AGENTS)
    out.push(`${p}agents.total ${a.total} != the fixture's ${FIXTURE_AGENTS}`);
  if (m.resident !== a.total) out.push(`${p}resident ${m.resident} != agents.total ${a.total}`);
  if (a.withActiveForegroundTurn > a.total)
    out.push(`${p}agents.withActiveForegroundTurn exceeds agents.total`);
  if (a.timelineStats.maxItemsPerAgent > a.timelineStats.totalItems)
    out.push(`${p}agents.timelineStats.maxItemsPerAgent exceeds totalItems`);
  if (m.memory.heapUsed > m.memory.heapTotal) out.push(`${p}memory.heapUsed exceeds heapTotal`);
  const h = m.heapStatistics;
  if (h.used_heap_size > h.total_heap_size)
    out.push(`${p}heapStatistics.used_heap_size exceeds total_heap_size`);
  if (h.does_zap_garbage > 1) out.push(`${p}heapStatistics.does_zap_garbage is not 0 or 1`);
  return out;
}

function counterInvariants(r) {
  const out = [];
  if (sum(r.byKind, CALL_KINDS) !== r.calls)
    out.push(`byKind sums to ${sum(r.byKind, CALL_KINDS)}, not calls ${r.calls}`);
  if (r.errorsByKind) {
    if (sum(r.errorsByKind, ERROR_KINDS) !== r.rpcErrors)
      out.push(
        `errorsByKind sums to ${sum(r.errorsByKind, ERROR_KINDS)}, not rpcErrors ${r.rpcErrors}`,
      );
    if (r.errorsByKind.stream !== r.streamErrors)
      out.push(`errorsByKind.stream ${r.errorsByKind.stream} != streamErrors ${r.streamErrors}`);
  }
  if (r.streamErrors > r.rpcErrors) out.push("streamErrors exceeds rpcErrors");
  return out;
}

function headerInvariants(h) {
  const out = metricsInvariants(h.baseline, "baseline");
  const limit = h.baseline.heapStatistics.heap_size_limit;
  if (h.heapSizeLimitBytes !== limit)
    out.push(
      `heapSizeLimitBytes ${h.heapSizeLimitBytes} != baseline.heapStatistics.heap_size_limit ${limit}`,
    );
  const f = h.fixture;
  if (f.running + f.idle !== f.agents)
    out.push(`fixture.running ${f.running} + idle ${f.idle} != fixture.agents ${f.agents}`);
  const mixTotal = sum(h.protocol.mix, CALL_KINDS);
  if (mixTotal !== h.protocol.connectionsPerMinute)
    out.push(
      `protocol.mix sums to ${mixTotal}, not connectionsPerMinute ${h.protocol.connectionsPerMinute}`,
    );
  return out;
}

function invariants(r) {
  switch (r.stage) {
    case "baseline":
      return headerInvariants(r);
    case "minute": {
      const out = counterInvariants({ ...r, streamErrors: 0, rpcErrors: 0 });
      if (r.elapsedEnd < r.elapsedStart) out.push("elapsedEnd precedes elapsedStart");
      return out;
    }
    case "worker-exit": {
      const out = [];
      if ((r.code === null) === (r.signal === null))
        out.push("exactly one of code and signal must be set");
      if (r.oom !== (r.reason !== null)) out.push("oom must be true exactly when reason is set");
      return out;
    }
    case "sample":
    case "load-end":
    case "post-rest":
      return [...counterInvariants(r), ...(r.memory ? metricsInvariants(r, "") : [])];
    case "cleanup":
      return counterInvariants(r);
    default:
      return [];
  }
}

// The record's violations under the closest of its type's schemas (none when one fits).
function recordViolations(r) {
  if (r === null || typeof r !== "object" || Array.isArray(r) || r.stage === "unparseable")
    return ["not a JSON object"];
  const schemas = SCHEMAS[r.stage];
  if (!schemas) return [`unknown record type ${JSON.stringify(r.stage)}`];
  let best = null;
  for (const fields of schemas) {
    const out = [];
    objectViolations(r, fields, "", out);
    if (out.length === 0) return invariants(r);
    if (best === null || out.length < best.length) best = out;
  }
  return best;
}

// --- Run identity: one worker, one heap limit, one home --------------------------------------

function identityViolations(records) {
  const header = records.find((r) => r?.stage === "baseline");
  if (!header) return [];
  const out = [];
  records.forEach((r, i) => {
    if (r === header || !r?.memory) return;
    if (r.pid !== header.baseline.pid)
      out.push(
        `record ${i + 1} (${r.stage}): pid ${r.pid} != the baseline worker's ${header.baseline.pid}`,
      );
    const limit = r.heapStatistics.heap_size_limit;
    if (limit !== header.heapSizeLimitBytes)
      out.push(
        `record ${i + 1} (${r.stage}): heap_size_limit ${limit} != the header's ${header.heapSizeLimitBytes}`,
      );
  });
  for (const [i, r] of records.entries()) {
    if (r?.stage === "cleanup" && r.root !== header.root)
      out.push(`record ${i + 1} (cleanup): root ${r.root} != the header's ${header.root}`);
  }
  return out;
}

const MAX_LISTED = 20;

// Every schema violation in the run, as "record N (stage): rule"; empty when the run conforms.
export function validateRun(records) {
  const violations = [];
  records.forEach((r, i) => {
    for (const v of recordViolations(r))
      violations.push(`record ${i + 1} (${r?.stage ?? "?"}): ${v}`);
  });
  if (violations.length === 0) violations.push(...identityViolations(records));
  if (violations.length <= MAX_LISTED) return violations;
  return [
    ...violations.slice(0, MAX_LISTED),
    `... and ${violations.length - MAX_LISTED} more schema violation(s)`,
  ];
}
