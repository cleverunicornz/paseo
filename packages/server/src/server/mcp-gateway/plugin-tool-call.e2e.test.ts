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
import { CodexAppServerAgentClient } from "../agent/providers/codex-app-server-agent.js";
import { createFakeCodexAppServer } from "../agent/providers/codex/test-utils/fake-app-server.js";
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

/**
 * A Claude Code query whose turns report the models of `turnModels` in turn,
 * across every query the daemon starts (a resumed session starts a new one):
 * each turn's init and answer carry that model, or none for `null`. The last
 * model repeats.
 */
function claudeQueryReportingTurns(turnModels: Array<string | null>) {
  let turn = 0;
  return ({ prompt }: { prompt: AsyncIterable<unknown> }) => {
    const prompts = prompt[Symbol.asyncIterator]();
    const frames: Array<Record<string, unknown>> = [];
    const state = { closed: false };
    return {
      next: async (): Promise<IteratorResult<Record<string, unknown>>> => {
        while (!state.closed) {
          const frame = frames.shift();
          if (frame) return { done: false, value: frame };
          const next = await prompts.next();
          if (next.done) break;
          const reported = turnModels[Math.min(turn, turnModels.length - 1)];
          const model = reported === null ? {} : { model: reported ?? "claude-opus-5-5" };
          turn += 1;
          frames.push(
            {
              type: "system",
              subtype: "init",
              session_id: "fixture-claude",
              permissionMode: "default",
              ...model,
            },
            {
              type: "assistant",
              parent_tool_use_id: null,
              session_id: "fixture-claude",
              message: { id: `msg-${turn}`, ...model, content: [{ type: "text", text: "OK" }] },
            },
            {
              type: "result",
              subtype: "success",
              session_id: "fixture-claude",
              usage: { input_tokens: 1, cache_read_input_tokens: 0, output_tokens: 1 },
              total_cost_usd: 0,
            },
          );
        }
        return { done: true, value: undefined };
      },
      return: async () => {
        state.closed = true;
        return { done: true, value: undefined };
      },
      interrupt: async () => {
        state.closed = true;
      },
      close: () => {
        state.closed = true;
      },
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

/** Agent clients whose Claude sessions, created and resumed, run the real adapter over `query`. */
function claudeClientsReporting(turnModels: Array<string | null>) {
  const claude = new ClaudeAgentClient({
    logger: pino({ level: "silent" }),
    resolveBinary: async () => "/fixture/claude",
    queryFactory: claudeQueryReportingTurns(turnModels) as never,
  });
  const agentClients = createTestAgentClients();
  agentClients.claude!.createSession = claude.createSession.bind(claude);
  agentClients.claude!.resumeSession = claude.resumeSession.bind(claude);
  return agentClients;
}

const OPUS_SESSION = {
  ...DEFAULT_SESSION_RUNTIME_CONFIG,
  identity: { member: "claude/claude-opus-5-5", role: "implementer" as const },
};

/** Creates an Opus agent whose first turn reports Sonnet, so the session refuses and closes it. */
async function createRefusedAgent(running: TestPaseoDaemon): Promise<string> {
  const manager = running.daemon.agentManager;
  const agent = await manager.createAgent(
    { provider: "claude", cwd: directory, model: "claude-opus-5-5" },
    undefined,
    { workspaceId: undefined },
  );
  await expect(manager.runAgent(agent.id, "/model claude-sonnet-5-5")).rejects.toThrow(
    SONNET_REFUSAL,
  );
  await expect.poll(() => manager.getAgent(agent.id)).toBeNull();
  expect(manager.getSessionMemberRefusal(agent.id)).toBe(SONNET_REFUSAL);
  return agent.id;
}

/** The agent's own MCP request to the `memory` backend through the gateway. */
async function callAsAgent(running: TestPaseoDaemon, agentId: string): Promise<number> {
  const token = running.daemon.agentManager.issueAgentToken(agentId);
  const response = await fetch(`http://127.0.0.1:${running.port}/mcp/backends/memory`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"t","version":"1"}}}',
  });
  await response.body?.cancel();
  return response.status;
}

