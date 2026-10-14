#!/usr/bin/env node
// scripts/heap-soak/soak.mjs
//
// The H1 soak harness for P-000269: four hours of leaking load on a throwaway daemon of the
// package under test, then five minutes without churn. Ported from the advisor's executable
// harness (paseo-leak-advisor.md section 3); the fixture and load are fixed by P-000269 H1 and
// must not drift. analyze.mjs judges the run from the JSONL this writes.
//
// This process is the load driver; worker.mjs is the daemon under test. Every stdout line is a
// JSON record. Diagnostics go to stderr.
//
// Protocol (P-000269 H1):
//   Fixture  15 resident agents, 7 running and 8 idle, 10,900 seeded rows of ~2 KiB,
//            13 persistent clients (2 subscribed).
//   Load     7 running agents stream through the real Claude TimelineAssembler, alternating
//            assistant/reasoning, in 64-byte chunks, one 128 KiB message per agent per 30 min;
//            27 short-lived connections a minute — 15 full-history logs reads, 9 inspect,
//            2 ls, 1 send to an idle agent.
//   Runs     reads over the 8 idle agents (default) and over all 15 (--read-streaming-agents).
//   Sampling every 30 s, forced GC, heapUsed with cumulative counts by call kind, RPC errors,
//            streaming failures and worker deaths; the baseline is sampled after seeding and
//            before load.
//
// Minutes are wall-clock buckets (index = floor(elapsed/60)), each emitted with its window, so a
// stretched or missing minute is visible in the record. Every RPC failure — a call or a stream
// chunk — is counted and logged. A worker exit is recorded as a `worker-exit` line with its
// signal and, when the stderr shows it, the heap-limit abort.
//
// Options:
//   --seconds <n>            load seconds (default 14400, four hours)
//   --rest-seconds <n>       rest without churn after the load (default 300)
//   --connections-per-minute <n>  default 27
//   --message-seconds <n>    one 128 KiB message per agent per this many seconds (default 1800)
//   --row-bytes <n>          bytes of text per seeded row (default 2048)
//   --read-streaming-agents  spread reads uniformly over all 15 agents, not just the 8 idle
//   --control                mark this as the unfixed-build control run
//   --label <text>           identity label recorded in the baseline (commit / package set)
//   --snapshot               write a heap snapshot at the end
//   --boundary-copy          DIAGNOSTICS ONLY: reattach each streamed suffix to a fresh string.
//                            This is the advisor's control, never a release-qualification run.

import fs from "node:fs";
import cp from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const dir = fileURLToPath(new URL(".", import.meta.url));
const base = process.env.PASEO_DIAGNOSTIC_MODULES || "/opt/gh-runners/node-global/lib/node_modules";
const opt = (n) => {
  const i = process.argv.indexOf(n);
  return i < 0 ? undefined : process.argv[i + 1];
};
const flag = (n) => process.argv.includes(n);

const seconds = Number(opt("--seconds") || 14400);
const restSeconds = Number(opt("--rest-seconds") || 300);
const period = Number(opt("--message-seconds") || 1800);
const rate = Number(opt("--connections-per-minute") || 27);
const rowBytes = Number(opt("--row-bytes") || 2048);
const control = flag("--control");
const boundaryCopy = flag("--boundary-copy");
const readStreaming = flag("--read-streaming-agents");
const label = opt("--label") || null;
const MAX_OLD_SPACE_MIB = 768;

const req = createRequire(base + "/@getpaseo/server/package.json");
const WS = req("ws");
const { DaemonClient } = await import(base + "/@getpaseo/client/dist/daemon-client.js");

const root = fs.mkdtempSync("/tmp/paseo-heap-soak-");
fs.mkdirSync(root + "/tmp");

const logger = (stage, data) =>
  process.stdout.write(JSON.stringify({ time: new Date().toISOString(), stage, ...data }) + "\n");
