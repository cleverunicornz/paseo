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
import { DaemonClient } from "../test-utils/daemon-client.js";
import { createTestAgentClients } from "../test-utils/fake-agent-client.js";
import { createTestPaseoDaemon, type TestPaseoDaemon } from "../test-utils/paseo-daemon.js";

const SONNET_REFUSAL =
  "This session's member is claude/claude-opus-5-5. This agent would run claude/claude-sonnet-5-5. A different model needs a new session.";

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

/**
 * A Claude Code query launched on Opus: its first turn runs Opus and answers
 * `OK`; its second turn reports `claude-sonnet-5-5`, as after `/model
 * claude-sonnet-5-5`, answers `OK` again and completes.
 */
function claudeQueryOpusThenSonnet() {
  return ({ prompt }: { prompt: AsyncIterable<unknown> }) => {
    const prompts = prompt[Symbol.asyncIterator]();
    const frames: Array<Record<string, unknown>> = [];
    let turn = 0;
    const state = { closed: false };
    const waiters: Array<() => void> = [];
    const end = () => {
      state.closed = true;
      for (const wake of waiters.splice(0)) wake();
    };
    const init = (model: string) => ({
      type: "system",
      subtype: "init",
      session_id: "fixture-claude",
      permissionMode: "default",
      model,
    });
    return {
      next: async (): Promise<IteratorResult<Record<string, unknown>>> => {
        const frame = frames.shift();
        if (frame) return { done: false, value: frame };
        if (turn < 2) {
          await prompts.next();
          turn += 1;
          const model = turn === 1 ? "claude-opus-5-5" : "claude-sonnet-5-5";
          frames.push(
            {
              type: "assistant",
              parent_tool_use_id: null,
              session_id: "fixture-claude",
              message: { id: `msg-${turn}`, model, content: [{ type: "text", text: "OK" }] },
            },
            {
              type: "result",
              subtype: "success",
              session_id: "fixture-claude",
              usage: { input_tokens: 1, cache_read_input_tokens: 0, output_tokens: 1 },
              total_cost_usd: 0,
            },
          );
          return { done: false, value: init(model) };
        }
        while (!state.closed) await new Promise<void>((resolve) => waiters.push(resolve));
        return { done: true, value: undefined };
      },
      return: async () => {
        end();
        return { done: true, value: undefined };
      },
      interrupt: async () => end(),
      close: () => end(),
      applyFlagSettings: async () => undefined,
      setPermissionMode: async () => undefined,
      setModel: async () => undefined,
      supportedModels: async () => [],
      supportedCommands: async () => [],
      [Symbol.asyncIterator]() {
        return this;
      },
    };
  };
}

/**
 * A recorder that sends every timeline item to the `memory` backend on behalf
 * of its agent and throws when a send fails, so the daemon offers the item
 * again. Its readiness leaves the verdict to the daemon's own record of what
 * was acknowledged.
 */
async function writeRetryingRecorder(): Promise<void> {
  const file = (name: string) => JSON.stringify(path.join(directory, name));
  await writeFile(
    path.join(directory, "paseo-plugin.json"),
    JSON.stringify({ id: "recorder", requirements: { paseo: ">=0.8.0" } }),
  );
  await writeFile(
    path.join(directory, "index.server.ts"),
    `
import { appendFileSync } from "node:fs";
const log = (value) => appendFileSync(${file("events.log")}, JSON.stringify(value) + "\\n");
export default function contribute(server) {
  server.on("agent.timeline_item", async (event) => {
    try {
      await server.mcp.callTool({
        backend: "memory",
        tool: "record",
        arguments: { seq: event.seq },
        onBehalfOf: event.agent.id,
      });
      log({ sent: event.seq });
    } catch (error) {
      log({ failed: event.seq, error: String(error) });
      throw error;
    }
  });
  server.registerStopReadiness({
    readiness: () => ({
      ready: true,
      timeline: { ready: true, epoch: null, emitted_through: null, acknowledged_through: null },
      wip: { ready: true },
    }),
  });
  return () => {};
}
`,
  );
}