/** Every refusal the agent's state changes showed, from now on. */
function watchRefusals(running: TestPaseoDaemon, agentId: string): Array<string | null> {
  const manager = running.daemon.agentManager;
  const seen: Array<string | null> = [];
  manager.subscribe(
    (event) => {
      if (event.type === "agent_state" && event.agent.id === agentId) {
        seen.push(manager.getSessionMemberRefusal(agentId));
      }
    },
    { agentId, replayState: false },
  );
  return seen;
}

test("a plugin hook that resumes a refused agent does not re-admit it: the gateway forwards nothing for it", async () => {
  // The validator's G-1 probe: a real plugin, the real Claude adapter, a runtime reporting Sonnet.
  // The probe hooked agent.closed, which this line does not have yet; the refused turn's
  // agent.turn_ended reaches the plugin the same way, and its barrier holds until the agent closed.
  const file = (name: string) => JSON.stringify(path.join(directory, name));
  await writeFile(
    path.join(directory, "paseo-plugin.json"),
    JSON.stringify({ id: "refetch-after-refusal", requirements: { paseo: ">=0.8.0" } }),
  );
  await writeFile(
    path.join(directory, "index.server.ts"),
    `
import { appendFileSync, existsSync } from "node:fs";
const log = (value) => appendFileSync(${file("events.log")}, JSON.stringify(value) + "\\n");
const handled = new Set();
export default function contribute(server) {
  server.on("agent.turn_ended", async (event, context) => {
    if (handled.has(event.agent.id)) return;
    handled.add(event.agent.id);
    log({ paused: event.agent.id });
    try {
      const deadline = Date.now() + 15000;
      while (!existsSync(${file("allow-resume")})) {
        if (Date.now() > deadline || context.signal.aborted) throw new Error("barrier expired");
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      await context.paseo.agents.ref(event.agent.id).timeline.refetch();
      log({ refetched: event.agent.id });
      const result = await server.mcp.callTool({ backend: "memory", tool: "whoami", onBehalfOf: event.agent.id });
      log({ called: event.agent.id, result });
    } catch (error) {
      log({ refused: String(error) });
    }
  });
  return () => {};
}
`,
  );
  const running = await startDaemon({
    agentClients: claudeClientsReporting(["claude-sonnet-5-5"]),
    sessionRuntime: OPUS_SESSION,
  });
  const client = await connectClient(running);
  const manager = running.daemon.agentManager;
  try {
    await client.patchDaemonConfig({ pluginsEnabled: true });
    await client.installDirectoryPlugin(directory);
    const agentId = await createRefusedAgent(running);
    await expect
      .poll(async () => (await readLogged()).some((entry) => entry.paused === agentId))
      .toBe(true);
    expect(manager.getAgent(agentId)).toBeNull();
    expect(backend.recorded).toHaveLength(0);

    await writeFile(path.join(directory, "allow-resume"), "go");
    await expect
      .poll(
        async () =>
          (await readLogged()).find((entry) => "called" in entry || "refused" in entry) ?? null,
        { timeout: 20_000 },
      )
      .toEqual({ refused: expect.stringContaining(`No live agent ${agentId}`) });

    // Resumed, and still refused: neither the plugin nor the agent reaches a backend.
    expect((await readLogged()).some((entry) => entry.refetched === agentId)).toBe(true);
    expect(manager.getAgent(agentId)).not.toBeNull();
    expect(manager.getSessionMemberRefusal(agentId)).toBe(SONNET_REFUSAL);
    expect(await callAsAgent(running, agentId)).toBe(403);
    expect(backend.recorded).toHaveLength(0);
  } finally {
    await client.close();
  }
}, 60_000);

