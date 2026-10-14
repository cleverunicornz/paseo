#!/usr/bin/env node
// scripts/heap-soak/worker.mjs
//
// The daemon-under-test for the H1 soak (P-000269). It creates a daemon in an isolated home on
// an OS-assigned loopback port, seeds the fixture, drives the real Claude TimelineAssembler and
// answers the parent's sampling commands. It never touches the console's daemon, home or port.
//
// The parent (soak.mjs) owns the load schedule; this process owns the daemon and the fixture.
// Everything below the daemon bundle comes from PASEO_DIAGNOSTIC_MODULES, an isolated module
// directory holding all seven @getpaseo workspace packages built from one commit (see README.md).

import fs from "node:fs";
import v8 from "node:v8";
import { createRequire } from "node:module";

const base =
  (process.env.PASEO_DIAGNOSTIC_MODULES || "/opt/gh-runners/node-global/lib/node_modules") +
  "/@getpaseo/server";
const req = createRequire(base + "/package.json");
const pino = req("pino");
const { createPaseoDaemon } = await import(base + "/dist/server/server/bootstrap.js");
const { BuiltinPluginLoader } = await import(base + "/dist/server/server/plugins/builtin/index.js");
const { createTestAgentClients } = await import("./fake-agent-client.mjs");

const root = process.argv[2];
fs.mkdirSync(root + "/home", { recursive: true });
fs.mkdirSync(root + "/cwd", { recursive: true });

// Hold a foreground turn open on the running agents. The daemon must believe seven agents are
// mid-turn so the streaming load lands on resident running sessions, as in production.
function controlled(session) {
  const original = session.startTurn.bind(session);
  session.startTurn = async (prompt) => {
    if (prompt !== "ADVISOR_HOLD") return original(prompt);
    const turnId = "advisor-held-turn";
    session.activeForegroundTurnId = turnId;
    const ev = { type: "turn_started", provider: session.provider, turnId };
    await session.appendHistoryEvent(ev);
    session.notifySubscribers(ev);
    return { turnId };
  };
  return session;
}
const fakeClients = createTestAgentClients();
for (const c of Object.values(fakeClients)) {
  for (const name of ["createSession", "resumeSession"]) {
    const original = c[name].bind(c);
    c[name] = async (...args) => controlled(await original(...args));
  }
}

const config = {
  listen: "127.0.0.1:0",
  paseoHome: root + "/home",
  agentStoragePath: root + "/home/agents",
  corsAllowedOrigins: [],
  hostnames: true,
  mcpEnabled: false,
  mcpDebug: false,
  relayEnabled: false,
  relayEndpoint: "relay.paseo.sh:443",
  appBaseUrl: "http://localhost",
  agentClients: fakeClients,
  pluginsEnabled: false,
  voiceLlmProvider: null,
  voiceLlmProviderExplicit: false,
  staticDir: root + "/static",
};
fs.mkdirSync(config.staticDir, { recursive: true });
const logger = pino({ level: "warn" }, pino.destination(root + "/diagnostic.log"));
const daemon = await createPaseoDaemon(config, logger, {
  builtinPlugins: new BuiltinPluginLoader(undefined, []),
});
await daemon.start();
const manager = daemon.agentManager;
const assemblers = new Map();
const { ClaudeAgentClient } = await import(
  base + "/dist/server/server/agent/providers/claude/agent.js"
);
// The real assembler from the package under test. Model execution is disabled: the load feeds
// synthetic stream events straight into timelineAssembler.consume, exactly as a real session would.
const realClaude = new ClaudeAgentClient({
  logger,
  queryFactory() {
    throw Error("Model execution disabled");
  },
  resolveBinary: async () => {
    throw Error("Model execution disabled");
  },
});

function metrics() {
  return {
    pid: process.pid,
    memory: process.memoryUsage(),
    heapStatistics: v8.getHeapStatistics(),
    agents: manager.getMetricsSnapshot?.(),
    resident: manager.listAgents().length,
    retainedParentStates: manager.timelineStore.states.size,
    retainedRows: [...manager.timelineStore.states.values()].reduce(
      (n, s) => n + s.projection.rows.length,
      0,
    ),
    handles: process.getActiveResourcesInfo().reduce((counts, k) => {
      counts[k] = (counts[k] || 0) + 1;
      return counts;
    }, {}),
  };
}