const warn = (msg) => process.stderr.write(`[soak] ${msg}\n`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const child = cp.fork(dir + "worker.mjs", [root], {
  execArgv: ["--expose-gc", `--max-old-space-size=${MAX_OLD_SPACE_MIB}`],
  env: {
    PATH: "/usr/bin:/bin",
    TMPDIR: root + "/tmp",
    PASEO_HOME: root + "/home",
    PASEO_DIAGNOSTIC_MODULES: base,
  },
  stdio: ["ignore", "inherit", "pipe", "ipc"],
});

// The worker's own stderr carries the V8 OOM banner when it aborts. Keep it (for the run.err file
// and the heap-limit evidence), and forward it so nothing is lost.
let workerStderr = "";
const HEAP_LIMIT_RE = /Reached heap limit|heap out of memory|Allocation failed/i;
child.stderr.on("data", (d) => {
  workerStderr += d.toString();
  process.stderr.write(d);
});

const pending = new Map();
let seq = 0;
let workerDeaths = 0;
let workerDead = false;
let stopping = false;
let loadStartMs = null;
const elapsedNow = () => (loadStartMs === null ? 0 : (Date.now() - loadStartMs) / 1000);

child.on("error", () => {}); // a dead worker's IPC errors are reported through workerDeaths
child.on("exit", (code, signal) => {
  workerDead = true;
  if (!stopping) workerDeaths++;
  const reason = HEAP_LIMIT_RE.exec(workerStderr)?.[0] ?? null;
  logger("worker-exit", {
    elapsed: elapsedNow(),
    code,
    signal,
    stopping,
    oom: reason !== null,
    reason,
  });
  for (const p of pending.values()) p.reject(new Error("worker exit " + code));
  pending.clear();
});

const ready = await new Promise((res, rej) => {
  child.on("message", (m) => {
    if (!m.ready) {
      const p = pending.get(m.id);
      if (p) {
        pending.delete(m.id);
        if (m.error) p.reject(new Error(m.error));
        else p.resolve(m.data);
      }
      return;
    }
    res(m);
  });
  child.once("exit", (c) => rej(new Error("worker exit " + c)));
});

const rpc = (cmd, args = {}) =>
  new Promise((resolve, reject) => {
    const id = ++seq;
    if (workerDead) return reject(new Error("worker dead"));
    pending.set(id, { resolve, reject });
    try {
      child.send({ cmd, id, ...args });
    } catch (e) {
      pending.delete(id);
      reject(e);
    }
  });

function stopWorker() {
  stopping = true;
  if (child.exitCode === null && !child.killed) {
    rpc("stop").catch(() => {});
    child.kill("SIGTERM");
  }
}
function waitForWorkerExit(timeoutMs = 15000) {
  if (child.exitCode !== null) return Promise.resolve();
  const exited = new Promise((resolve) => child.once("exit", resolve));
  const timeout = new Promise((resolve) => setTimeout(resolve, timeoutMs));
  return Promise.race([exited, timeout]);
}
function isWorkerAlive() {
  return !workerDead;
}

const clients = new Set();
async function client(id = "clid_soak_cli") {
  const c = new DaemonClient({
    url: `ws://127.0.0.1:${ready.port}/ws`,
    clientId: id,
    appVersion: "0.11.2",
    reconnect: { enabled: false },
    webSocketFactory: (url, opts) => new WS(url, opts?.protocols, { headers: opts?.headers }),
  });
  clients.add(c);
  await c.connect();
  return c;
}
async function close(c) {
  await c.close();
  clients.delete(c);
}

let baseline = null;
let maximum = 0;
let rpcErrors = 0;
let streamErrors = 0;
let streamChunks = 0;
let callsTotal = 0;
const callsByKind = { logs: 0, inspect: 0, ls: 0, send: 0 };
const errorsByKind = { logs: 0, inspect: 0, ls: 0, send: 0, stream: 0, sample: 0, other: 0 };
const samples = [];
const minutes = [];
let bucket = newBucket(0, 0);

function newBucket(index, elapsedStart) {
  return {
    index,
    elapsedStart,
    elapsedEnd: null,
    byKind: { logs: 0, inspect: 0, ls: 0, send: 0 },
    calls: 0,
  };
}
function closeBucket(elapsedEnd) {
  bucket.elapsedEnd = elapsedEnd;
  minutes.push({ ...bucket });
  logger("minute", { ...bucket });
}
// Wall-clock buckets: a call at elapsed t belongs to minute floor(t/60). A bucket closes when a
// call crosses into the next minute, or at load end for the final one. Every full minute then
// carries exactly `rate` calls, and every bucket records its own window.
function recordCall(kind, elapsed) {
  const index = Math.floor(elapsed / 60);
  while (bucket.index < index) {
    const boundary = Math.min((bucket.index + 1) * 60, elapsed);
    closeBucket(boundary);
    bucket = newBucket(bucket.index + 1, boundary);
  }
  bucket.byKind[kind]++;
  bucket.calls++;
  callsTotal++;
  callsByKind[kind]++;
}

function countError(kind, elapsed, message) {
  rpcErrors++;
  errorsByKind[kind] = (errorsByKind[kind] ?? 0) + 1;
  logger("rpc-error", { elapsed, kind, message });
}

// Classify a connection by its number in the run, so every consecutive 27 calls is the fixed mix.
function callKind(total) {
  const op = total % 27;
  if (op < 15) return "logs";
  if (op < 24) return "inspect";
  if (op < 26) return "ls";
  return "send";
}

async function runCall(kind, agents) {
  const c = await client();
  try {
    const id = readStreaming ? agents[callsTotal % 15] : agents[7 + (callsTotal % 8)];
    if (kind === "logs") {
      await c.fetchAgent(id);
      await c.fetchAgentTimeline(id, { limit: 0 });
    } else if (kind === "inspect") {
      await c.fetchAgent(id);
    } else if (kind === "ls") {
      await c.fetchAgents();
    } else {
      await c.sendMessage(agents[14], "soak canary");
    }
  } finally {
    await close(c).catch(() => {});
  }
}

// 7 running agents stream through the real assembler, one 128 KiB message per `period` seconds.
// A failed stream RPC is counted and logged; the run's counters then show it, so seven held turns
// can never stand in for seven successful streams.
async function streamAgents(agents, elapsed, streamed, cycle) {
  for (let i = 0; i < 7; i++) {
    const absolute = Math.floor((elapsed / period) * 2048);
    const targetCycle = Math.floor(absolute / 2048);
    while (cycle[i] < targetCycle) {
      if (streamed[i] < 2048) {
        const count = 2048 - streamed[i];
        const ok = await streamChunk(agents[i], streamed[i], count, i, cycle[i], elapsed, true);
        if (ok) streamChunks += count;
      }
      cycle[i]++;
      streamed[i] = 0;
    }
    const target = absolute % 2048;
    const delta = target - streamed[i];
    if (delta > 0) {
      const ok = await streamChunk(agents[i], streamed[i], delta, i, cycle[i], elapsed, false);
      if (ok) {
        streamChunks += delta;
        streamed[i] = target;
      }
    }
  }
}

async function streamChunk(agentId, start, count, i, key, elapsed, final) {
  try {
    await rpc("stream", {
      agentId,
      start,
      count,
      copy: boundaryCopy,
      kind: i % 2 ? "reasoning" : "assistant",
      key: "message-" + key,
      final,
    });
    return true;
  } catch (e) {
    streamErrors++;
    countError("stream", elapsed, e.message);
    return false;
  }
}

// Sample the forced-GC heap. Periodic samples join the series the analyzer's slope, bound and
// per-kind counts use; the load-end sample is recorded only as `load-end`. Each sample carries
// cumulative counts by call kind, streaming chunks, RPC errors and worker deaths.
async function sampleHeap(elapsed, stage) {
  const s = await rpc("gc").catch((e) => {
    countError("sample", elapsed, e.message);
    return null;
  });
  if (!s) return null;
  maximum = Math.max(maximum, s.memory.heapUsed);
  const counters = {
    calls: callsTotal,
    byKind: { ...callsByKind },
    minutes: minutes.length,
    streamChunks,
    streamErrors,
    rpcErrors,
    workerDeaths,
    errorsByKind: { ...errorsByKind },
  };
  if (stage === "sample") {
    samples.push({ elapsed, heapUsed: s.memory.heapUsed });
    logger("sample", { elapsed, ...counters, ...s });
  }
  return { ...s, ...counters };
}

try {
  const agents = [];
  for (let i = 0; i < 15; i++) {
    const a = await rpc("create", { rows: i === 0 ? 736 : 726, bytes: rowBytes });
    agents.push(a.id);
  }
  const warm = await client();
  for (let i = 0; i < 7; i++) await warm.sendMessage(agents[i], "ADVISOR_HOLD");
  await close(warm);
  for (let i = 0; i < 13; i++) {
    const c = await client("clid_soak_persistent_" + i);
    if (i < 2) {
      const a = c.observeAgents();
      await a.ready;
    }
  }

  // Fixture seeded, no load yet: this is the H1 baseline. Its heapStatistics.heap_size_limit is
  // the worker's real V8 bound, which analyze.mjs uses instead of the requested old-space size.
  baseline = await rpc("gc");
  maximum = baseline.memory.heapUsed;
  logger("baseline", {
    root,
    port: ready.port,
    label,
    control,
    boundaryCopy,
    readStreaming,
    fixture: {
      agents: agents.length,
      running: 7,
      idle: 8,
      seededRows: 736 + 726 * 14,
      rowBytes,
      persistentClients: 13,
      subscribedClients: 2,
      streamingAgents: 7,
    },
    protocol: {
      seconds,
      restSeconds,
      connectionsPerMinute: rate,
      messageSeconds: period,
      mix: { logs: 15, inspect: 9, ls: 2, send: 1 },
    },
    workerHeapBoundBytes: MAX_OLD_SPACE_MIB * 1024 ** 2,
    heapSizeLimitBytes: baseline.heapStatistics?.heap_size_limit ?? null,
    baseline,
  });

  loadStartMs = Date.now();
  let nextConnection = 0;
  let nextMeasurement = 0;
  const streamed = Array(7).fill(0);
  const cycle = Array(7).fill(0);

  while (isWorkerAlive() && Date.now() - loadStartMs < seconds * 1000) {
    const elapsed = (Date.now() - loadStartMs) / 1000;

    await streamAgents(agents, elapsed, streamed, cycle);

    if (elapsed >= nextConnection) {
      const kind = callKind(callsTotal);
      try {
        await runCall(kind, agents);
      } catch (e) {
        countError(kind, elapsed, e.message);
      } finally {
        recordCall(kind, elapsed);
      }
      nextConnection += 60 / rate;
    }

    if (elapsed >= nextMeasurement) {
      await sampleHeap(elapsed, "sample");
      nextMeasurement += 30;
    }

    await sleep(100);
  }

  const loadEndElapsed = elapsedNow();
  closeBucket(loadEndElapsed);
  const final = await sampleHeap(loadEndElapsed, "load-end");
  logger("load-end", {
    elapsed: loadEndElapsed,
    calls: callsTotal,
    byKind: { ...callsByKind },
    minutes: minutes.length,
    streamChunks,
    streamErrors,
    rpcErrors,
    workerDeaths,
    ...final,
  });

  // Rest without churn; the daemon should release temporary state.
  warn(`resting ${restSeconds}s without churn`);
  await sleep(restSeconds * 1000);
  const restSample = await rpc("gc").catch((e) => {
    countError("other", elapsedNow(), e.message);
    return null;
  });
  if (restSample) {
    maximum = Math.max(maximum, restSample.memory.heapUsed);
    logger("post-rest", {
      elapsed: elapsedNow(),
      calls: callsTotal,
      byKind: { ...callsByKind },
      streamChunks,
      streamErrors,
      rpcErrors,
      workerDeaths,
      ...restSample,
    });
  }

  if (flag("--snapshot")) {
    const path = dir + "soak-" + (boundaryCopy ? "boundary-copy" : "package") + ".heapsnapshot";
    logger("snapshot", { file: await rpc("snapshot", { path }).catch(() => null) });
  }
} finally {
  await Promise.allSettled([...clients].map((c) => c.close()));
  stopWorker();
  await waitForWorkerExit();
  fs.rmSync(root, { recursive: true, force: true });
  logger("cleanup", {
    root,
    removed: !fs.existsSync(root),
    calls: callsTotal,
    byKind: { ...callsByKind },
    streamChunks,
    streamErrors,
    rpcErrors,
    workerDeaths,
  });
}