test("an agent resumed through the API stays refused until its runtime reports the member, and is closed again when it reports another model", async () => {
  const running = await startDaemon({
    agentClients: claudeClientsReporting(["claude-sonnet-5-5"]),
    sessionRuntime: OPUS_SESSION,
  });
  const client = await connectClient(running);
  const manager = running.daemon.agentManager;
  try {
    const agentId = await createRefusedAgent(running);
    const refusals = watchRefusals(running, agentId);

    await client.refreshAgent(agentId);
    expect(manager.getAgent(agentId)).not.toBeNull();
    expect(manager.getSessionMemberRefusal(agentId)).toBe(SONNET_REFUSAL);
    expect(await callAsAgent(running, agentId)).toBe(403);

    // The resumed runtime reports Sonnet again: the agent is closed again, still refused.
    await expect(manager.runAgent(agentId, "go on")).rejects.toThrow(SONNET_REFUSAL);
    await expect.poll(() => manager.getAgent(agentId)).toBeNull();
    expect(manager.getSessionMemberRefusal(agentId)).toBe(SONNET_REFUSAL);
    expect(refusals.length).toBeGreaterThan(0);
    expect(refusals.every((refusal) => refusal === SONNET_REFUSAL)).toBe(true);
    expect(backend.recorded).toHaveLength(0);
  } finally {
    await client.close();
  }
}, 60_000);

test("an agent resumed through the API is admitted again once its runtime reports the member", async () => {
  const running = await startDaemon({
    agentClients: claudeClientsReporting(["claude-sonnet-5-5", "claude-opus-5-5"]),
    sessionRuntime: OPUS_SESSION,
  });
  const client = await connectClient(running);
  const manager = running.daemon.agentManager;
  try {
    const agentId = await createRefusedAgent(running);

    await client.refreshAgent(agentId);
    // Resuming alone proves nothing about the model the runtime runs.
    expect(manager.getSessionMemberRefusal(agentId)).toBe(SONNET_REFUSAL);
    expect(await callAsAgent(running, agentId)).toBe(403);
    expect(backend.recorded).toHaveLength(0);

    // Its first turn reports Opus, the member: the session admits it again.
    await manager.runAgent(agentId, "go on");
    expect(manager.getSessionMemberRefusal(agentId)).toBeNull();
    expect(manager.getAgent(agentId)).not.toBeNull();
    expect(await callAsAgent(running, agentId)).toBe(200);
    expect(backend.recorded.map((request) => request.headers["x-paseo-member"])).toEqual([
      "claude/claude-opus-5-5",
    ]);
  } finally {
    await client.close();
  }
}, 60_000);

test("a schedule that runs a refused agent never re-admits it", async () => {
  const running = await startDaemon({
    agentClients: claudeClientsReporting(["claude-sonnet-5-5"]),
    sessionRuntime: OPUS_SESSION,
  });
  const client = await connectClient(running);
  const manager = running.daemon.agentManager;
  try {
    const agentId = await createRefusedAgent(running);
    const refusals = watchRefusals(running, agentId);
    const created = await client.scheduleCreate({
      prompt: "scheduled check",
      cadence: { type: "cron", expression: "0 0 1 1 *" },
      target: { type: "agent", agentId },
    });
    if (!created.schedule) throw new Error(created.error ?? "schedule/create returned nothing");

    await client.scheduleRunOnce({ id: created.schedule.id });

    await expect.poll(() => manager.getAgent(agentId)).toBeNull();
    expect(refusals.length).toBeGreaterThan(0);
    expect(refusals.every((refusal) => refusal === SONNET_REFUSAL)).toBe(true);
    expect(manager.getSessionMemberRefusal(agentId)).toBe(SONNET_REFUSAL);
    expect(backend.recorded).toHaveLength(0);
  } finally {
    await client.close();
  }
}, 60_000);

test("a refused agent stays refused after the daemon restarts and a client reconnects to resume it", async () => {
  const paseoHomeRoot = await mkdtemp(path.join(tmpdir(), "paseo-refusal-restart-"));
  const first = await startDaemon({
    agentClients: claudeClientsReporting(["claude-sonnet-5-5"]),
    sessionRuntime: OPUS_SESSION,
    paseoHomeRoot,
    cleanup: false,
  });
  const agentId = await createRefusedAgent(first);
  await first.daemon.stop();
  daemon = null;

  const running = await startDaemon({
    agentClients: claudeClientsReporting(["claude-sonnet-5-5"]),
    sessionRuntime: OPUS_SESSION,
    paseoHomeRoot,
  });
  const client = await connectClient(running);
  const manager = running.daemon.agentManager;
  try {
    await client.refreshAgent(agentId);
    expect(manager.getAgent(agentId)).not.toBeNull();
    expect(manager.getSessionMemberRefusal(agentId)).toBe(SONNET_REFUSAL);
    expect(await callAsAgent(running, agentId)).toBe(403);
    expect(backend.recorded).toHaveLength(0);
  } finally {
    await client.close();
  }
}, 60_000);

