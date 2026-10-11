import http from "node:http";
import type net from "node:net";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import pino from "pino";
import { ClaudeAgentClient } from "../agent/providers/claude/agent.js";
import { DEFAULT_SESSION_RUNTIME_CONFIG } from "../session-runtime-config.js";
import { claudeQueryReportingModel } from "../test-utils/claude-model-report-query.js";
import { DaemonClient } from "../test-utils/daemon-client.js";
import { createTestAgentClients } from "../test-utils/fake-agent-client.js";
import { createTestPaseoDaemon, type TestPaseoDaemon } from "../test-utils/paseo-daemon.js";

interface RecordedRequest {
  method: string | undefined;
  headers: http.IncomingHttpHeaders;
  /** Whether the backend was answering 503 when the request arrived. */
  down: boolean;
}

interface FixtureBackend {
  server: http.Server;
  recorded: RecordedRequest[];
  /** `record` calls the backend accepted, with the identity it saw. */
  received: Array<{ agentId: string; seq: number }>;
  down: boolean;
}

/**
 * A stateless MCP backend. `whoami` answers with the agent identity the
 * gateway attached; `record` keeps a timeline item. While `down`, it answers
 * every request with 503.
 */
function startFixtureBackend(): Promise<FixtureBackend> {
  const fixture: FixtureBackend = {
    server: http.createServer(),
    recorded: [],
    received: [],
    down: false,
  };
  fixture.server.on("request", (req, res) => {
    void (async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const raw = Buffer.concat(chunks).toString("utf8");
      const body = raw ? (JSON.parse(raw) as { method?: string }) : undefined;
      fixture.recorded.push({ method: body?.method, headers: req.headers, down: fixture.down });
      if (fixture.down) {
        res.writeHead(503).end("backend unavailable");
        return;
      }
      const agentId = String(req.headers["x-paseo-agent-id"]);
      const mcp = new McpServer({ name: "fixture", version: "1.0.0" });
      mcp.registerTool("whoami", { inputSchema: {} }, async () => ({
        content: [{ type: "text", text: agentId }],
      }));
      mcp.registerTool("record", { inputSchema: { seq: z.number() } }, async ({ seq }) => {
        fixture.received.push({ agentId, seq });
        return { content: [{ type: "text", text: `recorded ${seq}` }] };
      });
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      res.on("close", () => {
        void transport.close();
        void mcp.close();
      });
      await mcp.connect(transport);
      await transport.handleRequest(req, res, body);
    })();
  });
  return new Promise((resolve) => fixture.server.listen(0, "127.0.0.1", () => resolve(fixture)));
}

let backend: FixtureBackend;
let daemon: TestPaseoDaemon | null;
let directory: string;

async function startDaemon(
  options: Parameters<typeof createTestPaseoDaemon>[0] = {},
): Promise<TestPaseoDaemon> {
  const backendPort = (backend.server.address() as net.AddressInfo).port;
  daemon = await createTestPaseoDaemon({
    daemonVersion: "0.8.0",
    mcpGatewayBackends: { memory: { url: `http://127.0.0.1:${backendPort}/mcp` } },
    ...options,
  });
  return daemon;
}

/** Shuts the daemon down the way its worker does, and removes its files. */
async function shutDown(running: TestPaseoDaemon) {
  daemon = null;
  try {
    return await running.daemon.stop();
  } finally {
    await rm(path.dirname(running.paseoHome), { recursive: true, force: true });
    await rm(running.staticDir, { recursive: true, force: true });
  }
}

async function connectClient(running: TestPaseoDaemon): Promise<DaemonClient> {
  const client = new DaemonClient({
    url: `ws://127.0.0.1:${running.port}/ws`,
    appVersion: "0.8.0",
  });
  await client.connect();
  return client;
}