test("an agent the session stopped for running another model still has its timeline recorded, so the session can stop", async () => {
  await writeRetryingRecorder();
  const claude = new ClaudeAgentClient({
    logger: pino({ level: "silent" }),
    resolveBinary: async () => "/fixture/claude",
    queryFactory: claudeQueryOpusThenSonnet() as never,
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
  const client = await connectClient(running);
  const manager = running.daemon.agentManager;
  const readiness = async () =>
    (await (await fetch(`http://127.0.0.1:${running.port}/api/stop-readiness`)).json()) as {
      ready: boolean;
    };
  try {
    await client.patchDaemonConfig({ pluginsEnabled: true });
    await client.installDirectoryPlugin(directory);
    const agent = await manager.createAgent(
      { provider: "claude", cwd: directory, model: "claude-opus-5-5" },
      undefined,
      { workspaceId: undefined },
    );
    const agentToken = manager.issueAgentToken(agent.id);

    // The recorder cannot reach its backend while the agent works, so every item waits.
    backend.down = true;
    await manager.runAgent(agent.id, "reply OK");
    await expect(manager.runAgent(agent.id, "reply OK again")).rejects.toThrow(SONNET_REFUSAL);
    await expect.poll(() => manager.getAgent(agent.id)).toBeNull();
    const failedSeqs = async () =>
      new Set(
        (await readLogged()).flatMap((entry) =>
          typeof entry.failed === "number" ? [entry.failed] : [],
        ),
      );
    await expect.poll(async () => (await failedSeqs()).size).toBeGreaterThan(1);
    backend.down = false;

    // The dashboard's stop: begin stopping, then poll readiness until it holds.
    const beginStopping = await fetch(`http://127.0.0.1:${running.port}/api/begin-stopping`, {
      method: "POST",
    });
    expect(beginStopping.status).toBe(202);
    await expect.poll(async () => (await readiness()).ready, { timeout: 20_000 }).toBe(true);

    // Every item the agent emitted before it closed reached the backend, as that agent.
    const emitted = await failedSeqs();
    expect(new Set(backend.received.map((entry) => entry.seq))).toEqual(emitted);
    expect(new Set(backend.received.map((entry) => entry.agentId))).toEqual(new Set([agent.id]));
    const recordCalls = backend.recorded.filter(
      (request) => !request.down && request.method === "tools/call",
    );
    expect(recordCalls.length).toBeGreaterThanOrEqual(emitted.size);
    for (const call of recordCalls) {
      expect(call.headers).toMatchObject({
        "x-paseo-agent-id": agent.id,
        "x-paseo-member": "claude/claude-opus-5-5",
        "x-paseo-role": "implementer",
      });
      expect(call.headers.authorization).toBeUndefined();
    }

    // The agent itself stays refused, and nothing it sends is forwarded.
    const forwarded = backend.recorded.length;
    const ownCall = await fetch(`http://127.0.0.1:${running.port}/mcp/backends/memory`, {
      method: "POST",
      headers: { Authorization: `Bearer ${agentToken}`, "content-type": "application/json" },
      body: '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}',
    });
    expect([401, 403]).toContain(ownCall.status);
    expect(backend.recorded).toHaveLength(forwarded);
  } finally {
    await client.close();
  }

  expect(await shutDown(running)).toMatchObject({ timelineDrain: { status: "drained" } });
}, 60_000);

test("a plugin's calls for an agent the session stopped end timelineDrainMs after the refusal, though it never acknowledges", async () => {
  await writeRetryingRecorder();
  const claude = new ClaudeAgentClient({
    logger: pino({ level: "silent" }),
    resolveBinary: async () => "/fixture/claude",
    queryFactory: claudeQueryOpusThenSonnet() as never,
  });
  const agentClients = createTestAgentClients();
  agentClients.claude!.createSession = claude.createSession.bind(claude);
  const running = await startDaemon({
    agentClients,
    sessionRuntime: {
      ...DEFAULT_SESSION_RUNTIME_CONFIG,
      timelineDrainMs: 1_000,
      identity: { member: "claude/claude-opus-5-5", role: "implementer" },
    },
  });
  const client = await connectClient(running);
  const manager = running.daemon.agentManager;
  try {
    await client.patchDaemonConfig({ pluginsEnabled: true });
    await client.installDirectoryPlugin(directory);
    const agent = await manager.createAgent(
      { provider: "claude", cwd: directory, model: "claude-opus-5-5" },
      undefined,
      { workspaceId: undefined },
    );

    // The recorder's backend never comes back, so nothing is ever acknowledged.
    backend.down = true;
    await manager.runAgent(agent.id, "reply OK");
    await expect(manager.runAgent(agent.id, "reply OK again")).rejects.toThrow(SONNET_REFUSAL);
    const refusedAt = Date.now();
    await expect.poll(() => manager.getAgent(agent.id)).toBeNull();
    const failures = async () =>
      (await readLogged()).flatMap((entry) =>
        typeof entry.failed === "number" ? [String(entry.error)] : [],
      );
    // Within the window the recorder still reaches the gateway as the agent.
    await expect.poll(async () => (await failures()).length).toBeGreaterThan(1);
    expect(Date.now() - refusedAt).toBeLessThan(1_000);
    expect((await failures()).some((error) => error.includes("No live agent"))).toBe(false);

    // Once timelineDrainMs has passed since the refusal, an offer again is refused at once.
    await expect
      .poll(
        async () => {
          await fetch(`http://127.0.0.1:${running.port}/api/stop-readiness`);
          return (await failures()).some((error) => error.includes(`No live agent ${agent.id}`));
        },
        { timeout: 15_000, interval: 500 },
      )
      .toBe(true);
    const forwarded = backend.recorded.length;
    await new Promise((resolve) => setTimeout(resolve, 2_500));
    await fetch(`http://127.0.0.1:${running.port}/api/stop-readiness`);
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(backend.recorded).toHaveLength(forwarded);
  } finally {
    await client.close();
  }
  await shutDown(running);
}, 60_000);