test("an agent resumed through the explicit resume API keeps its refusal: its tool and model calls are refused", async () => {
  // a254 F1: resume_agent_request starts the same native session under a new agent id.
  const inference: unknown[] = [];
  const models = http.createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      inference.push(req.url);
      res.writeHead(200, { "content-type": "application/json" }).end("{}");
    });
  });
  await new Promise<void>((resolve) => models.listen(0, "127.0.0.1", resolve));
  const memoryUrl = `http://127.0.0.1:${(backend.server.address() as net.AddressInfo).port}/mcp`;
  const modelsUrl = `http://127.0.0.1:${(models.address() as net.AddressInfo).port}/v1`;
  let client: DaemonClient | undefined;
  try {
    const running = await startDaemon({
      agentClients: claudeClientsReporting(["claude-sonnet-5-5"]),
      sessionRuntime: OPUS_SESSION,
      mcpGatewayBackends: { memory: { url: memoryUrl }, models: { url: modelsUrl } },
    });
    const manager = running.daemon.agentManager;
    const refusedId = await createRefusedAgent(running);
    await manager.flush();
    const record = await running.daemon.agentStorage.get(refusedId);
    expect(record?.sessionMemberRefused).toBe("claude/claude-sonnet-5-5");
    client = await connectClient(running);

    const resumed = await client.resumeAgent(record!.persistence!, {
      cwd: directory,
      model: "claude-opus-5-5",
    });

    expect(manager.getSessionMemberRefusal(resumed.id)).toBe(SONNET_REFUSAL);
    expect(await callAsAgent(running, resumed.id)).toBe(403);
    const model = await fetch(`http://127.0.0.1:${running.port}/mcp/backends/models/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${manager.issueAgentToken(resumed.id)}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ model: "claude-sonnet-5-5", messages: [], max_tokens: 1 }),
    });
    await model.body?.cancel();
    expect(model.status).toBe(403);
    expect(backend.recorded).toHaveLength(0);
    expect(inference).toHaveLength(0);
  } finally {
    await client?.close();
    models.closeAllConnections();
    await new Promise<void>((resolve) => models.close(() => resolve()));
  }
}, 60_000);

/** A model backend that answers every request and keeps the paths it was sent. */
async function startModelBackend() {
  const requests: string[] = [];
  const server = http.createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      requests.push(String(req.url));
      res.writeHead(200, { "content-type": "application/json" }).end("{}");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${(server.address() as net.AddressInfo).port}/v1`,
    requests,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

/** The agent's own model request naming Sonnet, through the `models` gateway backend. */
async function modelCallAsAgent(running: TestPaseoDaemon, agentId: string): Promise<number> {
  const response = await fetch(`http://127.0.0.1:${running.port}/mcp/backends/models/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${running.daemon.agentManager.issueAgentToken(agentId)}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ model: "claude-sonnet-5-5", messages: [], max_tokens: 1 }),
  });
  await response.body?.cancel();
  return response.status;
}

/** Claude clients over `query`; a resume calls `onResume`, then waits for `barrier` once the session is open. */
function claudeClientsResumingAt(
  turnModels: Array<string | null>,
  onResume: () => void,
  barrier: Promise<void>,
) {
  const claude = new ClaudeAgentClient({
    logger: pino({ level: "silent" }),
    resolveBinary: async () => "/fixture/claude",
    queryFactory: claudeQueryReportingTurns(turnModels) as never,
  });
  const agentClients = createTestAgentClients();
  agentClients.claude!.createSession = claude.createSession.bind(claude);
  agentClients.claude!.resumeSession = async (...args) => {
    onResume();
    const session = await claude.resumeSession(...args);
    await barrier;
    return session;
  };
  agentClients.claude!.importSession = claude.importSession.bind(claude);
  return agentClients;
}

test("a refusal recorded while an explicit resume of the same native session is under way reaches the resumed agent", async () => {
  // a218/W-13 F1-R2, the validator's R2-RACE probe: the older agent is refused after the
  // resume read the native session's refusals and before the resumed agent registered.
  const models = await startModelBackend();
  let resumeStarted!: () => void;
  const resuming = new Promise<void>((resolve) => {
    resumeStarted = resolve;
  });
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  let client: DaemonClient | undefined;
  try {
    const running = await startDaemon({
      agentClients: claudeClientsResumingAt(
        ["claude-opus-5-5", "claude-sonnet-5-5"],
        () => resumeStarted(),
        barrier,
      ),
      sessionRuntime: OPUS_SESSION,
      mcpGatewayBackends: {
        memory: {
          url: `http://127.0.0.1:${(backend.server.address() as net.AddressInfo).port}/mcp`,
        },
        models: { url: models.url },
      },
    });
    const manager = running.daemon.agentManager;
    const older = await manager.createAgent(
      { provider: "claude", cwd: directory, model: "claude-opus-5-5" },
      undefined,
      { workspaceId: undefined },
    );
    await manager.runAgent(older.id, "a member turn");
    await manager.flush();
    const record = await running.daemon.agentStorage.get(older.id);
    expect(record?.sessionMemberRefused).toBeUndefined();
    client = await connectClient(running);

    const resume = client.resumeAgent(record!.persistence!, {
      cwd: directory,
      model: "claude-opus-5-5",
    });
    await resuming;
    await expect(manager.runAgent(older.id, "/model claude-sonnet-5-5")).rejects.toThrow(
      SONNET_REFUSAL,
    );
    await expect.poll(() => manager.getAgent(older.id)).toBeNull();
    await manager.flush();
    expect((await running.daemon.agentStorage.get(older.id))?.sessionMemberRefused).toBe(
      "claude/claude-sonnet-5-5",
    );
    release();
    const resumed = await resume;

    expect(manager.getSessionMemberRefusal(resumed.id)).toBe(SONNET_REFUSAL);
    expect(await callAsAgent(running, resumed.id)).toBe(403);
    expect(await modelCallAsAgent(running, resumed.id)).toBe(403);
    expect(backend.recorded).toHaveLength(0);
    expect(models.requests).toHaveLength(0);
  } finally {
    release();
    await client?.close();
    await models.close();
  }
}, 60_000);