async function readLogged(): Promise<Array<Record<string, unknown>>> {
  const text = await readFile(path.join(directory, "events.log"), "utf8").catch(() => "");
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

const IDENTITY_HEADERS = [
  "x-paseo-agent-id",
  "x-paseo-session-id",
  "x-paseo-workspace-id",
  "x-paseo-server-id",
  "x-recorder-hook",
] as const;

function identityOf(request: RecordedRequest): Record<string, unknown> {
  return Object.fromEntries(IDENTITY_HEADERS.map((name) => [name, request.headers[name]]));
}

beforeEach(async () => {
  daemon = null;
  backend = await startFixtureBackend();
  directory = await mkdtemp(path.join(tmpdir(), "paseo-plugin-gateway-"));
});

afterEach(async () => {
  await daemon?.close();
  backend.server.closeAllConnections();
  await new Promise<void>((resolve) => backend.server.close(() => resolve()));
  await rm(directory, { recursive: true, force: true });
});

test("a plugin calls a gateway backend as an agent, through the agent's hook and headers, without its token", async () => {
  const running = await startDaemon();
  const events = JSON.stringify(path.join(directory, "events.log"));
  await writeFile(
    path.join(directory, "paseo-plugin.json"),
    JSON.stringify({ id: "recorder", requirements: { paseo: ">=0.8.0" } }),
  );
  await writeFile(
    path.join(directory, "index.server.ts"),
    `
import { appendFileSync } from "node:fs";
const log = (value) => appendFileSync(${events}, JSON.stringify(value) + "\\n");
export default function contribute(server) {
  server.before("mcp_gateway.upstream", ({ request }) => ({
    ...request,
    headers: { ...request.headers, "x-recorder-hook": request.agentId },
  }));
  server.on("agent.created", async (event) => {
    log({ keys: Object.keys(server.mcp) });
    try {
      log({ result: await server.mcp.callTool({ backend: "memory", tool: "whoami", onBehalfOf: event.agent.id }) });
    } catch (error) {
      log({ error: String(error) });
    }
    try {
      await server.mcp.callTool({ backend: "memory", tool: "whoami", onBehalfOf: "no-such-agent" });
      log({ unknownAgent: "accepted" });
    } catch (error) {
      log({ unknownAgent: String(error) });
    }
  });
  return () => {};
}
`,
  );
  const client = await connectClient(running);
  try {
    await client.patchDaemonConfig({ pluginsEnabled: true });
    await client.installDirectoryPlugin(directory);
    const agent = await client.createAgent({
      provider: "codex",
      cwd: directory,
      title: "Called for",
    });

    await expect
      .poll(async () => (await readLogged()).some((entry) => "unknownAgent" in entry))
      .toBe(true);
    const text = await readFile(path.join(directory, "events.log"), "utf8");

    expect(await readLogged()).toEqual([
      { keys: ["callTool"] },
      { result: { content: [{ type: "text", text: agent.id }] } },
      { unknownAgent: expect.stringContaining("No live agent no-such-agent") },
    ]);
    const toolCall = backend.recorded.find((request) => request.method === "tools/call");
    expect(toolCall?.headers).toMatchObject({
      "x-paseo-agent-id": agent.id,
      "x-paseo-server-id": expect.any(String),
      "x-recorder-hook": agent.id,
    });
    expect(toolCall?.headers.authorization).toBeUndefined();
    // Nothing the plugin saw, and nothing the backend saw, carries the agent's token.
    const token = running.daemon.agentManager.issueAgentToken(agent.id);
    expect(text).not.toContain(token);
    expect(JSON.stringify(backend.recorded)).not.toContain(token);
  } finally {
    await client.close();
  }
});

/**
 * A recorder that sends every timeline item to the `memory` backend on behalf
 * of its agent. `onFailure` runs when a send fails: it either holds the item
 * for its stop-readiness drain, or throws so the daemon offers it again.
 * Its drain also tries a call for the agent named in `closed-agent.txt` and
 * for an agent that never existed, and logs what happened.
 */
async function writeHoldingRecorder(onFailure: "hold" | "throw"): Promise<void> {
  const file = (name: string) => JSON.stringify(path.join(directory, name));
  await writeFile(
    path.join(directory, "paseo-plugin.json"),
    JSON.stringify({ id: "recorder", requirements: { paseo: ">=0.8.0" } }),
  );
  await writeFile(
    path.join(directory, "index.server.ts"),
    `
import { appendFileSync, readFileSync } from "node:fs";
const log = (value) => appendFileSync(${file("events.log")}, JSON.stringify(value) + "\\n");
const held = [];
export default function contribute(server) {
  server.before("mcp_gateway.upstream", ({ request }) => ({
    ...request,
    headers: { ...request.headers, "x-recorder-hook": request.agentId },
  }));
  const send = (agentId, seq) =>
    server.mcp.callTool({ backend: "memory", tool: "record", arguments: { seq }, onBehalfOf: agentId });
  server.on("agent.timeline_item", async (event) => {
    try {
      await send(event.agent.id, event.seq);
      log({ sent: event.seq });
    } catch (error) {
      log({ failed: event.seq, error: String(error) });
      if (${JSON.stringify(onFailure)} === "throw") throw error;
      held.push({ agentId: event.agent.id, seq: event.seq });
    }
  });
  server.registerStopReadiness({
    readiness: () => ({
      ready: false,
      timeline: { ready: false, epoch: null, emitted_through: null, acknowledged_through: null },
      wip: { ready: false },
    }),
    drain: async () => {
      for (const agentId of [readFileSync(${file("closed-agent.txt")}, "utf8"), "never-known"]) {
        try {
          await send(agentId, -1);
          log({ calledFor: agentId, accepted: true });
        } catch (error) {
          log({ calledFor: agentId, refused: String(error) });
        }
      }
      while (held.length > 0) {
        await send(held[0].agentId, held[0].seq);
        log({ flushed: held.shift().seq });
      }
    },
  });
  return () => log({ cleanup: true });
}
`,
  );
}

function seqsIn(ranges: ReadonlyArray<{ startSeq: number; endSeq: number }>): number[] {
  return ranges.flatMap((range) =>
    Array.from({ length: range.endSeq - range.startSeq + 1 }, (_, index) => range.startSeq + index),
  );
}

/**
 * Closes one agent before shutdown, then runs a turn on another while the
 * backend is down, so every item of that turn failed its first send.
 */
async function runTurnWhileBackendDown(running: TestPaseoDaemon) {
  const client = await connectClient(running);
  try {
    await client.fetchAgents({ subscribe: {} });
    // Closed before shutdown, and before the recorder could see any of its items.
    const closedEarly = await client.createAgent({
      provider: "codex",
      cwd: directory,
      title: "Early",
    });
    await running.daemon.agentManager.closeAgent(closedEarly.id);
    await writeFile(path.join(directory, "closed-agent.txt"), closedEarly.id);

    await client.patchDaemonConfig({ pluginsEnabled: true });
    await client.installDirectoryPlugin(directory);
    backend.down = true;
    const agent = await client.createAgent({
      provider: "codex",
      cwd: directory,
      title: "Recorded",
    });
    await client.sendMessage(agent.id, "hello");
    await client.waitForFinish(agent.id, 10_000);
    const timeline = await client.fetchAgentTimeline(agent.id, {
      projection: "canonical",
      direction: "tail",
      limit: 0,
    });
    const seqs = timeline.entries.flatMap((entry) => seqsIn(entry.sourceSeqRanges));
    expect(seqs.length).toBeGreaterThan(0);
    await expect
      .poll(async () => (await readLogged()).filter((entry) => "failed" in entry).length)
      .toBe(seqs.length);
    return { agentId: agent.id, closedEarlyId: closedEarly.id, seqs };
  } finally {
    await client.close();
  }
}

async function expectDrainSentEverythingAsTheAgent(input: {
  agentId: string;
  closedEarlyId: string;
  seqs: number[];
  logged: Array<Record<string, unknown>>;
}) {
  const { agentId, closedEarlyId, seqs, logged } = input;
  // The backend has every held item, called for the agent that the shutdown closed.
  expect(backend.received.map((entry) => entry.seq).sort((a, b) => a - b)).toEqual(
    [...seqs].sort((a, b) => a - b),
  );
  expect(new Set(backend.received.map((entry) => entry.agentId))).toEqual(new Set([agentId]));
  // The drain's calls carry the same identity, through the same hook, as the agent's live calls.
  const liveCall = backend.recorded.find((request) => request.down);
  const drainCalls = backend.recorded.filter(
    (request) => !request.down && request.method === "tools/call",
  );
  expect(liveCall).toBeDefined();
  expect(identityOf(liveCall as RecordedRequest)).toMatchObject({
    "x-paseo-agent-id": agentId,
    "x-paseo-server-id": expect.any(String),
    "x-recorder-hook": agentId,
  });
  expect(drainCalls.length).toBeGreaterThanOrEqual(seqs.length);
  for (const call of drainCalls) {
    expect(identityOf(call)).toEqual(identityOf(liveCall as RecordedRequest));
    expect(call.headers.authorization).toBeUndefined();
  }
  // An agent closed before shutdown, and one never known, are refused during the drain.
  expect(logged).toContainEqual({
    calledFor: closedEarlyId,
    refused: expect.stringContaining(`No live agent ${closedEarlyId}`),
  });
  expect(logged).toContainEqual({
    calledFor: "never-known",
    refused: expect.stringContaining("No live agent never-known"),
  });
  expect(backend.received.some((entry) => entry.agentId === closedEarlyId)).toBe(false);
}

test("during the shutdown drain, a recorder sends the items it held through callTool for the agent the shutdown closed", async () => {
  await writeHoldingRecorder("hold");
  const running = await startDaemon({
    sessionRuntime: { timelineDrainMs: 30_000, singleAgent: false, webBasePath: "/" },
  });
  const { agentId, closedEarlyId, seqs } = await runTurnWhileBackendDown(running);
  backend.down = false;

  const result = await shutDown(running);

  const logged = await readLogged();
  expect(result.timelineDrain).toEqual({ status: "drained" });
  expect(logged.filter((entry) => "flushed" in entry)).toHaveLength(seqs.length);
  await expectDrainSentEverythingAsTheAgent({ agentId, closedEarlyId, seqs, logged });
}, 60_000);

test("items whose send failed are offered again at the shutdown drain and reach the backend as the closed agent", async () => {
  await writeHoldingRecorder("throw");
  const running = await startDaemon({
    sessionRuntime: { timelineDrainMs: 30_000, singleAgent: false, webBasePath: "/" },
  });
  const { agentId, closedEarlyId, seqs } = await runTurnWhileBackendDown(running);
  backend.down = false;

  const result = await shutDown(running);

  const logged = await readLogged();
  expect(result.timelineDrain).toEqual({ status: "drained" });
  expect(
    logged
      .filter((entry) => "sent" in entry)
      .map((entry) => entry.sent as number)
      .sort((a, b) => a - b),
  ).toEqual([...seqs].sort((a, b) => a - b));
  await expectDrainSentEverythingAsTheAgent({ agentId, closedEarlyId, seqs, logged });
}, 60_000);

const SONNET_REFUSAL =
  "This session's member is claude/claude-opus-5-5. This agent would run claude/claude-sonnet-5-5. A different model needs a new session.";

/**
 * A plugin whose `agent.closed` hook calls the `memory` backend for the agent
 * that closed, and whose stop-readiness drain calls again for the agent named
 * in `refused-agent.txt`. Its upstream hook logs every agent it ran for.
 */
async function writeClosedHookCaller(): Promise<void> {
  const file = (name: string) => JSON.stringify(path.join(directory, name));
  await writeFile(
    path.join(directory, "paseo-plugin.json"),
    JSON.stringify({ id: "closed-hook", requirements: { paseo: ">=0.8.0" } }),
  );
  await writeFile(
    path.join(directory, "index.server.ts"),
    `
import { appendFileSync, readFileSync } from "node:fs";
const log = (value) => appendFileSync(${file("events.log")}, JSON.stringify(value) + "\\n");
const whoami = (agentId) =>
  server.mcp.callTool({ backend: "memory", tool: "whoami", onBehalfOf: agentId });
let server;
export default function contribute(context) {
  server = context;
  server.before("mcp_gateway.upstream", ({ request }) => {
    log({ upstreamHookFor: request.agentId });
    return request;
  });
  server.on("agent.closed", async (event) => {
    try {
      await whoami(event.agent.id);
      log({ closedHookCalledFor: event.agent.id, accepted: true });
    } catch (error) {
      log({ closedHookCalledFor: event.agent.id, refused: String(error) });
    }
  });
  server.registerStopReadiness({
    readiness: () => ({
      ready: false,
      timeline: { ready: false, epoch: null, emitted_through: null, acknowledged_through: null },
      wip: { ready: false },
    }),
    drain: async () => {
      const agentId = readFileSync(${file("refused-agent.txt")}, "utf8");
      try {
        await whoami(agentId);
        log({ drainCalledFor: agentId, accepted: true });
      } catch (error) {
        log({ drainCalledFor: agentId, refused: String(error) });
      }
    },
  });
  return () => {};
}
`,
  );
}

// What the hook cannot do is reach the gateway as the refused agent. A plugin can still resume
// the agent through its Paseo API; the resumed session runs the member it launches with and is
// judged anew on what its runtime reports (agent-manager.ts, sessionMemberRefusals).
test("a refused agent's agent.closed hook gets no gateway identity for it and the gateway forwards nothing for it", async () => {
  await writeClosedHookCaller();
  // Claude Code reports Sonnet whatever it was launched with; the session's member is Opus.
  const launches: string[] = [];
  const claude = new ClaudeAgentClient({
    logger: pino({ level: "silent" }),
    resolveBinary: async () => "/fixture/claude",
    queryFactory: claudeQueryReportingModel("claude-sonnet-5-5", launches) as never,
  });
  const agentClients = createTestAgentClients();
  agentClients.claude!.createSession = claude.createSession.bind(claude);
  const running = await startDaemon({
    agentClients,
    sessionRuntime: {
      ...DEFAULT_SESSION_RUNTIME_CONFIG,
      timelineDrainMs: 30_000,
      identity: { member: "claude/claude-opus-5-5", role: "implementer" },
    },
  });
  const manager = running.daemon.agentManager;
  const callGateway = (token: string) =>
    fetch(`http://127.0.0.1:${running.port}/mcp/backends/memory`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
      },
      body: '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}',
    });
  const forwardedFor = (agentId: string) =>
    backend.recorded.filter((request) => request.headers["x-paseo-agent-id"] === agentId);

  const client = await connectClient(running);
  let agentId: string;
  let ownToken: string;
  try {
    await client.patchDaemonConfig({ pluginsEnabled: true });
    await client.installDirectoryPlugin(directory);
    const agent = await manager.createAgent(
      { provider: "claude", cwd: directory, model: "claude-opus-5-5" },
      undefined,
      { workspaceId: undefined },
    );
    agentId = agent.id;
    ownToken = manager.issueAgentToken(agentId);
    // While the agent runs the member, the gateway forwards its calls.
    expect((await callGateway(ownToken)).status).toBe(200);
    expect(forwardedFor(agentId)).toHaveLength(1);

    await expect(manager.runAgent(agentId, "/model claude-sonnet-5-5")).rejects.toThrow(
      SONNET_REFUSAL,
    );
    await expect
      .poll(async () => (await readLogged()).some((entry) => "closedHookCalledFor" in entry))
      .toBe(true);
  } finally {
    await client.close();
  }

  expect(launches).toEqual(["claude-opus-5-5"]);
  expect(manager.getAgent(agentId)).toBeNull();
  expect(manager.getSessionMemberRefusal(agentId)).toBe(SONNET_REFUSAL);
  // The hook could not call for the agent: the daemon issues no caller token for it.
  expect(await readLogged()).toContainEqual({
    closedHookCalledFor: agentId,
    refused: expect.stringContaining(`No live agent ${agentId}`),
  });
  // Neither its own token nor a token minted for its id after the refusal is forwarded.
  expect((await callGateway(ownToken)).status).toBe(401);
  expect((await callGateway(manager.issueAgentToken(agentId))).status).toBe(401);

  // The shutdown did not close the refused agent, so its drain cannot call for it either.
  await writeFile(path.join(directory, "refused-agent.txt"), agentId);
  const result = await shutDown(running);
  expect(result.timelineDrain).toEqual({ status: "drained" });

  const logged = await readLogged();
  expect(logged).toContainEqual({
    drainCalledFor: agentId,
    refused: expect.stringContaining(`No live agent ${agentId}`),
  });
  expect(logged.some((entry) => "accepted" in entry)).toBe(false);
  // The only call the backend and the upstream hook saw for the agent is the one before the refusal.
  expect(forwardedFor(agentId)).toHaveLength(1);
  expect(logged.filter((entry) => entry.upstreamHookFor === agentId)).toHaveLength(1);
}, 60_000);