// Three passes with a macrotask between: enough for the generational GC to release everything a
// plain gc() would collect, so the sample is a settled post-GC heap.
async function sampleGc() {
  for (let i = 0; i < 3; i++) {
    global.gc();
    await new Promise((r) => setImmediate(r));
  }
  return metrics();
}

async function assemblerFor(agentId) {
  const existing = assemblers.get(agentId);
  if (existing) return existing;
  const session = await realClaude.createSession({ provider: "claude", cwd: root + "/cwd" });
  assemblers.set(agentId, session.timelineAssembler);
  return session.timelineAssembler;
}

async function stream(msg) {
  const a = await assemblerFor(msg.agentId);
  const session = manager.getAgent(msg.agentId).session;
  for (let i = msg.start; i < msg.start + msg.count; i++) {
    const text = String(i).padStart(8, "0") + "x".repeat(56);
    const delta =
      msg.kind === "reasoning"
        ? { type: "thinking_delta", thinking: text }
        : { type: "text_delta", text };
    const message = { type: "stream_event", event: { type: "content_block_delta", delta } };
    for (let item of a.consume({
      message,
      runId: "fixture",
      messageIdHint: msg.key || "fixture-message",
    })) {
      // Diagnostic-only boundary experiment (--boundary-copy): reattach each emitted suffix to a
      // fresh string. It reproduces the advisor's control and must never be used for a
      // release-qualification run.
      if (msg.copy) item = { ...item, text: Buffer.from(item.text, "utf16le").toString("utf16le") };
      session.notifySubscribers({ type: "timeline", provider: "claude", item });
    }
    await manager.drainSessionEvents(msg.agentId);
  }
  manager.agentStreamCoalescer.flushFor(msg.agentId);
  if (msg.final) {
    a.consume({
      message: { type: "stream_event", event: { type: "message_stop" } },
      runId: "fixture",
      messageIdHint: msg.key || "fixture-message",
    });
    assemblers.delete(msg.agentId);
  }
  return { streamed: msg.count };
}

async function state(msg) {
  const a = manager.getAgent(msg.agentId);
  const r = await daemon.agentStorage.get(msg.agentId);
  return {
    runtime: a
      ? {
          id: a.id,
          lifecycle: a.lifecycle,
          activeForegroundTurnId: a.activeForegroundTurnId,
          persistence: a.persistence,
        }
      : null,
    stored: r ? { id: r.id, lastStatus: r.lastStatus, persistence: r.persistence } : null,
  };
}

async function create(msg) {
  const data = await manager.createAgent(
    { provider: "claude", cwd: root + "/cwd", modeId: "bypassPermissions" },
    msg.agentId,
    { env: {} },
  );
  if (msg.rows) {
    manager.timelineStore.initialize(data.id, {
      items: Array.from({ length: msg.rows }, (_, i) => ({
        type: "user_message",
        text: String(i) + " " + Buffer.alloc(msg.bytes || 512, i % 251).toString("latin1"),
        clientMessageId: "fixture-" + i,
      })),
    });
  }
  return data;
}

async function handle(msg) {
  switch (msg.cmd) {
    case "gc":
      return sampleGc();
    case "stream":
      return stream(msg);
    case "state":
      return state(msg);
    case "snapshot":
      global.gc();
      return v8.writeHeapSnapshot(msg.path);
    case "create":
      return create(msg);
    case "discard":
      manager.discardRetainedAgentState(msg.agentId);
      return metrics();
    case "timeline":
      return { rows: manager.fetchTimeline(msg.agentId, { limit: 80 }).rows.length };
    case "close":
      await manager.closeAgent(msg.agentId);
      return {
        resident: manager.listAgents().length,
        retained: manager.timelineStore.has(msg.agentId),
      };
    case "stop":
      await daemon.stop();
      process.send({ id: msg.id, data: "stopped" });
      process.exit(0);
      return undefined;
    default:
      throw new Error("unknown command " + msg.cmd);
  }
}

process.send({ ready: true, port: daemon.getListenTarget().port, ...metrics() });

process.on("message", async (msg) => {
  try {
    process.send({ id: msg.id, data: await handle(msg) });
  } catch (e) {
    process.send({ id: msg.id, error: e.stack });
  }
});