test("a live agent on a native session is refused at once when another agent on it is refused", async () => {
  // a218/W-13: the refusal belongs to the native session, so it reaches every agent running it.
  const models = await startModelBackend();
  let client: DaemonClient | undefined;
  try {
    const running = await startDaemon({
      agentClients: claudeClientsResumingAt(
        ["claude-opus-5-5", "claude-sonnet-5-5"],
        () => {},
        Promise.resolve(),
      ),
      sessionRuntime: OPUS_SESSION,
      mcpGatewayBackends: {
        memory: {
          url: `http://127.0.0.1:${(backend.server.address() as net.AddressInfo).port}/mcp`,
        },
        models: { url: models.url },
      },
    });
    const manager = running.daemon.agentManager;
    const older = await manager.createAgent(
      { provider: "claude", cwd: directory, model: "claude-opus-5-5" },
      undefined,
      { workspaceId: undefined },
    );
    await manager.runAgent(older.id, "a member turn");
    await manager.flush();
    const record = await running.daemon.agentStorage.get(older.id);
    client = await connectClient(running);
    const alias = await client.resumeAgent(record!.persistence!, {
      cwd: directory,
      model: "claude-opus-5-5",
    });
    expect(manager.getSessionMemberRefusal(alias.id)).toBeNull();

    await expect(manager.runAgent(older.id, "/model claude-sonnet-5-5")).rejects.toThrow(
      SONNET_REFUSAL,
    );

    expect(manager.getSessionMemberRefusal(alias.id)).toBe(SONNET_REFUSAL);
    expect(await callAsAgent(running, alias.id)).toBe(403);
    expect(await modelCallAsAgent(running, alias.id)).toBe(403);
    expect(backend.recorded).toHaveLength(0);
    expect(models.requests).toHaveLength(0);
  } finally {
    await client?.close();
    await models.close();
  }
}, 60_000);

test("importing a native session an agent was refused on keeps the refusal: the imported agent's calls are refused", async () => {
  // Operator decision on the declared gap: import is a resume path (D-000400 item 1, fail-closed).
  const models = await startModelBackend();
  const agentClients = claudeClientsResumingAt(["claude-sonnet-5-5"], () => {}, Promise.resolve());
  // An import opens the provider's default model: here the member, which the gate admits.
  const claude = agentClients.claude!;
  const catalog = claude.fetchCatalog.bind(claude);
  claude.fetchCatalog = async (options) => ({
    ...(await catalog(options)),
    models: [{ provider: "claude", id: "claude-opus-5-5", label: "Opus", isDefault: true }],
  });
  try {
    const running = await startDaemon({
      agentClients,
      sessionRuntime: OPUS_SESSION,
      mcpGatewayBackends: {
        memory: {
          url: `http://127.0.0.1:${(backend.server.address() as net.AddressInfo).port}/mcp`,
        },
        models: { url: models.url },
      },
    });
    const manager = running.daemon.agentManager;
    const refusedId = await createRefusedAgent(running);
    await manager.flush();
    const record = await running.daemon.agentStorage.get(refusedId);
    expect(record?.persistence?.sessionId).toBe("fixture-claude");

    const imported = await manager.importProviderSession({
      provider: "claude",
      providerHandleId: "fixture-claude",
      cwd: directory,
      workspaceId: record!.workspaceId!,
    });

    expect(manager.getSessionMemberRefusal(imported.id)).toBe(SONNET_REFUSAL);
    expect(await callAsAgent(running, imported.id)).toBe(403);
    expect(await modelCallAsAgent(running, imported.id)).toBe(403);
    expect(backend.recorded).toHaveLength(0);
    expect(models.requests).toHaveLength(0);
  } finally {
    await models.close();
  }
}, 60_000);

test("a plugin gets no token for a refused agent from another hook, though one of its timeline items is unacknowledged", async () => {
  // a254 F2: the drain serves a refused agent's own timeline delivery, not other calls.
  const file = (name: string) => JSON.stringify(path.join(directory, name));
  await writeFile(
    path.join(directory, "paseo-plugin.json"),
    JSON.stringify({ id: "backlog-and-refetch", requirements: { paseo: ">=0.8.0" } }),
  );
  await writeFile(
    path.join(directory, "index.server.ts"),
    `
import { appendFileSync, existsSync } from "node:fs";
const log = (value) => appendFileSync(${file("events.log")}, JSON.stringify(value) + "\\n");
const handled = new Set();
export default function contribute(server) {
  server.on("agent.timeline_item", async () => {
    throw new Error("left unacknowledged on purpose");
  });
  server.on("agent.turn_ended", async (event, context) => {
    if (handled.has(event.agent.id)) return;
    handled.add(event.agent.id);
    log({ paused: event.agent.id });
    while (!existsSync(${file("release")})) {
      if (context.signal.aborted) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    await context.paseo.agents.ref(event.agent.id).timeline.refetch();
    try {
      const result = await server.mcp.callTool({ backend: "memory", tool: "whoami", onBehalfOf: event.agent.id });
      log({ called: event.agent.id, result });
    } catch (error) {
      log({ refused: String(error) });
    }
  });
  return () => {};
}
`,
  );
  const running = await startDaemon({
    agentClients: claudeClientsReporting(["claude-sonnet-5-5"]),
    sessionRuntime: { ...OPUS_SESSION, timelineDrainMs: 3_000 },
  });
  const client = await connectClient(running);
  const manager = running.daemon.agentManager;
  try {
    await client.patchDaemonConfig({ pluginsEnabled: true });
    await client.installDirectoryPlugin(directory);
    const agentId = await createRefusedAgent(running);
    await expect
      .poll(async () => (await readLogged()).some((entry) => entry.paused === agentId))
      .toBe(true);

    await writeFile(path.join(directory, "release"), "go");
    await expect
      .poll(
        async () =>
          (await readLogged()).find((entry) => "called" in entry || "refused" in entry) ?? null,
        { timeout: 20_000 },
      )
      .toEqual({ refused: expect.stringContaining(`No live agent ${agentId}`) });
    expect(manager.getSessionMemberRefusal(agentId)).toBe(SONNET_REFUSAL);
    expect(backend.recorded).toHaveLength(0);
  } finally {
    await client.close();
  }
}, 60_000);

test("a plugin delivering a live refused agent's timeline item gets no token for it", async () => {
  // a254 F2: a refused agent resumed and live is refused for the plugin as for itself.
  const file = (name: string) => JSON.stringify(path.join(directory, name));
  await writeFile(
    path.join(directory, "paseo-plugin.json"),
    JSON.stringify({ id: "records-live", requirements: { paseo: ">=0.8.0" } }),
  );
  await writeFile(
    path.join(directory, "index.server.ts"),
    `
import { appendFileSync, existsSync } from "node:fs";
const log = (value) => appendFileSync(${file("events.log")}, JSON.stringify(value) + "\\n");
export default function contribute(server) {
  server.on("agent.timeline_item", async (event) => {
    if (!existsSync(${file("resumed")})) return;
    try {
      await server.mcp.callTool({ backend: "memory", tool: "record", arguments: { seq: event.seq }, onBehalfOf: event.agent.id });
      log({ recorded: event.seq });
    } catch (error) {
      log({ refused: event.seq, error: String(error) });
    }
  });
  return () => {};
}
`,
  );
  // The resumed turn reports no model: the agent runs on, live and still refused.
  const running = await startDaemon({
    agentClients: claudeClientsReporting(["claude-sonnet-5-5", null]),
    sessionRuntime: OPUS_SESSION,
  });
  const client = await connectClient(running);
  const manager = running.daemon.agentManager;
  try {
    await client.patchDaemonConfig({ pluginsEnabled: true });
    await client.installDirectoryPlugin(directory);
    const agentId = await createRefusedAgent(running);
    await client.refreshAgent(agentId);
    await writeFile(path.join(directory, "resumed"), "yes");

    // The turn ends with the refusal: the agent is still refused.
    await expect(manager.runAgent(agentId, "a turn of the resumed agent")).rejects.toThrow(
      SONNET_REFUSAL,
    );
    await expect
      .poll(
        async () =>
          (await readLogged()).filter((entry) => "recorded" in entry || "refused" in entry).length,
      )
      .toBeGreaterThan(0);
    const attempts = (await readLogged()).filter(
      (entry) => "recorded" in entry || "refused" in entry,
    );
    expect(
      attempts.every((entry) => String(entry.error).includes(`No live agent ${agentId}`)),
    ).toBe(true);
    expect(manager.getAgent(agentId)).not.toBeNull();
    expect(manager.getSessionMemberRefusal(agentId)).toBe(SONNET_REFUSAL);
    expect(backend.received).toHaveLength(0);
  } finally {
    await client.close();
  }
}, 60_000);

/**
 * A session for codex/gpt-5.4 whose agent the session refused after its
 * app-server reported gpt-5.5, and closed. Each later app-server answers
 * `thread/resume` with `resumeModel`; with `loaded` the thread is already loaded.
 */
async function startRefusedCodexAgent(resumeModel: string, loaded = false) {
  const apps: Array<ReturnType<typeof createFakeCodexAppServer>> = [];
  const codex = new CodexAppServerAgentClient(pino({ level: "silent" }));
  const internals = codex as unknown as {
    goalsEnabledPromise: Promise<boolean>;
    autoReviewEnabledPromise: Promise<boolean>;
    spawnAppServer: () => Promise<unknown>;
  };
  internals.goalsEnabledPromise = Promise.resolve(false);
  internals.autoReviewEnabledPromise = Promise.resolve(false);
  internals.spawnAppServer = async () => {
    let threadLoaded = loaded && apps.length > 0;
    const app = createFakeCodexAppServer({
      "thread/loaded/list": () => ({ data: threadLoaded ? ["thread-1"] : [] }),
      "thread/start": () => {
        threadLoaded = true;
        return { thread: { id: "thread-1" } };
      },
      "thread/resume": () => {
        threadLoaded = true;
        return { thread: { id: "thread-1" }, model: resumeModel };
      },
      "turn/interrupt": () => ({}),
    });
    apps.push(app);
    return app.child;
  };
  const agentClients = createTestAgentClients();
  agentClients.codex!.createSession = codex.createSession.bind(codex);
  agentClients.codex!.resumeSession = codex.resumeSession.bind(codex);
  const running = await startDaemon({
    agentClients,
    sessionRuntime: {
      ...DEFAULT_SESSION_RUNTIME_CONFIG,
      identity: { member: "codex/gpt-5.4", role: "implementer" },
    },
  });
  const manager = running.daemon.agentManager;
  const agent = await manager.createAgent(
    { provider: "codex", cwd: directory, model: "gpt-5.4" },
    undefined,
    { workspaceId: undefined },
  );
  const turn = manager.runAgent(agent.id, "first").catch((error: unknown) => error);
  await apps[0]!.waitForTurnStart();
  apps[0]!.startsTurn({ threadId: "thread-1", turnId: "turn-1" });
  apps[0]!.child.stdout.write(
    `${JSON.stringify({
      method: "thread/settings/updated",
      params: {
        threadId: "thread-1",
        threadSettings: { model: "gpt-5.5", modelProvider: "openai" },
      },
    })}\n`,
  );
  await expect.poll(() => manager.getSessionMemberRefusal(agent.id)).toContain("codex/gpt-5.5");
  await turn;
  await expect.poll(() => manager.getAgent(agent.id)).toBeNull();
  return { running, manager, agentId: agent.id, apps };
}

test("a refused Codex agent whose resumed thread reports the member is admitted again", async () => {
  // a254 F3: the thread/resume report comes before the agent manager subscribes.
  const { running, manager, agentId, apps } = await startRefusedCodexAgent("gpt-5.4");
  const client = await connectClient(running);
  try {
    await client.refreshAgent(agentId);
    expect(
      apps[1]!.requests().filter((request) => request.method === "thread/resume"),
    ).toHaveLength(1);
    await expect.poll(() => manager.getSessionMemberRefusal(agentId)).toBeNull();
    expect(await callAsAgent(running, agentId)).toBe(200);
  } finally {
    await client.close();
  }
}, 60_000);

test("a refused Codex agent whose resumed thread reports another model is closed again", async () => {
  const { running, manager, agentId } = await startRefusedCodexAgent("gpt-5.5");
  const client = await connectClient(running);
  try {
    await client.refreshAgent(agentId);
    await expect.poll(() => manager.getAgent(agentId)).toBeNull();
    expect(manager.getSessionMemberRefusal(agentId)).toContain("codex/gpt-5.5");
    expect(backend.recorded).toHaveLength(0);
  } finally {
    await client.close();
  }
}, 60_000);

test("a refused Codex agent on a loaded thread is admitted by the app-server's first report of the member, unchanged or not", async () => {
  const { running, manager, agentId, apps } = await startRefusedCodexAgent("gpt-5.4", true);
  const client = await connectClient(running);
  try {
    await client.refreshAgent(agentId);
    // No thread/resume, so no report yet: still refused.
    expect(
      apps[1]!.requests().filter((request) => request.method === "thread/resume"),
    ).toHaveLength(0);
    expect(await callAsAgent(running, agentId)).toBe(403);

    apps[1]!.child.stdout.write(
      `${JSON.stringify({
        method: "thread/settings/updated",
        params: {
          threadId: "thread-1",
          threadSettings: { model: "gpt-5.4", modelProvider: "openai" },
        },
      })}\n`,
    );
    await expect.poll(() => manager.getSessionMemberRefusal(agentId)).toBeNull();
  } finally {
    await client.close();
  }
}, 60_000);
