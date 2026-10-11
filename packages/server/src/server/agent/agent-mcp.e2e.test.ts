import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { describe, expect, test, vi } from "vitest";
import { experimental_createMCPClient } from "ai";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import pino from "pino";

import { withTimeout } from "../../utils/promise-timeout.js";
import { hashDaemonPassword } from "../auth.js";
import { createPaseoDaemon, type PaseoDaemonConfig } from "../bootstrap.js";
import { DEFAULT_SESSION_RUNTIME_CONFIG } from "../session-runtime-config.js";
import { createTestAgentClients } from "../test-utils/fake-agent-client.js";
import { asInternals } from "../test-utils/class-mocks.js";
import { createTestPaseoDaemon } from "../test-utils/paseo-daemon.js";
import { ensureAgentLoaded } from "./agent-loading.js";
import { ClaudeAgentClient } from "./providers/claude/agent.js";
import {
  CodexAppServerAgentClient,
  CodexAppServerAgentSession,
} from "./providers/codex-app-server-agent.js";
import {
  createFakeCodexAppServer,
  type FakeCodexAppServer,
} from "./providers/codex/test-utils/fake-app-server.js";
import type {
  AgentClient,
  AgentPersistenceHandle,
  AgentRunResult,
  AgentSession,
  AgentSessionConfig,
  AgentStreamEvent,
} from "./agent-sdk-types.js";

interface StructuredContent {
  [key: string]: unknown;
}

interface McpToolResult {
  structuredContent?: StructuredContent;
  content?: Array<{ structuredContent?: StructuredContent } | StructuredContent>;
  isError?: boolean;
}

interface McpClient {
  callTool: (input: { name: string; args?: StructuredContent }) => Promise<McpToolResult>;
  close: () => Promise<void>;
}

async function waitForPathExists(options: {
  targetPath: string;
  timeoutMs: number;
}): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < options.timeoutMs) {
    if (existsSync(options.targetPath)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out after ${options.timeoutMs}ms waiting for path: ${options.targetPath}`);
}

async function getAvailablePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Failed to acquire port")));
        return;
      }
      server.close(() => resolve(address.port));
    });
  });
}

function getStructuredContent(result: McpToolResult): StructuredContent | null {
  if (result.structuredContent && typeof result.structuredContent === "object") {
    return result.structuredContent;
  }
  const content = result.content?.[0];
  if (content && typeof content === "object" && "structuredContent" in content) {
    if (content.structuredContent) return content.structuredContent;
  }
  if (content && typeof content === "object") {
    return content;
  }
  return null;
}

async function createMcpClient(url: string, authToken?: string): Promise<McpClient> {
  const transport = new StreamableHTTPClientTransport(
    new URL(url),
    authToken ? { requestInit: { headers: { Authorization: `Bearer ${authToken}` } } } : undefined,
  );
  const rawClient = await experimental_createMCPClient({ transport });
  const boundCallTool: McpClient["callTool"] = Reflect.get(rawClient, "callTool").bind(rawClient);
  return { callTool: boundCallTool, close: () => rawClient.close() };
}

interface OfflineMcpDaemon {
  client: McpClient;
  stop: () => Promise<void>;
}

async function startOfflineMcpDaemon(): Promise<OfflineMcpDaemon> {
  const paseoHome = await mkdtemp(path.join(os.tmpdir(), "paseo-home-"));
  const staticDir = await mkdtemp(path.join(os.tmpdir(), "paseo-static-"));
  const removeDirectories = async () => {
    await rm(paseoHome, { recursive: true, force: true });
    await rm(staticDir, { recursive: true, force: true });
  };
  const port = await getAvailablePort();
  const daemon = await createPaseoDaemon(
    {
      listen: `127.0.0.1:${port}`,
      paseoHome,
      corsAllowedOrigins: [],
      hostnames: true,
      mcpEnabled: true,
      staticDir,
      mcpDebug: false,
      agentClients: createTestAgentClients(),
      agentStoragePath: path.join(paseoHome, "agents"),
    },
    pino({ level: "silent" }),
  ).catch(async (error: unknown) => {
    await removeDirectories();
    throw error;
  });
  try {
    await daemon.start();
    const client = await createMcpClient(`http://127.0.0.1:${port}/mcp/agents`);
    return {
      client,
      stop: async () => {
        await client.close();
        await daemon.stop();
        await removeDirectories();
      },
    };
  } catch (error) {
    await daemon.stop();
    await removeDirectories();
    throw error;
  }
}

type WorkspaceCreation = { workspaceId: unknown } | { error: unknown };

async function createLocalWorkspace(client: McpClient, cwd: string): Promise<WorkspaceCreation> {
  const result = await client.callTool({
    name: "create_workspace",
    args: { isolation: "local", path: cwd },
  });
  if (result.isError) {
    const content = result.content?.[0];
    return { error: content && "text" in content ? content.text : undefined };
  }
  return { workspaceId: getStructuredContent(result)?.workspaceId };
}

async function listWorkspaces(client: McpClient): Promise<WorkspaceCreation[]> {
  const result = await client.callTool({ name: "list_workspaces", args: {} });
  const workspaces = getStructuredContent(result)?.workspaces;
  if (!Array.isArray(workspaces)) return [];
  return workspaces.map((workspace: StructuredContent) => ({ workspaceId: workspace.workspaceId }));
}

interface LaunchRecorder {
  recordedLaunches: AgentSessionConfig[];
}

class RecordingAgentClient implements AgentClient {
  readonly provider: AgentClient["provider"];
  readonly capabilities: AgentClient["capabilities"];

  constructor(
    private readonly inner: AgentClient,
    private readonly recorder: LaunchRecorder,
  ) {
    this.provider = inner.provider;
    this.capabilities = {
      ...inner.capabilities,
      supportsMcpServers: true,
      supportsNativePaseoTools: false,
    };
  }

  async createSession(
    ...args: Parameters<AgentClient["createSession"]>
  ): ReturnType<AgentClient["createSession"]> {
    this.recorder.recordedLaunches.push(args[0]);
    return this.inner.createSession(...args);
  }

  async resumeSession(
    ...args: Parameters<AgentClient["resumeSession"]>
  ): ReturnType<AgentClient["resumeSession"]> {
    return this.inner.resumeSession(...args);
  }

  async fetchCatalog(
    ...args: Parameters<AgentClient["fetchCatalog"]>
  ): ReturnType<AgentClient["fetchCatalog"]> {
    return this.inner.fetchCatalog(...args);
  }

  async isAvailable(): Promise<boolean> {
    return this.inner.isAvailable();
  }
}

function createMcpRecordingAgentClients(
  recorder: LaunchRecorder,
  options: Parameters<typeof createTestAgentClients>[0] = {},
) {
  const clients = createTestAgentClients(options);
  const claude = clients.claude;
  if (!claude) {
    throw new Error("Fake Claude client is not configured");
  }

  return {
    ...clients,
    claude: new RecordingAgentClient(claude, recorder),
  };
}

async function assertAgentNotRunning(options: {
  client: McpClient;
  agentId: string;
}): Promise<void> {
  const statusResult = await options.client.callTool({
    name: "get_agent_status",
    args: { agentId: options.agentId },
  });
  const payload = getStructuredContent(statusResult);
  if (!payload) {
    throw new Error("get_agent_status returned no structured payload");
  }
  const status = payload.status;
  if (status === "running" || status === "initializing") {
    throw new Error(`Agent still running after blocking create_agent (status=${status})`);
  }
}

/**
 * A scripted Claude Code query that reports `reportedModel` in its init message,
 * whatever model it was launched with. It then either holds the turn open until
 * closed or, with `completes`, answers and completes the turn at once.
 */
function claudeQueryReportingModel(
  reportedModel: string,
  launches: string[],
  options: { completes?: boolean } = {},
) {
  return ({ options: launch }: { options: { model?: string } }) => {
    launches.push(String(launch.model));
    const queued: Array<Record<string, unknown>> = [
      {
        type: "system",
        subtype: "init",
        session_id: "fixture-claude",
        permissionMode: "default",
        model: reportedModel,
      },
    ];
    if (options.completes) {
      queued.push(
        { type: "assistant", message: { content: "done" } },
        {
          type: "result",
          subtype: "success",
          session_id: "fixture-claude",
          usage: { input_tokens: 1, cache_read_input_tokens: 0, output_tokens: 1 },
          total_cost_usd: 0,
        },
      );
    }
    const closedRef = { value: options.completes === true };
    const waiters: Array<() => void> = [];
    const end = () => {
      closedRef.value = true;
      for (const wake of waiters.splice(0)) wake();
    };
    return {
      next: async () => {
        while (queued.length === 0 && !closedRef.value) {
          await new Promise<void>((resolve) => waiters.push(resolve));
        }
        const value = queued.shift();
        return value ? { done: false, value } : { done: true, value: undefined };
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

/** Where Claude Code first reports the model of a turn's model request. */
type ClaudeModelReport = "init" | "message_start" | "assistant";

interface ScriptedClaudeTurn {
  /** The model the turn's frames carry. */
  model: string;
  /** The first frame carrying it; earlier frames of the turn carry no model. */
  reportedBy: ClaudeModelReport;
}

interface HarnessGatewayCall {
  turn: number;
  /** The gateway's HTTP status, once it answered. */
  status: Promise<number>;
}

/**
 * A scripted Claude Code query that answers each prompt as a turn of
 * `turns[index]`: it replies, calls the `cluster` MCP server once the way
 * Claude Code runs a tool (an HTTP request to the configured URL, with the
 * configured headers, made by the harness while the turn runs), then replies
 * again and completes. `calls` records every call the harness made.
 */
function claudeQueryAnsweringTurns(
  turns: ScriptedClaudeTurn[],
  launches: string[],
  calls: HarnessGatewayCall[],
) {
  return ({
    prompt,
    options: launch,
  }: {
    prompt: AsyncIterable<unknown>;
    options: {
      model?: string;
      mcpServers?: Record<string, { url?: string; headers?: Record<string, string> }>;
    };
  }) => {
    launches.push(String(launch.model));
    const prompts = prompt[Symbol.asyncIterator]();
    const frames: Array<Record<string, unknown> | (() => Promise<void>)> = [];
    let turnIndex = 0;
    const state = { closed: false };
    const callCluster = (turn: number) => async () => {
      const cluster = launch.mcpServers?.cluster;
      if (!cluster?.url) throw new Error("The cluster MCP server was not launched");
      const status = fetch(cluster.url, {
        method: "POST",
        headers: { ...cluster.headers, "content-type": "application/json" },
        body: '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"pr_read"}}',
      }).then((response) => response.status);
      calls.push({ turn, status });
      await status;
    };
    const scriptTurn = (turn: number) => {
      const { model, reportedBy } = turns[turn] ?? { model: "", reportedBy: "init" };
      const modelFrom = (report: ClaudeModelReport) =>
        reportedBy === "init" ||
        (reportedBy === "message_start" && report !== "init") ||
        report === "assistant"
          ? { model }
          : {};
      const assistant = (id: string, content: unknown[]) => ({
        type: "assistant",
        parent_tool_use_id: null,
        session_id: "fixture-claude",
        message: { id, role: "assistant", ...modelFrom("assistant"), content },
      });
      frames.push(
        {
          type: "system",
          subtype: "init",
          session_id: "fixture-claude",
          permissionMode: "default",
          ...modelFrom("init"),
        },
        {
          type: "stream_event",
          parent_tool_use_id: null,
          session_id: "fixture-claude",
          event: {
            type: "message_start",
            message: { id: `msg-${turn}`, ...modelFrom("message_start") },
          },
        },
        assistant(`msg-${turn}`, [{ type: "text", text: "OK" }]),
        assistant(`msg-${turn}`, [
          { type: "tool_use", id: `toolu-${turn}`, name: "mcp__cluster__pr_read", input: {} },
        ]),
        // Claude Code runs the tool once its tool_use block is complete.
        callCluster(turn),
        {
          type: "user",
          parent_tool_use_id: null,
          session_id: "fixture-claude",
          message: {
            role: "user",
            content: [{ type: "tool_result", tool_use_id: `toolu-${turn}`, content: "[]" }],
          },
        },
        assistant(`msg-${turn}-after`, [{ type: "text", text: "The call succeeded." }]),
        {
          type: "result",
          subtype: "success",
          session_id: "fixture-claude",
          usage: { input_tokens: 1, cache_read_input_tokens: 0, output_tokens: 1 },
          total_cost_usd: 0,
        },
      );
    };
    return {
      next: async (): Promise<IteratorResult<Record<string, unknown>>> => {
        while (!state.closed) {
          const frame = frames.shift();
          if (typeof frame === "function") {
            await frame();
            continue;
          }
          if (frame) return { done: false, value: frame };
          const next = await prompts.next();
          if (next.done) break;
          scriptTurn(turnIndex++);
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

/** A Claude Code query the test feeds frame by frame. */
function claudeFrameQueue() {
  const frames: Array<Record<string, unknown>> = [];
  const state = { closed: false, wake: null as (() => void) | null };
  const close = () => {
    state.closed = true;
    state.wake?.();
  };
  return {
    push(frame: Record<string, unknown>) {
      frames.push(frame);
      state.wake?.();
    },
    next: async (): Promise<IteratorResult<Record<string, unknown>>> => {
      while (!state.closed && frames.length === 0) {
        await new Promise<void>((resolve) => {
          state.wake = resolve;
        });
      }
      const frame = frames.shift();
      return frame ? { done: false, value: frame } : { done: true, value: undefined };
    },
    return: async () => {
      close();
      return { done: true, value: undefined };
    },
    interrupt: async () => close(),
    close,
    applyFlagSettings: async () => undefined,
    setPermissionMode: async () => undefined,
    setModel: async () => undefined,
    supportedModels: async () => [],
    supportedCommands: async () => [],
    [Symbol.asyncIterator]() {
      return this;
    },
  };
}

type ModelReportKind =
  | { provider: "claude"; kind: ClaudeModelReport }
  | { provider: "codex"; kind: "model/rerouted" | "thread/settings/updated" };

interface BackendCall {
  /** The whole request body reached the backend, so its tool ran. */
  ranAfterRefusal: boolean | null;
}

/** The JSON-RPC error code of the gateway's refusal, on the wire. */
const MCP_GATEWAY_REFUSAL_CODE = -32003;

interface ToolAnswer {
  status: number;
  body: string;
  /** The answer's stream broke off instead of ending. */
  aborted: boolean;
}

/**
 * What the harness receives for one tool request, and `head`, which resolves
 * when the answer's head arrives. A request cut off with no answer has status 0.
 */
function readToolAnswer(
  request: http.ClientRequest,
): Promise<ToolAnswer> & { head: Promise<void> } {
  let headArrived = () => undefined as void;
  const head = new Promise<void>((resolve) => {
    headArrived = resolve;
  });
  const answer = new Promise<ToolAnswer>((resolve) => {
    request.on("response", (response) => {
      headArrived();
      const chunks: Buffer[] = [];
      let aborted = false;
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.on("aborted", () => {
        aborted = true;
      });
      response.on("error", () => {
        aborted = true;
      });
      response.on("close", () =>
        resolve({
          status: response.statusCode ?? 0,
          body: Buffer.concat(chunks).toString("utf8"),
          aborted: aborted || !response.complete,
        }),
      );
    });
    request.on("error", () => resolve({ status: 0, body: "", aborted: true }));
  });
  return Object.assign(answer, { head });
}

/**
 * A daemon in session mode whose one agent runs the real Claude or Codex
 * adapter on its member, with a `fixture` gateway backend that records when
 * each tool request's body completes. With `holdResponses`, the backend
 * answers only when `releaseResponses` is called.
 */
async function startReportingSession(provider: "claude" | "codex") {
  const member = provider === "claude" ? "claude-opus-5-5" : "gpt-6-astra";
  const switched = provider === "claude" ? "claude-sonnet-5-5" : "gpt-5.4";
  const queue = claudeFrameQueue();
  const appServer =
    provider === "codex"
      ? createFakeCodexAppServer({
          "thread/loaded/list": () => ({ data: ["thread-1"] }),
          "thread/unsubscribe": () => ({}),
          "turn/interrupt": () => ({}),
        })
      : null;
  const clients = createTestAgentClients({ supportsMcpServers: true });
  if (appServer) {
    clients.codex!.createSession = async (config, context) =>
      new CodexAppServerAgentSession(
        config,
        null,
        pino({ level: "silent" }),
        async () => appServer.child,
        {},
        false,
        false,
        false,
        context?.agentId,
      );
  } else {
    const claude = new ClaudeAgentClient({
      logger: pino({ level: "silent" }),
      resolveBinary: async () => "/fixture/claude",
      queryFactory: (() => queue) as never,
    });
    clients.claude!.createSession = claude.createSession.bind(claude);
  }

  const calls: BackendCall[] = [];
  const arrived: Array<() => void> = [];
  const held: Array<() => void> = [];
  let holdResponses = false;
  // With an early answer, the backend sends its 200 head before the body has arrived.
  let early: "event-stream" | "json" | null = null;
  let refused = () => false;
  const backend = http.createServer((req, res) => {
    const call: BackendCall = { ranAfterRefusal: null };
    calls.push(call);
    const answerType = early;
    if (answerType) {
      res.writeHead(200, {
        "content-type": answerType === "event-stream" ? "text/event-stream" : "application/json",
      });
      if (answerType === "event-stream") res.write(": stream open\n\n");
      else res.flushHeaders();
    }
    req.once("data", () => arrived.shift()?.());
    req.resume();
    req.on("end", () => {
      call.ranAfterRefusal = refused();
      const answer = () =>
        res.end(
          answerType === "event-stream"
            ? 'event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{}}\n\n'
            : '{"jsonrpc":"2.0","id":1,"result":{}}',
        );
      if (holdResponses) held.push(answer);
      else answer();
    });
  });
  await new Promise<void>((resolve) => backend.listen(0, "127.0.0.1", resolve));
  const backendPort = (backend.address() as net.AddressInfo).port;
  const running = await createTestPaseoDaemon({
    agentClients: clients,
    mcpGatewayBackends: { fixture: { url: `http://127.0.0.1:${backendPort}/mcp` } },
    sessionRuntime: {
      ...DEFAULT_SESSION_RUNTIME_CONFIG,
      timelineDrainMs: 200,
      identity: { member: `${provider}/${member}`, role: "implementer" },
    },
  });
  const manager = running.daemon.agentManager;
  const agent = await manager.createAgent(
    {
      provider,
      cwd: running.paseoHome,
      model: member,
      ...(provider === "codex" ? { modeId: "full-access" } : {}),
    },
    undefined,
    { workspaceId: undefined },
  );
  refused = () => manager.getSessionMemberRefusal(agent.id) !== null;
  const token = manager.issueAgentToken(agent.id);
  const url = `http://127.0.0.1:${running.port}/mcp/backends/fixture`;

  return {
    manager,
    agent,
    calls,
    refusal: `This session's member is ${provider}/${member}. This agent would run ${provider}/${switched}. A different model needs a new session.`,
    /** Starts a turn and waits until the harness runs it on the member. */
    startTurn: async () => {
      const turn = manager.runAgent(agent.id, "read two things").then(
        () => null,
        (error: Error) => error.message,
      );
      if (appServer) {
        await appServer.waitForTurnStart();
        appServer.startsTurn({ threadId: "thread-1", turnId: "turn-1" });
      } else {
        queue.push({
          type: "system",
          subtype: "init",
          session_id: "fixture-claude",
          permissionMode: "default",
          model: member,
        });
      }
      // Wrapped, so awaiting the start does not wait for the turn.
      return { ended: turn };
    },
    /** The harness reports the switched model the way `kind` does. */
    report: (kind: ModelReportKind["kind"]) => {
      const shared = { session_id: "fixture-claude", parent_tool_use_id: null };
      if (kind === "init") {
        queue.push({ ...shared, type: "system", subtype: "init", model: switched });
      } else if (kind === "message_start") {
        queue.push({
          ...shared,
          type: "stream_event",
          event: { type: "message_start", message: { id: "msg-switch", model: switched } },
        });
      } else if (kind === "assistant") {
        queue.push({
          ...shared,
          type: "assistant",
          message: { id: "msg-switch", model: switched, content: [{ type: "text", text: "OK" }] },
        });
      } else {
        const params =
          kind === "model/rerouted"
            ? { threadId: "thread-1", turnId: "turn-1", fromModel: member, toModel: switched }
            : {
                threadId: "thread-1",
                threadSettings: { model: switched, modelProvider: "openai" },
              };
        appServer!.child.stdout.write(`${JSON.stringify({ method: kind, params })}\n`);
      }
    },
    /** Tool requests whose whole body reached the backend before the refusal. */
    completedBeforeRefusal: () => calls.filter((call) => call.ranAfterRefusal === false).length,
    /** Waits until `count` whole tool requests reached the backend before the refusal. */
    wholeBodiesArrived: (count: number) =>
      vi.waitFor(() =>
        expect(calls.filter((call) => call.ranAfterRefusal === false)).toHaveLength(count),
      ),
    /** Tool requests whose whole body reached the backend after the refusal: their tool ran. */
    completedAfterRefusal: () => calls.filter((call) => call.ranAfterRefusal === true).length,
    holdResponses: () => {
      holdResponses = true;
    },
    /** The backend sends its 200 head at once, then holds its answer until released. */
    answerEarly: (answerType: "event-stream" | "json") => {
      early = answerType;
      holdResponses = true;
    },
    releaseResponses: () => {
      for (const answer of held.splice(0)) answer();
    },
    /**
     * Opens a tool request as the agent's harness and resolves once the backend
     * received its first bytes: the body's first half, or all of it.
     */
    openToolRequest: async (body: "streamed" | "complete") => {
      const payload = '{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"pr_read"}}';
      const reachedBackend = new Promise<void>((resolve) => arrived.push(resolve));
      const request = http.request(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
      });
      const answer = readToolAnswer(request);
      if (body === "complete") request.end(payload);
      else request.write(payload.slice(0, 40));
      await reachedBackend;
      return {
        answer,
        status: answer.then((received) => received.status),
        finish: () => request.end(payload.slice(40)),
      };
    },
    close: async () => {
      queue.close();
      await running.close();
      backend.closeAllConnections();
      await new Promise<void>((resolve) => backend.close(() => resolve()));
    },
  };
}

function recordHeadersAndAnswer(seen: http.IncomingHttpHeaders[]): http.RequestListener {
  return (req, res) => {
    seen.push(req.headers);
    req.resume();
    req.on("end", () => {
      res.writeHead(200, { "content-type": "application/json", "mcp-session-id": "s1" });
      res.end('{"jsonrpc":"2.0","id":1,"result":{}}');
    });
  };
}

describe("agent MCP end-to-end (offline)", () => {
  test("create_agent runs initial prompt and affects filesystem", async () => {
    const paseoHome = await mkdtemp(path.join(os.tmpdir(), "paseo-home-"));
    const staticDir = await mkdtemp(path.join(os.tmpdir(), "paseo-static-"));
    const agentCwd = await mkdtemp(path.join(os.tmpdir(), "paseo-agent-cwd-"));
    const port = await getAvailablePort();

    const daemonConfig: PaseoDaemonConfig = {
      listen: `127.0.0.1:${port}`,
      paseoHome,
      corsAllowedOrigins: [],
      hostnames: true,
      mcpEnabled: true,
      staticDir,
      mcpDebug: false,
      agentClients: createTestAgentClients(),
      agentStoragePath: path.join(paseoHome, "agents"),
    };

    const daemon = await createPaseoDaemon(daemonConfig, pino({ level: "silent" }));
    await daemon.start();

    const client = await createMcpClient(`http://127.0.0.1:${port}/mcp/agents`);

    let agentId: string | null = null;
    try {
      const filePath = path.join(agentCwd, "mcp-smoke.txt");
      await writeFile(filePath, "ok", "utf8");

      const initialPrompt = [
        "You must call the Bash command tool with the exact command `rm -f mcp-smoke.txt`.",
        "Run it and reply with done and stop.",
        "Do not respond before the command finishes.",
      ].join("\n");

      const result = await client.callTool({
        name: "create_agent",
        args: {
          cwd: agentCwd,
          title: "MCP e2e smoke",
          provider: "claude/claude-test-model",
          mode: "bypassPermissions",
          initialPrompt,
          background: false,
        },
      });

      const payload = getStructuredContent(result);
      agentId = typeof payload?.agentId === "string" ? payload.agentId : null;
      expect(agentId).toBeTruthy();

      await assertAgentNotRunning({ client, agentId: agentId! });

      if (existsSync(filePath)) {
        const contents = await readFile(filePath, "utf8");
        throw new Error(
          `Expected mcp-smoke.txt to be removed, but it still exists with contents: ${contents}`,
        );
      }
    } finally {
      if (agentId) {
        await client.callTool({ name: "kill_agent", args: { agentId } });
      }
      await client.close();
      await daemon.stop();
      await rm(paseoHome, { recursive: true, force: true });
      await rm(staticDir, { recursive: true, force: true });
      await rm(agentCwd, { recursive: true, force: true });
    }
  }, 30_000);

  test("create_workspace with local isolation adopts only an existing directory", async () => {
    const daemon = await startOfflineMcpDaemon();
    const root = await mkdtemp(path.join(os.tmpdir(), "paseo-local-workspace-"));
    const missingPath = path.join(root, "does-not-exist");
    const filePath = path.join(root, "regular-file");
    await writeFile(filePath, "not a directory\n", "utf8");
    try {
      expect(await createLocalWorkspace(daemon.client, missingPath)).toEqual({
        error: expect.stringContaining(`Directory not found: ${missingPath}`),
      });
      expect(await createLocalWorkspace(daemon.client, filePath)).toEqual({
        error: expect.stringContaining(`Directory not found: ${filePath}`),
      });
      const created = await createLocalWorkspace(daemon.client, root);
      expect(await listWorkspaces(daemon.client)).toEqual([created]);
    } finally {
      await daemon.stop();
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);

  test("password-protected daemon authorizes the agent MCP via the agent's own token", async () => {
    const paseoHome = await mkdtemp(path.join(os.tmpdir(), "paseo-home-"));
    const staticDir = await mkdtemp(path.join(os.tmpdir(), "paseo-static-"));
    const agentCwd = await mkdtemp(path.join(os.tmpdir(), "paseo-agent-cwd-"));
    const port = await getAvailablePort();

    const daemonConfig: PaseoDaemonConfig = {
      listen: `127.0.0.1:${port}`,
      paseoHome,
      corsAllowedOrigins: [],
      hostnames: true,
      mcpEnabled: true,
      staticDir,
      mcpDebug: false,
      agentClients: createTestAgentClients(),
      agentStoragePath: path.join(paseoHome, "agents"),
      auth: { password: hashDaemonPassword("daemon-secret") },
    };

    const daemon = await createPaseoDaemon(daemonConfig, pino({ level: "silent" }));
    await daemon.start();

    const mcpUrl = `http://127.0.0.1:${port}/mcp/agents`;
    const caller = await daemon.agentManager.createAgent(
      { provider: "claude", cwd: agentCwd, title: "Password MCP caller" },
      undefined,
      { workspaceId: undefined },
    );
    const agentToken = daemon.agentManager.issueAgentToken(caller.id);

    let client: McpClient | null = null;
    try {
      // A request without credentials, or with only a caller query parameter,
      // gets 401 before any MCP processing.
      const unauthorized = await fetch(mcpUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      expect(unauthorized.status).toBe(401);
      const claimed = await fetch(`${mcpUrl}?callerAgentId=${caller.id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      expect(claimed.status).toBe(401);

      // The agent's own token authenticates the full MCP handshake:
      // creating (and connecting) the client and driving a tool call both go
      // through the password-gated /mcp/agents route. (The exact bearer header
      // injected into a child agent's config is covered by the
      // runtime-mcp-config unit test.)
      client = await createMcpClient(mcpUrl, agentToken);
      const result = await client.callTool({
        name: "get_agent_status",
        args: { agentId: caller.id },
      });
      expect(result.isError).not.toBe(true);
      const snapshot = getStructuredContent(result)?.snapshot as StructuredContent | undefined;
      expect(snapshot?.id).toBe(caller.id);
    } finally {
      await client?.close();
      await daemon.stop();
      await rm(paseoHome, { recursive: true, force: true });
      await rm(staticDir, { recursive: true, force: true });
      await rm(agentCwd, { recursive: true, force: true });
    }
  }, 30_000);

  test("create_agent auto-injects paseo MCP by default and can be disabled", async () => {
    const paseoHome = await mkdtemp(path.join(os.tmpdir(), "paseo-home-"));
    const staticDir = await mkdtemp(path.join(os.tmpdir(), "paseo-static-"));
    const agentCwd = await mkdtemp(path.join(os.tmpdir(), "paseo-agent-cwd-"));
    const port = await getAvailablePort();
    const recorder: LaunchRecorder = { recordedLaunches: [] };

    const daemonConfig: PaseoDaemonConfig = {
      listen: `127.0.0.1:${port}`,
      paseoHome,
      corsAllowedOrigins: [],
      hostnames: true,
      mcpEnabled: true,
      staticDir,
      mcpDebug: false,
      agentClients: createMcpRecordingAgentClients(recorder),
      agentStoragePath: path.join(paseoHome, "agents"),
    };

    const daemon = await createPaseoDaemon(daemonConfig, pino({ level: "silent" }));
    await daemon.start();

    const client = await createMcpClient(`http://127.0.0.1:${port}/mcp/agents`);

    const disabledPaseoHome = await mkdtemp(path.join(os.tmpdir(), "paseo-home-disabled-"));
    const disabledStaticDir = await mkdtemp(path.join(os.tmpdir(), "paseo-static-disabled-"));
    const disabledAgentCwd = await mkdtemp(path.join(os.tmpdir(), "paseo-agent-cwd-disabled-"));
    const disabledPort = await getAvailablePort();
    const disabledRecorder: LaunchRecorder = { recordedLaunches: [] };
    const disabledDaemonConfig: PaseoDaemonConfig = {
      listen: `127.0.0.1:${disabledPort}`,
      paseoHome: disabledPaseoHome,
      corsAllowedOrigins: [],
      hostnames: true,
      mcpEnabled: true,
      mcpInjectIntoAgents: false,
      staticDir: disabledStaticDir,
      mcpDebug: false,
      agentClients: createMcpRecordingAgentClients(disabledRecorder),
      agentStoragePath: path.join(disabledPaseoHome, "agents"),
    };
    const disabledDaemon = await createPaseoDaemon(disabledDaemonConfig, pino({ level: "silent" }));
    await disabledDaemon.start();

    const disabledClient = await createMcpClient(`http://127.0.0.1:${disabledPort}/mcp/agents`);

    let agentId: string | null = null;
    let disabledAgentId: string | null = null;
    try {
      const result = await client.callTool({
        name: "create_agent",
        args: {
          cwd: agentCwd,
          title: "Injected MCP",
          provider: "claude/claude-test-model",
          mode: "bypassPermissions",
          initialPrompt: "reply with done and stop",
          background: true,
        },
      });
      const payload = getStructuredContent(result);
      agentId = typeof payload?.agentId === "string" ? payload.agentId : null;
      expect(agentId).toBeTruthy();

      // Utility agents (e.g. branch naming) may launch after it, so select by title.
      expect(
        recorder.recordedLaunches.find((launch) => launch.title === "Injected MCP")?.mcpServers,
      ).toMatchObject({
        paseo: {
          type: "http",
          url: `http://127.0.0.1:${port}/mcp/agents`,
          headers: { Authorization: `Bearer ${daemon.agentManager.issueAgentToken(agentId!)}` },
        },
      });
      const injectedAgent = daemon.agentManager.getAgent(agentId!);
      expect(injectedAgent?.config.mcpServers?.paseo).toBeUndefined();

      const disabledResult = await disabledClient.callTool({
        name: "create_agent",
        args: {
          cwd: disabledAgentCwd,
          title: "No injected MCP",
          provider: "claude/claude-test-model",
          mode: "bypassPermissions",
          initialPrompt: "reply with done and stop",
          background: true,
        },
      });
      const disabledPayload = getStructuredContent(disabledResult);
      disabledAgentId =
        typeof disabledPayload?.agentId === "string" ? disabledPayload.agentId : null;
      expect(disabledAgentId).toBeTruthy();

      expect(disabledRecorder.recordedLaunches.at(-1)?.mcpServers?.paseo).toBeUndefined();
      const disabledAgent = disabledDaemon.agentManager.getAgent(disabledAgentId!);
      expect(disabledAgent?.config.mcpServers?.paseo).toBeUndefined();
    } finally {
      if (agentId) {
        await client.callTool({ name: "kill_agent", args: { agentId } });
      }
      if (disabledAgentId) {
        await disabledClient.callTool({ name: "kill_agent", args: { agentId: disabledAgentId } });
      }
      await disabledClient.close();
      await disabledDaemon.stop();
      await rm(disabledPaseoHome, { recursive: true, force: true });
      await rm(disabledStaticDir, { recursive: true, force: true });
      await rm(disabledAgentCwd, { recursive: true, force: true });
      await client.close();
      await daemon.stop();
      await rm(paseoHome, { recursive: true, force: true });
      await rm(staticDir, { recursive: true, force: true });
      await rm(agentCwd, { recursive: true, force: true });
    }
  }, 30_000);

  test("create_agent injects a loopback MCP URL when the daemon listens on all interfaces", async () => {
    const paseoHome = await mkdtemp(path.join(os.tmpdir(), "paseo-home-"));
    const staticDir = await mkdtemp(path.join(os.tmpdir(), "paseo-static-"));
    const agentCwd = await mkdtemp(path.join(os.tmpdir(), "paseo-agent-cwd-"));
    const port = await getAvailablePort();
    const recorder: LaunchRecorder = { recordedLaunches: [] };

    const daemonConfig: PaseoDaemonConfig = {
      listen: `0.0.0.0:${port}`,
      paseoHome,
      corsAllowedOrigins: [],
      hostnames: true,
      mcpEnabled: true,
      staticDir,
      mcpDebug: false,
      agentClients: createMcpRecordingAgentClients(recorder),
      agentStoragePath: path.join(paseoHome, "agents"),
    };

    const daemon = await createPaseoDaemon(daemonConfig, pino({ level: "silent" }));
    await daemon.start();

    const client = await createMcpClient(`http://127.0.0.1:${port}/mcp/agents`);

    let agentId: string | null = null;
    try {
      const result = await client.callTool({
        name: "create_agent",
        args: {
          cwd: agentCwd,
          title: "Wildcard MCP",
          provider: "claude/claude-test-model",
          mode: "bypassPermissions",
          initialPrompt: "reply with done and stop",
          background: true,
        },
      });
      const payload = getStructuredContent(result);
      agentId = typeof payload?.agentId === "string" ? payload.agentId : null;
      expect(agentId).toBeTruthy();

      // Utility agents (e.g. branch naming) may launch after it, so select by title.
      expect(
        recorder.recordedLaunches.find((launch) => launch.title === "Wildcard MCP")?.mcpServers,
      ).toMatchObject({
        paseo: {
          type: "http",
          url: `http://127.0.0.1:${port}/mcp/agents`,
          headers: { Authorization: `Bearer ${daemon.agentManager.issueAgentToken(agentId!)}` },
        },
      });
      const injectedAgent = daemon.agentManager.getAgent(agentId!);
      expect(injectedAgent?.config.mcpServers?.paseo).toBeUndefined();
    } finally {
      if (agentId) {
        await client.callTool({ name: "kill_agent", args: { agentId } });
      }
      await client.close();
      await daemon.stop();
      await rm(paseoHome, { recursive: true, force: true });
      await rm(staticDir, { recursive: true, force: true });
      await rm(agentCwd, { recursive: true, force: true });
    }
  }, 30_000);

  test("create_agent with background initialPrompt reflects running state once the first turn starts", async () => {
    const paseoHome = await mkdtemp(path.join(os.tmpdir(), "paseo-home-"));
    const staticDir = await mkdtemp(path.join(os.tmpdir(), "paseo-static-"));
    const agentCwd = await mkdtemp(path.join(os.tmpdir(), "paseo-agent-cwd-"));
    const port = await getAvailablePort();

    const daemonConfig: PaseoDaemonConfig = {
      listen: `127.0.0.1:${port}`,
      paseoHome,
      corsAllowedOrigins: [],
      hostnames: true,
      mcpEnabled: true,
      staticDir,
      mcpDebug: false,
      agentClients: createTestAgentClients(),
      agentStoragePath: path.join(paseoHome, "agents"),
    };

    const daemon = await createPaseoDaemon(daemonConfig, pino({ level: "silent" }));
    await daemon.start();

    const client = await createMcpClient(`http://127.0.0.1:${port}/mcp/agents`);

    let agentId: string | null = null;
    try {
      const result = await client.callTool({
        name: "create_agent",
        args: {
          cwd: agentCwd,
          title: "MCP background create",
          provider: "codex/gpt-5.4-mini",
          mode: "full-access",
          initialPrompt: "Run exactly: sleep 30",
          background: true,
        },
      });

      const payload = getStructuredContent(result);
      agentId = typeof payload?.agentId === "string" ? payload.agentId : null;
      expect(agentId).toBeTruthy();
      expect(payload?.status).toBe("running");

      const statusResult = await client.callTool({
        name: "get_agent_status",
        args: { agentId },
      });
      const statusPayload = getStructuredContent(statusResult);
      expect(statusPayload?.status).toBe("running");
    } finally {
      if (agentId) {
        await client.callTool({ name: "kill_agent", args: { agentId } });
      }
      await client.close();
      await daemon.stop();
      await rm(paseoHome, { recursive: true, force: true });
      await rm(staticDir, { recursive: true, force: true });
      await rm(agentCwd, { recursive: true, force: true });
    }
  }, 30_000);

  test("create_agent propagates initial-turn start failure instead of returning success", async () => {
    class StartTurnFailureSession implements AgentSession {
      readonly provider = "codex" as const;
      readonly id = "mcp-start-turn-failure-session";
      readonly capabilities = {
        supportsStreaming: false,
        supportsSessionPersistence: true,
        supportsDynamicModes: false,
        supportsMcpServers: false,
        supportsReasoningStream: false,
        supportsToolInvocations: false,
        supportsRewindConversation: false,
        supportsRewindFiles: false,
        supportsRewindBoth: false,
      } as const;

      async run(): Promise<AgentRunResult> {
        return {
          sessionId: this.id,
          finalText: "",
          timeline: [],
        };
      }

      async startTurn(): Promise<{ turnId: string }> {
        throw new Error("Initial turn failed to start");
      }

      subscribe(_callback: (event: AgentStreamEvent) => void): () => void {
        return () => undefined;
      }

      async *streamHistory(): AsyncGenerator<AgentStreamEvent> {
        yield* [];
      }

      async getRuntimeInfo() {
        return {
          provider: "codex" as const,
          sessionId: this.id,
          model: "gpt-5.4-mini",
          modeId: "full-access",
        };
      }

      async getAvailableModes(): Promise<
        Array<{ id: string; label: string; description: string }>
      > {
        return [{ id: "full-access", label: "Full access", description: "No prompts" }];
      }

      async getCurrentMode(): Promise<string | null> {
        return "full-access";
      }

      async setMode(): Promise<void> {}

      getPendingPermissions() {
        return [];
      }

      async respondToPermission(): Promise<void> {}

      describePersistence(): AgentPersistenceHandle | null {
        return { provider: "codex", sessionId: this.id };
      }

      async interrupt(): Promise<void> {}

      async close(): Promise<void> {}
    }

    class StartTurnFailureClient implements AgentClient {
      readonly provider = "codex" as const;
      readonly capabilities = {
        supportsStreaming: false,
        supportsSessionPersistence: true,
        supportsDynamicModes: false,
        supportsMcpServers: false,
        supportsReasoningStream: false,
        supportsToolInvocations: false,
        supportsRewindConversation: false,
        supportsRewindFiles: false,
        supportsRewindBoth: false,
      } as const;

      async isAvailable(): Promise<boolean> {
        return true;
      }

      async fetchCatalog(): Promise<{
        models: Array<{ provider: "codex"; id: string; label: string; isDefault: boolean }>;
        modes: Array<{ id: string; label: string; description: string }>;
      }> {
        return {
          models: [
            {
              provider: "codex",
              id: "gpt-5.4-mini",
              label: "gpt-5.4-mini",
              isDefault: true,
            },
          ],
          modes: [{ id: "full-access", label: "Full access", description: "No prompts" }],
        };
      }

      async createSession(_config: AgentSessionConfig): Promise<AgentSession> {
        return new StartTurnFailureSession();
      }

      async resumeSession(
        _handle: AgentPersistenceHandle,
        _config?: Partial<AgentSessionConfig>,
      ): Promise<AgentSession> {
        return new StartTurnFailureSession();
      }
    }

    const paseoHome = await mkdtemp(path.join(os.tmpdir(), "paseo-home-"));
    const staticDir = await mkdtemp(path.join(os.tmpdir(), "paseo-static-"));
    const agentCwd = await mkdtemp(path.join(os.tmpdir(), "paseo-agent-cwd-"));
    const port = await getAvailablePort();

    const daemonConfig: PaseoDaemonConfig = {
      listen: `127.0.0.1:${port}`,
      paseoHome,
      corsAllowedOrigins: [],
      hostnames: true,
      mcpEnabled: true,
      staticDir,
      mcpDebug: false,
      agentClients: {
        ...createTestAgentClients(),
        codex: new StartTurnFailureClient(),
      },
      agentStoragePath: path.join(paseoHome, "agents"),
    };

    const daemon = await createPaseoDaemon(daemonConfig, pino({ level: "silent" }));
    await daemon.start();

    const client = await createMcpClient(`http://127.0.0.1:${port}/mcp/agents`);

    let agentId: string | null = null;
    try {
      const result = await client.callTool({
        name: "create_agent",
        args: {
          cwd: agentCwd,
          title: "MCP start failure",
          provider: "codex/gpt-5.4-mini",
          mode: "full-access",
          initialPrompt: "Run exactly: sleep 30",
          background: true,
        },
      });

      const payload = getStructuredContent(result);
      agentId = typeof payload?.agentId === "string" ? payload.agentId : null;
      expect(agentId).toBeTruthy();

      await assertAgentNotRunning({ client, agentId: agentId! });
      const statusResult = await client.callTool({
        name: "get_agent_status",
        args: { agentId },
      });
      const statusPayload = getStructuredContent(statusResult);
      expect(statusPayload?.status).toBe("error");
      const snapshot = statusPayload?.snapshot;
      const lastError =
        snapshot && typeof snapshot === "object" ? Reflect.get(snapshot, "lastError") : undefined;
      expect(lastError).toContain("Initial turn failed to start");
    } finally {
      if (agentId) {
        await client.callTool({ name: "kill_agent", args: { agentId } });
      }
      await client.close();
      await daemon.stop();
      await rm(paseoHome, { recursive: true, force: true });
      await rm(staticDir, { recursive: true, force: true });
      await rm(agentCwd, { recursive: true, force: true });
    }
  }, 30_000);

  test("create_agent with worktree is async and boots terminals only after setup success", async () => {
    const paseoHome = await mkdtemp(path.join(os.tmpdir(), "paseo-home-"));
    const staticDir = await mkdtemp(path.join(os.tmpdir(), "paseo-static-"));
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "paseo-worktree-repo-"));
    const port = await getAvailablePort();

    const daemonConfig: PaseoDaemonConfig = {
      listen: `127.0.0.1:${port}`,
      paseoHome,
      corsAllowedOrigins: [],
      hostnames: true,
      mcpEnabled: true,
      staticDir,
      mcpDebug: false,
      agentClients: createTestAgentClients(),
      agentStoragePath: path.join(paseoHome, "agents"),
    };

    const daemon = await createPaseoDaemon(daemonConfig, pino({ level: "silent" }));
    await daemon.start();

    const client = await createMcpClient(`http://127.0.0.1:${port}/mcp/agents`);

    let agentId: string | null = null;
    try {
      const { execSync } = await import("node:child_process");
      execSync("git init -b main", { cwd: repoRoot, stdio: "pipe" });
      execSync("git config user.email 'test@test.com'", { cwd: repoRoot, stdio: "pipe" });
      execSync("git config user.name 'Test'", { cwd: repoRoot, stdio: "pipe" });
      await writeFile(path.join(repoRoot, "file.txt"), "hello\n", "utf8");
      execSync("git add .", { cwd: repoRoot, stdio: "pipe" });
      execSync("git -c commit.gpgsign=false commit -m 'initial'", { cwd: repoRoot, stdio: "pipe" });

      const setupCommand =
        'while [ ! -f "$PASEO_WORKTREE_PATH/allow-setup" ]; do sleep 0.05; done; echo "done" > "$PASEO_WORKTREE_PATH/setup-done.txt"';
      await writeFile(
        path.join(repoRoot, "paseo.json"),
        JSON.stringify({
          worktree: {
            setup: [setupCommand],
            terminals: [
              {
                name: "Dev Server",
                command: 'echo "dev-server" > dev-terminal.txt; tail -f /dev/null',
              },
            ],
          },
        }),
        "utf8",
      );
      execSync("git add paseo.json", { cwd: repoRoot, stdio: "pipe" });
      execSync("git -c commit.gpgsign=false commit -m 'add worktree config'", {
        cwd: repoRoot,
        stdio: "pipe",
      });

      const result = await withTimeout({
        promise: client.callTool({
          name: "create_agent",
          args: {
            cwd: repoRoot,
            title: "MCP worktree setup terminals",
            provider: "claude/claude-test-model",
            mode: "bypassPermissions",
            initialPrompt: "say done and stop",
            worktreeName: "mcp-worktree-setup-test",
            baseBranch: "main",
            background: true,
          },
        }),
        timeoutMs: 2500,
        label: "create_agent should not block on setup",
      });

      const payload = getStructuredContent(result);
      agentId = typeof payload?.agentId === "string" ? payload.agentId : null;
      expect(agentId).toBeTruthy();
      const worktreePath = typeof payload?.cwd === "string" ? payload.cwd : "";
      expect(worktreePath).toContain(`${path.sep}worktrees${path.sep}`);
      expect(existsSync(path.join(worktreePath, "setup-done.txt"))).toBe(false);
      expect(existsSync(path.join(worktreePath, "dev-terminal.txt"))).toBe(false);

      await writeFile(path.join(worktreePath, "allow-setup"), "ok\n", "utf8");

      await waitForPathExists({
        targetPath: path.join(worktreePath, "setup-done.txt"),
        timeoutMs: 15000,
      });
      await waitForPathExists({
        targetPath: path.join(worktreePath, "dev-terminal.txt"),
        timeoutMs: 30000,
      });
    } finally {
      if (agentId) {
        await client.callTool({ name: "kill_agent", args: { agentId } });
      }
      await client.close();
      await daemon.stop();
      await rm(paseoHome, { recursive: true, force: true });
      await rm(staticDir, { recursive: true, force: true });
      await rm(repoRoot, { recursive: true, force: true });
    }
  }, 60_000);

  test("agents reach a configured MCP backend through the daemon gateway as themselves", async () => {
    const paseoHome = await mkdtemp(path.join(os.tmpdir(), "paseo-home-"));
    const staticDir = await mkdtemp(path.join(os.tmpdir(), "paseo-static-"));
    const agentCwd = await mkdtemp(path.join(os.tmpdir(), "paseo-agent-cwd-"));
    const port = await getAvailablePort();
    const recorder: LaunchRecorder = { recordedLaunches: [] };

    const seen: http.IncomingHttpHeaders[] = [];
    const backend = http.createServer(recordHeadersAndAnswer(seen));
    await new Promise<void>((resolve) => backend.listen(0, "127.0.0.1", resolve));
    const backendPort = (backend.address() as net.AddressInfo).port;

    const daemon = await createPaseoDaemon(
      {
        listen: `127.0.0.1:${port}`,
        paseoHome,
        corsAllowedOrigins: [],
        hostnames: true,
        mcpEnabled: true,
        staticDir,
        mcpDebug: false,
        agentClients: createMcpRecordingAgentClients(recorder, { supportsMcpServers: true }),
        agentStoragePath: path.join(paseoHome, "agents"),
        auth: { password: hashDaemonPassword("daemon-secret") },
        mcpGatewayBackends: { cluster: { url: `http://127.0.0.1:${backendPort}/mcp` } },
      },
      pino({ level: "silent" }),
    );
    await daemon.start();

    try {
      const gatewayConfig: AgentSessionConfig = {
        provider: "claude",
        cwd: agentCwd,
        mcpServers: {
          cluster: {
            type: "http",
            url: "{paseoMcpGatewayUrl}/cluster",
            headers: { Authorization: "Bearer {paseoAgentToken}" },
          },
        },
      };
      const first = await daemon.agentManager.createAgent(gatewayConfig, undefined, {
        workspaceId: undefined,
      });
      const firstLaunch = recorder.recordedLaunches.at(-1)?.mcpServers?.cluster;
      const second = await daemon.agentManager.createAgent(gatewayConfig, undefined, {
        workspaceId: undefined,
      });
      const secondLaunch = recorder.recordedLaunches.at(-1)?.mcpServers?.cluster;
      if (firstLaunch?.type !== "http" || secondLaunch?.type !== "http") {
        throw new Error("Gateway MCP entry was not launched as HTTP");
      }
      expect(firstLaunch.url).toBe(`http://127.0.0.1:${port}/mcp/backends/cluster`);

      // Call the gateway exactly as each launched agent would, adding
      // caller-supplied identity headers; the backend sees the daemon's.
      const callAs = (launch: { url: string; headers?: Record<string, string> }) =>
        fetch(launch.url, {
          method: "POST",
          headers: {
            ...launch.headers,
            "content-type": "application/json",
            "X-Paseo-Agent-ID": "caller-supplied-agent",
            "X-Paseo-Server-ID": "caller-supplied-server",
            "X-Paseo-Member": "claude/caller-supplied",
            "X-Paseo-Role": "validator",
          },
          body: '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}',
        });
      const firstResponse = await callAs(firstLaunch);
      const secondResponse = await callAs(secondLaunch);
      expect(firstResponse.status).toBe(200);
      expect(firstResponse.headers.get("mcp-session-id")).toBe("s1");
      expect(secondResponse.status).toBe(200);

      const status = await fetch(`http://127.0.0.1:${port}/api/status`, {
        headers: { Authorization: "Bearer daemon-secret" },
      });
      const { serverId } = (await status.json()) as { serverId: string };
      expect(seen.map((headers) => headers["x-paseo-agent-id"])).toEqual([first.id, second.id]);
      expect(seen.map((headers) => headers["x-paseo-server-id"])).toEqual([serverId, serverId]);
      expect(seen.every((headers) => headers.authorization === undefined)).toBe(true);
      // Outside session mode the daemon sends no member or role, and the caller's do not pass.
      expect(seen.every((headers) => headers["x-paseo-member"] === undefined)).toBe(true);
      expect(seen.every((headers) => headers["x-paseo-role"] === undefined)).toBe(true);

      // Neither the daemon password nor a missing token reaches a backend.
      const withPassword = await fetch(firstLaunch.url, {
        method: "POST",
        headers: { Authorization: "Bearer daemon-secret", "X-Paseo-Agent-ID": first.id },
        body: "{}",
      });
      expect(withPassword.status).toBe(401);
      const unknownBackend = await fetch(`http://127.0.0.1:${port}/mcp/backends/other`, {
        method: "POST",
        headers: firstLaunch.headers,
        body: "{}",
      });
      expect(unknownBackend.status).toBe(404);

      // A closed agent's token stops working.
      await daemon.agentManager.closeAgent(first.id);
      const afterClose = await callAs(firstLaunch);
      expect(afterClose.status).toBe(401);
      expect(seen).toHaveLength(2);
    } finally {
      await daemon.stop();
      backend.closeAllConnections();
      await new Promise<void>((resolve) => backend.close(() => resolve()));
      await rm(paseoHome, { recursive: true, force: true });
      await rm(staticDir, { recursive: true, force: true });
      await rm(agentCwd, { recursive: true, force: true });
    }
  }, 30_000);
  test("in session mode every agent reaches a gateway backend as the session's member and role", async () => {
    const paseoHome = await mkdtemp(path.join(os.tmpdir(), "paseo-home-"));
    const staticDir = await mkdtemp(path.join(os.tmpdir(), "paseo-static-"));
    const agentCwd = await mkdtemp(path.join(os.tmpdir(), "paseo-agent-cwd-"));
    const port = await getAvailablePort();
    const recorder: LaunchRecorder = { recordedLaunches: [] };

    const seen: http.IncomingHttpHeaders[] = [];
    const backend = http.createServer(recordHeadersAndAnswer(seen));
    await new Promise<void>((resolve) => backend.listen(0, "127.0.0.1", resolve));
    const backendPort = (backend.address() as net.AddressInfo).port;

    const daemon = await createPaseoDaemon(
      {
        listen: `127.0.0.1:${port}`,
        paseoHome,
        corsAllowedOrigins: [],
        hostnames: true,
        mcpEnabled: true,
        staticDir,
        mcpDebug: false,
        agentClients: createMcpRecordingAgentClients(recorder, { supportsMcpServers: true }),
        agentStoragePath: path.join(paseoHome, "agents"),
        auth: { password: hashDaemonPassword("daemon-secret") },
        mcpGatewayBackends: { cluster: { url: `http://127.0.0.1:${backendPort}/mcp` } },
        sessionRuntime: {
          ...DEFAULT_SESSION_RUNTIME_CONFIG,
          identity: { member: "claude/claude-opus-5-5", role: "implementer" },
        },
      },
      pino({ level: "silent" }),
    );
    await daemon.start();

    try {
      const gatewayConfig: AgentSessionConfig = {
        provider: "claude",
        cwd: agentCwd,
        mcpServers: {
          cluster: {
            type: "http",
            url: "{paseoMcpGatewayUrl}/cluster",
            headers: { Authorization: "Bearer {paseoAgentToken}" },
          },
        },
      };
      const create = (model: string) =>
        daemon.agentManager.createAgent({ ...gatewayConfig, model }, undefined, {
          workspaceId: undefined,
        });
      const first = await create("claude-opus-5-5");
      const firstLaunch = recorder.recordedLaunches.at(-1)?.mcpServers?.cluster;
      const second = await create("Claude-Opus-5-5");
      const secondLaunch = recorder.recordedLaunches.at(-1)?.mcpServers?.cluster;
      if (firstLaunch?.type !== "http" || secondLaunch?.type !== "http") {
        throw new Error("Gateway MCP entry was not launched as HTTP");
      }

      // Another model, or the member's [1m] variant, does not launch, and a running agent cannot switch to one.
      const refusal =
        "This session's member is claude/claude-opus-5-5. This agent would run claude/claude-opus-5-5[1m]. A different model needs a new session.";
      await expect(create("claude-opus-5-5[1m]")).rejects.toThrow(refusal);
      await expect(create("claude-sonnet-5-5")).rejects.toThrow(
        "This session's member is claude/claude-opus-5-5.",
      );
      await expect(
        daemon.agentManager.setAgentModel(first.id, "claude-sonnet-5-5"),
      ).rejects.toThrow("A different model needs a new session.");
      expect(recorder.recordedLaunches).toHaveLength(2);

      const callAs = (launch: { url: string; headers?: Record<string, string> }) =>
        fetch(launch.url, {
          method: "POST",
          headers: {
            ...launch.headers,
            "content-type": "application/json",
            "X-Paseo-Member": "codex/caller-supplied",
            "X-Paseo-Role": "infra",
          },
          body: '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}',
        });
      expect((await callAs(firstLaunch)).status).toBe(200);
      expect((await callAs(secondLaunch)).status).toBe(200);
      // A reloaded agent still calls as the session's member.
      await daemon.agentManager.reloadAgentSession(first.id);
      expect((await callAs(firstLaunch)).status).toBe(200);

      expect(seen.map((headers) => headers["x-paseo-agent-id"])).toEqual([
        first.id,
        second.id,
        first.id,
      ]);
      expect(seen.map((headers) => headers["x-paseo-member"])).toEqual([
        "claude/claude-opus-5-5",
        "claude/claude-opus-5-5",
        "claude/claude-opus-5-5",
      ]);
      expect(seen.map((headers) => headers["x-paseo-role"])).toEqual([
        "implementer",
        "implementer",
        "implementer",
      ]);
    } finally {
      await daemon.stop();
      backend.closeAllConnections();
      await new Promise<void>((resolve) => backend.close(() => resolve()));
      await rm(paseoHome, { recursive: true, force: true });
      await rm(staticDir, { recursive: true, force: true });
      await rm(agentCwd, { recursive: true, force: true });
    }
  }, 30_000);
  /**
   * A daemon in session mode as claude/claude-opus-5-5 whose Claude agents run the
   * real adapter over a scripted query that reports `reportedModel`.
   */
  async function startClaudeSession(reportedModel: string, options: { completes?: boolean } = {}) {
    const paseoHome = await mkdtemp(path.join(os.tmpdir(), "paseo-home-"));
    const staticDir = await mkdtemp(path.join(os.tmpdir(), "paseo-static-"));
    const agentCwd = await mkdtemp(path.join(os.tmpdir(), "paseo-agent-cwd-"));
    const port = await getAvailablePort();
    const seen: http.IncomingHttpHeaders[] = [];
    const backend = http.createServer(recordHeadersAndAnswer(seen));
    await new Promise<void>((resolve) => backend.listen(0, "127.0.0.1", resolve));
    const backendPort = (backend.address() as net.AddressInfo).port;

    const launches: string[] = [];
    const claude = new ClaudeAgentClient({
      logger: pino({ level: "silent" }),
      resolveBinary: async () => "/fixture/claude",
      queryFactory: claudeQueryReportingModel(reportedModel, launches, options) as never,
    });
    const clients = createTestAgentClients();
    clients.claude!.createSession = claude.createSession.bind(claude);

    const daemon = await createPaseoDaemon(
      {
        listen: `127.0.0.1:${port}`,
        paseoHome,
        corsAllowedOrigins: [],
        hostnames: true,
        mcpEnabled: true,
        staticDir,
        mcpDebug: false,
        agentClients: clients,
        agentStoragePath: path.join(paseoHome, "agents"),
        mcpGatewayBackends: { cluster: { url: `http://127.0.0.1:${backendPort}/mcp` } },
        sessionRuntime: {
          ...DEFAULT_SESSION_RUNTIME_CONFIG,
          identity: { member: "claude/claude-opus-5-5", role: "implementer" },
        },
      },
      pino({ level: "silent" }),
    );
    await daemon.start();
    const manager = daemon.agentManager;
    const agent = await manager.createAgent(
      { provider: "claude", cwd: agentCwd, model: "claude-opus-5-5" },
      undefined,
      { workspaceId: undefined },
    );
    const token = manager.issueAgentToken(agent.id);
    const states: Array<{ lifecycle: string; lastError?: string }> = [];
    manager.subscribe(
      (event) => {
        if (event.type === "agent_state") {
          states.push({ lifecycle: event.agent.lifecycle, lastError: event.agent.lastError });
        }
      },
      { agentId: agent.id, replayState: false },
    );
    return {
      daemon,
      manager,
      agent,
      launches,
      seen,
      states,
      callGateway: () =>
        fetch(`http://127.0.0.1:${port}/mcp/backends/cluster`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}',
        }),
      close: async () => {
        await daemon.stop();
        backend.closeAllConnections();
        await new Promise<void>((resolve) => backend.close(() => resolve()));
        await rm(paseoHome, { recursive: true, force: true });
        await rm(staticDir, { recursive: true, force: true });
        await rm(agentCwd, { recursive: true, force: true });
      },
    };
  }

  const SONNET_REFUSAL =
    "This session's member is claude/claude-opus-5-5. This agent would run claude/claude-sonnet-5-5. A different model needs a new session.";

  test("in session mode an agent whose harness switches to another model is stopped and the gateway refuses it", async () => {
    const session = await startClaudeSession("claude-sonnet-5-5");
    try {
      expect((await session.callGateway()).status).toBe(200);

      await expect(
        session.manager.runAgent(session.agent.id, "/model claude-sonnet-5-5"),
      ).rejects.toThrow(SONNET_REFUSAL);

      expect(session.launches).toEqual(["claude-opus-5-5"]);
      await vi.waitFor(() => expect(session.manager.getAgent(session.agent.id)).toBeNull());
      expect(session.manager.getSessionMemberRefusal(session.agent.id)).toBe(SONNET_REFUSAL);
      // Closing revoked the agent's token, so the gateway answers 401: a refusal too,
      // and nothing is forwarded. 403 is for a refused agent that still exists.
      expect((await session.callGateway()).status).toBe(401);
      expect(session.seen.map((headers) => headers["x-paseo-member"])).toEqual([
        "claude/claude-opus-5-5",
      ]);
    } finally {
      await session.close();
    }
  }, 30_000);

  test("in session mode the refusal survives a completion that races the agent's closing", async () => {
    // The harness reports Sonnet and completes the turn straight after.
    const session = await startClaudeSession("claude-sonnet-5-5", { completes: true });
    try {
      await expect(
        session.manager.runAgent(session.agent.id, "/model claude-sonnet-5-5"),
      ).rejects.toThrow(SONNET_REFUSAL);

      await vi.waitFor(() => expect(session.states.at(-1)?.lifecycle).toBe("closed"));
      expect(session.states.at(-1)).toEqual({ lifecycle: "closed", lastError: SONNET_REFUSAL });
      expect(await session.daemon.agentStorage.get(session.agent.id)).toMatchObject({
        lastError: SONNET_REFUSAL,
      });
    } finally {
      await session.close();
    }
  }, 30_000);

  /**
   * A daemon in session mode as claude/claude-opus-5-5 with one Claude agent,
   * launched on Opus with the `cluster` gateway backend, whose harness answers
   * each prompt as the next of `turns`.
   */
  async function startScriptedClaudeSession(turns: ScriptedClaudeTurn[]) {
    const paseoHome = await mkdtemp(path.join(os.tmpdir(), "paseo-home-"));
    const staticDir = await mkdtemp(path.join(os.tmpdir(), "paseo-static-"));
    const agentCwd = await mkdtemp(path.join(os.tmpdir(), "paseo-agent-cwd-"));
    const port = await getAvailablePort();
    const seen: http.IncomingHttpHeaders[] = [];
    const backend = http.createServer(recordHeadersAndAnswer(seen));
    await new Promise<void>((resolve) => backend.listen(0, "127.0.0.1", resolve));
    const backendPort = (backend.address() as net.AddressInfo).port;

    const launches: string[] = [];
    const calls: HarnessGatewayCall[] = [];
    const claude = new ClaudeAgentClient({
      logger: pino({ level: "silent" }),
      resolveBinary: async () => "/fixture/claude",
      queryFactory: claudeQueryAnsweringTurns(turns, launches, calls) as never,
    });
    const clients = createTestAgentClients({ supportsMcpServers: true });
    clients.claude!.createSession = claude.createSession.bind(claude);

    const daemon = await createPaseoDaemon(
      {
        listen: `127.0.0.1:${port}`,
        paseoHome,
        corsAllowedOrigins: [],
        hostnames: true,
        mcpEnabled: true,
        staticDir,
        mcpDebug: false,
        agentClients: clients,
        agentStoragePath: path.join(paseoHome, "agents"),
        mcpGatewayBackends: { cluster: { url: `http://127.0.0.1:${backendPort}/mcp` } },
        sessionRuntime: {
          ...DEFAULT_SESSION_RUNTIME_CONFIG,
          identity: { member: "claude/claude-opus-5-5", role: "implementer" },
        },
      },
      pino({ level: "silent" }),
    );
    await daemon.start();
    const manager = daemon.agentManager;
    const agent = await manager.createAgent(
      {
        provider: "claude",
        cwd: agentCwd,
        model: "claude-opus-5-5",
        mcpServers: {
          cluster: {
            type: "http",
            url: "{paseoMcpGatewayUrl}/cluster",
            headers: { Authorization: "Bearer {paseoAgentToken}" },
          },
        },
      },
      undefined,
      { workspaceId: undefined },
    );
    const token = manager.issueAgentToken(agent.id);
    const timeline: AgentStreamEvent[] = [];
    manager.subscribe(
      (event) => {
        if (event.type === "agent_stream" && event.event.type === "timeline") {
          timeline.push(event.event);
        }
      },
      { agentId: agent.id, replayState: false },
    );
    return {
      manager,
      agent,
      launches,
      callStatuses: async () =>
        Promise.all(calls.map(async (call) => ({ turn: call.turn, status: await call.status }))),
      seen,
      timelineTexts: () =>
        timeline.flatMap((event) =>
          event.type === "timeline" && "text" in event.item ? [event.item.text] : [],
        ),
      callGatewayAsAgent: () =>
        fetch(`http://127.0.0.1:${port}/mcp/backends/cluster`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}',
        }),
      close: async () => {
        await daemon.stop();
        backend.closeAllConnections();
        await new Promise<void>((resolve) => backend.close(() => resolve()));
        await rm(paseoHome, { recursive: true, force: true });
        await rm(staticDir, { recursive: true, force: true });
        await rm(agentCwd, { recursive: true, force: true });
      },
    };
  }

  test.each<ClaudeModelReport>(["init", "message_start", "assistant"])(
    "in session mode a turn whose harness reports another model by %s is stopped before its tool call reaches a backend",
    async (reportedBy) => {
      // The live G-15 sequence: an Opus turn, then `/model claude-sonnet-5-5` took
      // effect inside Claude Code, and the next turn runs Sonnet and calls a tool.
      const session = await startScriptedClaudeSession([
        { model: "claude-opus-5-5", reportedBy: "init" },
        { model: "claude-sonnet-5-5", reportedBy },
      ]);
      try {
        await session.manager.runAgent(session.agent.id, "read the open PRs");
        expect(await session.callStatuses()).toEqual([{ turn: 0, status: 200 }]);
        expect(session.seen).toHaveLength(1);

        await expect(
          session.manager.runAgent(session.agent.id, "reply OK, then read the open PRs"),
        ).rejects.toThrow(SONNET_REFUSAL);

        // Claude Code may be stopped before it calls the tool; a call it does make is
        // refused at the gateway. Either way nothing of the Sonnet turn reaches the backend.
        await vi.waitFor(() => expect(session.manager.getAgent(session.agent.id)).toBeNull());
        const sonnetCalls = (await session.callStatuses()).filter((call) => call.turn === 1);
        for (const call of sonnetCalls) expect([401, 403]).toContain(call.status);
        expect(session.seen).toHaveLength(1);
        expect(session.seen.map((headers) => headers["x-paseo-member"])).toEqual([
          "claude/claude-opus-5-5",
        ]);
        // The agent is stopped, the turn ended before its last reply, and the timeline says why.
        expect(session.manager.getSessionMemberRefusal(session.agent.id)).toBe(SONNET_REFUSAL);
        expect(session.timelineTexts()).toContainEqual(expect.stringContaining(SONNET_REFUSAL));
        expect(session.timelineTexts().filter((text) => text === "The call succeeded.")).toEqual([
          "The call succeeded.",
        ]);
        expect([401, 403]).toContain((await session.callGatewayAsAgent()).status);
        expect(session.seen).toHaveLength(1);
        expect(session.launches).toEqual(["claude-opus-5-5"]);
      } finally {
        await session.close();
      }
    },
    30_000,
  );

  const MODEL_REPORT_KINDS: ModelReportKind[] = [
    { provider: "claude", kind: "init" },
    { provider: "claude", kind: "message_start" },
    { provider: "claude", kind: "assistant" },
    { provider: "codex", kind: "model/rerouted" },
    { provider: "codex", kind: "thread/settings/updated" },
  ];

  const MODEL_REPORTS_BY_BODY: Array<ModelReportKind & { body: "streamed" | "complete" }> = [];
  for (const report of MODEL_REPORT_KINDS) {
    MODEL_REPORTS_BY_BODY.push(
      { provider: report.provider, kind: report.kind, body: "streamed" } as ModelReportKind & {
        body: "streamed";
      },
      { provider: report.provider, kind: report.kind, body: "complete" } as ModelReportKind & {
        body: "complete";
      },
    );
  }

  test.each(MODEL_REPORT_KINDS)(
    "in session mode tool requests a $provider agent streamed before its $kind report are cut off at the refusal",
    async ({ provider, kind }) => {
      // The harness already sent two tool requests of the switched turn, each with
      // part of its body, when the daemon reads the report of the other model.
      const session = await startReportingSession(provider);
      try {
        const turn = await session.startTurn();
        const requests = [
          await session.openToolRequest("streamed"),
          await session.openToolRequest("streamed"),
        ];

        session.report(kind);
        await vi.waitFor(() => expect(session.manager.getAgent(session.agent.id)).toBeNull());
        for (const request of requests) request.finish();

        expect(await Promise.all(requests.map((request) => request.status))).toEqual([403, 403]);
        expect(await turn.ended).toBe(session.refusal);
        // Neither body ever completed at the backend, so neither tool ran.
        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(session.calls).toEqual([{ ranAfterRefusal: null }, { ranAfterRefusal: null }]);
      } finally {
        await session.close();
      }
    },
    30_000,
  );

  test.each(MODEL_REPORT_KINDS)(
    "in session mode tool requests a $provider agent completed before its $kind report get the refusal, not the backend's answer",
    async ({ provider, kind }) => {
      // The backend has both whole requests but has not answered when the report arrives.
      const session = await startReportingSession(provider);
      try {
        const turn = await session.startTurn();
        session.holdResponses();
        const requests = [
          await session.openToolRequest("complete"),
          await session.openToolRequest("complete"),
        ];
        await vi.waitFor(() => expect(session.completedBeforeRefusal()).toBe(2));

        session.report(kind);
        await vi.waitFor(() => expect(session.manager.getAgent(session.agent.id)).toBeNull());
        session.releaseResponses();

        expect(await Promise.all(requests.map((request) => request.status))).toEqual([403, 403]);
        expect(await turn.ended).toBe(session.refusal);
        expect(session.calls).toEqual([{ ranAfterRefusal: false }, { ranAfterRefusal: false }]);
      } finally {
        await session.close();
      }
    },
    30_000,
  );

  test.each(MODEL_REPORTS_BY_BODY)(
    "in session mode a $provider agent's streamed tool answer already begun at its $kind report ends with the refusal as a JSON-RPC error ($body body)",
    async ({ provider, kind, body }) => {
      // The backend sent the 200 head of an event stream before the report, so
      // the status is out; the stream must end with the refusal, not break off.
      const session = await startReportingSession(provider);
      try {
        const turn = await session.startTurn();
        session.answerEarly("event-stream");
        const requests = [await session.openToolRequest(body), await session.openToolRequest(body)];
        await Promise.all(requests.map((request) => request.answer.head));
        await session.wholeBodiesArrived(body === "complete" ? 2 : 0);

        session.report(kind);
        await vi.waitFor(() => expect(session.manager.getAgent(session.agent.id)).toBeNull());
        if (body === "streamed") for (const request of requests) request.finish();
        session.releaseResponses();

        const refusalEvent = `event: message\ndata: ${JSON.stringify({
          jsonrpc: "2.0",
          id: 7,
          error: { code: MCP_GATEWAY_REFUSAL_CODE, message: session.refusal },
        })}\n\n`;
        for (const answer of await Promise.all(requests.map((request) => request.answer))) {
          expect(answer).toMatchObject({ status: 200, aborted: false });
          expect(answer.body.startsWith(": stream open\n\n")).toBe(true);
          expect(answer.body.endsWith(refusalEvent)).toBe(true);
          expect(answer.body).not.toContain('"result"');
        }
        expect(await turn.ended).toBe(session.refusal);
        expect(session.completedAfterRefusal()).toBe(0);
      } finally {
        await session.close();
      }
    },
    30_000,
  );

  test.each(MODEL_REPORTS_BY_BODY)(
    "in session mode a $provider agent's JSON tool answer whose head the backend sent before its $kind report is answered 403 ($body body)",
    async ({ provider, kind, body }) => {
      // The backend flushed a 200 JSON head early; the gateway holds a finite
      // answer until it is whole, so the refusal still decides the status.
      const session = await startReportingSession(provider);
      try {
        const turn = await session.startTurn();
        session.answerEarly("json");
        const requests = [await session.openToolRequest(body), await session.openToolRequest(body)];
        await session.wholeBodiesArrived(body === "complete" ? 2 : 0);

        session.report(kind);
        await vi.waitFor(() => expect(session.manager.getAgent(session.agent.id)).toBeNull());
        if (body === "streamed") for (const request of requests) request.finish();
        session.releaseResponses();

        for (const answer of await Promise.all(requests.map((request) => request.answer))) {
          expect(answer).toMatchObject({
            status: 403,
            body: JSON.stringify({ error: session.refusal }),
            aborted: false,
          });
        }
        expect(await turn.ended).toBe(session.refusal);
        expect(session.completedAfterRefusal()).toBe(0);
      } finally {
        await session.close();
      }
    },
    30_000,
  );

  test("in session mode the member's [1m] context variant is the same member", async () => {
    // Claude Code reports the 1M-context variant of the member; the adapter reads it as the member.
    const session = await startClaudeSession("claude-opus-5-5[1m]", { completes: true });
    try {
      await session.manager.runAgent(session.agent.id, "hello");

      expect(session.manager.getAgent(session.agent.id)?.runtimeInfo?.model).toBe(
        "claude-opus-5-5",
      );
      expect(session.manager.getSessionMemberRefusal(session.agent.id)).toBeNull();
      expect((await session.callGateway()).status).toBe(200);
      expect(session.seen.map((headers) => headers["x-paseo-member"])).toEqual([
        "claude/claude-opus-5-5",
      ]);
    } finally {
      await session.close();
    }
  }, 30_000);
});

/** The models each provider's agents are created with, and the one they are asked to switch to. */
const CREATION_MODEL = { claude: "claude-opus-5-5", codex: "gpt-6-astra" } as const;
const OTHER_MODEL = { claude: "claude-sonnet-5-5", codex: "gpt-5.4" } as const;
type PinnedProvider = keyof typeof CREATION_MODEL;
const PINNED_PROVIDERS: PinnedProvider[] = ["claude", "codex"];

function modelPinRefusal(pinned: string, attempted: string): string {
  return `This agent's model is ${pinned}. This agent would run ${attempted}. A different model needs a new session.`;
}

/** What the scripted harnesses were asked to run, in order. */
interface HarnessModelRecorder {
  /** Each Claude query's launch model. */
  claudeLaunches: string[];
  /** Each `query.setModel()` call. */
  claudeSetModels: Array<string | undefined>;
  /** The model a Claude turn reports, by turn across all queries; the launch model otherwise. */
  claudeReports: Array<string | undefined>;
  /** Every fake Codex app-server spawned, in order. */
  codexServers: FakeCodexAppServer[];
  /** Codex turns, by turn, that `model/rerouted` moves to another model. */
  codexReroutes: Array<string | undefined>;
}

/**
 * A scripted Claude Code query that answers each prompt as one turn whose init
 * reports the model it runs: its launch model, or the one `claudeReports`
 * names for the turn.
 */
function claudeQueryRecordingModels(recorder: HarnessModelRecorder) {
  return ({
    prompt,
    options: launch,
  }: {
    prompt: AsyncIterable<unknown>;
    options: { model?: string };
  }) => {
    recorder.claudeLaunches.push(String(launch.model));
    let model = String(launch.model);
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
          const reported = recorder.claudeReports.shift() ?? model;
          frames.push(
            {
              type: "system",
              subtype: "init",
              session_id: "fixture-claude",
              permissionMode: "default",
              model: reported,
            },
            { type: "assistant", message: { content: "OK" } },
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
      setModel: async (next?: string) => {
        recorder.claudeSetModels.push(next);
        if (next) model = next;
      },
      supportedModels: async () => [],
      supportedCommands: async () => [],
      [Symbol.asyncIterator]() {
        return this;
      },
    };
  };
}

/** The real Claude adapter over `claudeQueryRecordingModels`. */
function recordingClaudeClient(recorder: HarnessModelRecorder): ClaudeAgentClient {
  return new ClaudeAgentClient({
    logger: pino({ level: "silent" }),
    resolveBinary: async () => "/fixture/claude",
    queryFactory: claudeQueryRecordingModels(recorder) as never,
  });
}

/**
 * The real Codex adapter, each app-server a fake that runs every turn to
 * completion, rerouting it to another model first where `codexReroutes` says so.
 */
function recordingCodexClient(recorder: HarnessModelRecorder): CodexAppServerAgentClient {
  const client = new CodexAppServerAgentClient(pino({ level: "silent" }));
  const internals = asInternals<{
    goalsEnabledPromise: Promise<boolean> | null;
    autoReviewEnabledPromise: Promise<boolean> | null;
    spawnAppServer: () => Promise<FakeCodexAppServer["child"]>;
  }>(client);
  internals.goalsEnabledPromise = Promise.resolve(false);
  internals.autoReviewEnabledPromise = Promise.resolve(false);
  internals.spawnAppServer = async () => {
    const server: FakeCodexAppServer = createFakeCodexAppServer({
      "thread/unsubscribe": () => ({}),
      "turn/interrupt": () => ({}),
      "turn/start": (params) => {
        const sent = params as { threadId?: string; model?: string };
        const threadId = sent.threadId ?? "thread-1";
        const reroute = recorder.codexReroutes.shift();
        setTimeout(() => {
          server.startsTurn({ threadId, turnId: "turn-1" });
          if (reroute) {
            const rerouted = {
              threadId,
              turnId: "turn-1",
              fromModel: sent.model,
              toModel: reroute,
            };
            server.child.stdout.write(
              `${JSON.stringify({ method: "model/rerouted", params: rerouted })}\n`,
            );
          }
          server.completeTurn({ threadId });
        }, 10);
        return {};
      },
    });
    recorder.codexServers.push(server);
    return server.child;
  };
  return client;
}

function codexRequestModels(recorder: HarnessModelRecorder, method: string): unknown[] {
  return recorder.codexServers.flatMap((server) =>
    server
      .requests()
      .filter((message) => message.method === method)
      .map((message) => (message.params as { model?: unknown }).model),
  );
}

/** Every model the provider's harness was asked to run: launches and switches, or thread and turn starts. */
function modelsSentToHarness(recorder: HarnessModelRecorder, provider: PinnedProvider): unknown[] {
  return provider === "claude"
    ? [...recorder.claudeLaunches, ...recorder.claudeSetModels]
    : [
        ...codexRequestModels(recorder, "thread/start"),
        ...codexRequestModels(recorder, "turn/start"),
      ];
}

function createHarnessModelRecorder(): HarnessModelRecorder {
  return {
    claudeLaunches: [],
    claudeSetModels: [],
    claudeReports: [],
    codexServers: [],
    codexReroutes: [],
  };
}

/**
 * A daemon outside session mode, like the console's, whose Claude and Codex
 * agents run the real adapters over scripted harnesses. `paseoHome` lets a
 * second daemon start on the first one's state.
 */
async function startConsoleDaemon(paseoHome?: string) {
  const home = paseoHome ?? (await mkdtemp(path.join(os.tmpdir(), "paseo-home-")));
  const staticDir = await mkdtemp(path.join(os.tmpdir(), "paseo-static-"));
  const agentCwd = path.join(home, "agent-cwd");
  await mkdir(agentCwd, { recursive: true });
  const port = await getAvailablePort();
  const recorder = createHarnessModelRecorder();
  const claude = recordingClaudeClient(recorder);
  const codex = recordingCodexClient(recorder);
  const clients = createTestAgentClients();
  clients.claude!.createSession = claude.createSession.bind(claude);
  clients.claude!.resumeSession = claude.resumeSession.bind(claude);
  clients.codex!.createSession = codex.createSession.bind(codex);
  clients.codex!.resumeSession = codex.resumeSession.bind(codex);

  const daemon = await createPaseoDaemon(
    {
      listen: `127.0.0.1:${port}`,
      paseoHome: home,
      corsAllowedOrigins: [],
      hostnames: true,
      mcpEnabled: true,
      staticDir,
      mcpDebug: false,
      agentClients: clients,
      agentStoragePath: path.join(home, "agents"),
    },
    pino({ level: "silent" }),
  );
  await daemon.start();
  const manager = daemon.agentManager;
  return {
    daemon,
    manager,
    recorder,
    home,
    agentCwd,
    createAgent: (provider: PinnedProvider, model: string) =>
      manager.createAgent(
        {
          provider,
          cwd: agentCwd,
          model,
          ...(provider === "codex" ? { modeId: "full-access" } : {}),
        },
        undefined,
        { workspaceId: undefined },
      ),
    load: (agentId: string) =>
      ensureAgentLoaded(agentId, {
        agentManager: manager,
        agentStorage: daemon.agentStorage,
        logger: pino({ level: "silent" }),
      }),
    /** Stops the daemon and keeps its state for another. */
    stop: async () => {
      await daemon.stop();
      await rm(staticDir, { recursive: true, force: true });
    },
    close: async () => {
      await daemon.stop();
      await rm(staticDir, { recursive: true, force: true });
      await rm(home, { recursive: true, force: true });
    },
  };
}

describe("console daemon: an agent keeps the model it was created with (outside session mode)", () => {
  test.each(PINNED_PROVIDERS)(
    "a model switch is refused and the %s agent keeps running on its creation model",
    async (provider) => {
      const host = await startConsoleDaemon();
      try {
        const agent = await host.createAgent(provider, CREATION_MODEL[provider]);
        await host.manager.runAgent(agent.id, "hello");

        await expect(host.manager.setAgentModel(agent.id, OTHER_MODEL[provider])).rejects.toThrow(
          modelPinRefusal(CREATION_MODEL[provider], OTHER_MODEL[provider]),
        );

        // Nothing changed: the agent, its configuration and its runtime are as they were.
        const after = host.manager.getAgent(agent.id);
        expect(after?.lifecycle).toBe("idle");
        expect(after?.lastError).toBeUndefined();
        expect(after?.config.model).toBe(CREATION_MODEL[provider]);
        expect(after?.runtimeInfo?.model).toBe(CREATION_MODEL[provider]);
        expect(host.manager.getSessionMemberRefusal(agent.id)).toBeNull();

        await host.manager.runAgent(agent.id, "hello again");
        // The harness was never asked to run the other model.
        const sent = modelsSentToHarness(host.recorder, provider);
        expect(sent.length).toBeGreaterThan(0);
        expect(sent.every((model) => model === CREATION_MODEL[provider])).toBe(true);
        if (provider === "claude") expect(host.recorder.claudeSetModels).toEqual([]);
        if (provider === "codex") {
          expect(codexRequestModels(host.recorder, "turn/start")).toEqual([
            CREATION_MODEL.codex,
            CREATION_MODEL.codex,
          ]);
        }
      } finally {
        await host.close();
      }
    },
    30_000,
  );

  test.each(PINNED_PROVIDERS)(
    "switching a %s agent to the model it already runs is allowed",
    async (provider) => {
      const host = await startConsoleDaemon();
      try {
        const agent = await host.createAgent(provider, CREATION_MODEL[provider]);
        await host.manager.runAgent(agent.id, "hello");

        await host.manager.setAgentModel(agent.id, CREATION_MODEL[provider]);
        await host.manager.runAgent(agent.id, "hello again");

        expect(host.manager.getAgent(agent.id)?.config.model).toBe(CREATION_MODEL[provider]);
        const sent = modelsSentToHarness(host.recorder, provider);
        expect(sent.every((model) => model === CREATION_MODEL[provider])).toBe(true);
        if (provider === "claude") {
          expect(host.recorder.claudeSetModels).toEqual([CREATION_MODEL.claude]);
        }
      } finally {
        await host.close();
      }
    },
    30_000,
  );

  test.each(PINNED_PROVIDERS)(
    "a new %s agent may start on any model",
    async (provider) => {
      const host = await startConsoleDaemon();
      try {
        const first = await host.createAgent(provider, CREATION_MODEL[provider]);
        await host.manager.runAgent(first.id, "hello");
        const second = await host.createAgent(provider, OTHER_MODEL[provider]);
        await host.manager.runAgent(second.id, "hello");

        expect(host.manager.getAgent(second.id)?.runtimeInfo?.model).toBe(OTHER_MODEL[provider]);
        // Each agent is held to its own creation model.
        await expect(
          host.manager.setAgentModel(second.id, CREATION_MODEL[provider]),
        ).rejects.toThrow(modelPinRefusal(OTHER_MODEL[provider], CREATION_MODEL[provider]));
        await expect(host.manager.setAgentModel(first.id, OTHER_MODEL[provider])).rejects.toThrow(
          modelPinRefusal(CREATION_MODEL[provider], OTHER_MODEL[provider]),
        );
      } finally {
        await host.close();
      }
    },
    30_000,
  );

  test.each(PINNED_PROVIDERS)(
    "a %s agent's creation model holds across a reload",
    async (provider) => {
      const host = await startConsoleDaemon();
      try {
        const agent = await host.createAgent(provider, CREATION_MODEL[provider]);
        await host.manager.runAgent(agent.id, "hello");
        await host.manager.reloadAgentSession(agent.id);

        const refusal = modelPinRefusal(CREATION_MODEL[provider], OTHER_MODEL[provider]);
        await expect(host.manager.setAgentModel(agent.id, OTHER_MODEL[provider])).rejects.toThrow(
          refusal,
        );
        // A reload onto another model is refused before it replaces the session.
        await expect(
          host.manager.reloadAgentSession(agent.id, { model: OTHER_MODEL[provider] }),
        ).rejects.toThrow(refusal);
        expect(host.manager.getAgent(agent.id)?.lifecycle).toBe("idle");

        await host.manager.runAgent(agent.id, "hello again");
        const sent = modelsSentToHarness(host.recorder, provider);
        expect(sent.every((model) => model === CREATION_MODEL[provider])).toBe(true);
      } finally {
        await host.close();
      }
    },
    30_000,
  );

  test.each(PINNED_PROVIDERS)(
    "a %s agent's creation model is recorded and holds after a daemon restart",
    async (provider) => {
      const first = await startConsoleDaemon();
      const agent = await first.createAgent(provider, CREATION_MODEL[provider]);
      await first.manager.runAgent(agent.id, "hello");
      await first.stop();

      const second = await startConsoleDaemon(first.home);
      try {
        expect(await second.daemon.agentStorage.get(agent.id)).toMatchObject({
          creationModel: CREATION_MODEL[provider],
        });
        await second.load(agent.id);

        await expect(second.manager.setAgentModel(agent.id, OTHER_MODEL[provider])).rejects.toThrow(
          modelPinRefusal(CREATION_MODEL[provider], OTHER_MODEL[provider]),
        );
        await second.manager.runAgent(agent.id, "hello again");
        const sent = modelsSentToHarness(second.recorder, provider);
        expect(sent.length).toBeGreaterThan(0);
        expect(sent.every((model) => model === CREATION_MODEL[provider])).toBe(true);
      } finally {
        await second.close();
      }
    },
    30_000,
  );

  test.each(PINNED_PROVIDERS)(
    "a %s agent whose harness reports another model is stopped",
    async (provider) => {
      const host = await startConsoleDaemon();
      try {
        const agent = await host.createAgent(provider, CREATION_MODEL[provider]);
        // The second turn runs another model: `/model` inside Claude Code, a Codex reroute.
        host.recorder.claudeReports.push(undefined, OTHER_MODEL.claude);
        host.recorder.codexReroutes.push(undefined, OTHER_MODEL.codex);
        await host.manager.runAgent(agent.id, "hello");

        const refusal = modelPinRefusal(CREATION_MODEL[provider], OTHER_MODEL[provider]);
        await expect(host.manager.runAgent(agent.id, "hello again")).rejects.toThrow(refusal);

        await vi.waitFor(() => expect(host.manager.getAgent(agent.id)).toBeNull());
        expect(host.manager.getSessionMemberRefusal(agent.id)).toBe(refusal);
        // Closing drops the live agent before it writes the closed record.
        await vi.waitFor(async () =>
          expect(await host.daemon.agentStorage.get(agent.id)).toMatchObject({
            lastStatus: "closed",
            lastError: refusal,
          }),
        );
      } finally {
        await host.close();
      }
    },
    30_000,
  );

  test("a Claude agent created on a legacy alias keeps running when its runtime reports the canonical id", async () => {
    // claude-fable-5[1m] is a retired spelling of claude-fable-5; Claude Code reports the canonical id.
    const host = await startConsoleDaemon();
    try {
      const agent = await host.createAgent("claude", "claude-fable-5[1m]");
      host.recorder.claudeReports.push("claude-fable-5", "claude-fable-5");
      await host.manager.runAgent(agent.id, "hello");
      await host.manager.runAgent(agent.id, "hello again");

      expect(host.manager.getSessionMemberRefusal(agent.id)).toBeNull();
      expect(host.manager.getAgent(agent.id)).toMatchObject({
        lifecycle: "idle",
        creationModel: "claude-fable-5[1m]",
      });
      // Another model is still refused.
      await expect(host.manager.setAgentModel(agent.id, OTHER_MODEL.claude)).rejects.toThrow(
        modelPinRefusal("claude-fable-5[1m]", OTHER_MODEL.claude),
      );
    } finally {
      await host.close();
    }
  }, 30_000);

  test("a pinned Claude session never calls query.setModel() for another model", async () => {
    const recorder = createHarnessModelRecorder();
    const client = recordingClaudeClient(recorder);
    const cwd = await mkdtemp(path.join(os.tmpdir(), "paseo-agent-cwd-"));
    const session = await client.createSession(
      { provider: "claude", cwd, model: CREATION_MODEL.claude },
      { agentId: "agent-1", modelPin: CREATION_MODEL.claude },
    );
    try {
      await expect(session.setModel?.(OTHER_MODEL.claude)).rejects.toThrow(
        modelPinRefusal(CREATION_MODEL.claude, OTHER_MODEL.claude),
      );
      // Refused before the query starts or is told anything.
      expect(recorder.claudeLaunches).toEqual([]);
      expect(recorder.claudeSetModels).toEqual([]);

      await session.setModel?.(CREATION_MODEL.claude);
      expect(recorder.claudeSetModels).toEqual([CREATION_MODEL.claude]);
    } finally {
      await session.close();
      await rm(cwd, { recursive: true, force: true });
    }
  }, 30_000);

  test("a pinned Codex session refuses a model switch and its next turn/start runs the pin", async () => {
    const recorder = createHarnessModelRecorder();
    const client = recordingCodexClient(recorder);
    const cwd = await mkdtemp(path.join(os.tmpdir(), "paseo-agent-cwd-"));
    const session = await client.createSession(
      { provider: "codex", cwd, model: CREATION_MODEL.codex, modeId: "full-access" },
      { agentId: "agent-1", modelPin: CREATION_MODEL.codex },
    );
    try {
      await expect(session.setModel?.(OTHER_MODEL.codex)).rejects.toThrow(
        modelPinRefusal(CREATION_MODEL.codex, OTHER_MODEL.codex),
      );
      await session.run("hello");
      expect(codexRequestModels(recorder, "turn/start")).toEqual([CREATION_MODEL.codex]);
    } finally {
      await session.close();
      await rm(cwd, { recursive: true, force: true });
    }
  }, 30_000);

  test("a pinned Codex session sends no turn/start for another model", async () => {
    // A resumed thread whose recorded configuration names another model than the pin.
    const recorder = createHarnessModelRecorder();
    const client = recordingCodexClient(recorder);
    const cwd = await mkdtemp(path.join(os.tmpdir(), "paseo-agent-cwd-"));
    const session = await client.resumeSession(
      {
        provider: "codex",
        sessionId: "thread-1",
        metadata: { provider: "codex", cwd, model: OTHER_MODEL.codex, modeId: "full-access" },
      },
      { cwd },
      { agentId: "agent-1", modelPin: CREATION_MODEL.codex },
    );
    try {
      await expect(session.startTurn("hello")).rejects.toThrow(
        modelPinRefusal(CREATION_MODEL.codex, OTHER_MODEL.codex),
      );
      expect(codexRequestModels(recorder, "turn/start")).toEqual([]);
    } finally {
      await session.close();
      await rm(cwd, { recursive: true, force: true });
    }
  }, 30_000);

  test("a pinned Codex session starts no thread on another model", async () => {
    const recorder = createHarnessModelRecorder();
    const client = recordingCodexClient(recorder);
    const cwd = await mkdtemp(path.join(os.tmpdir(), "paseo-agent-cwd-"));
    const session = await client.createSession(
      { provider: "codex", cwd, model: OTHER_MODEL.codex, modeId: "full-access" },
      { agentId: "agent-1", modelPin: CREATION_MODEL.codex },
    );
    try {
      await expect(session.startTurn("hello")).rejects.toThrow(
        modelPinRefusal(CREATION_MODEL.codex, OTHER_MODEL.codex),
      );
      expect(codexRequestModels(recorder, "thread/start")).toEqual([]);
      expect(codexRequestModels(recorder, "turn/start")).toEqual([]);
    } finally {
      await session.close();
      await rm(cwd, { recursive: true, force: true });
    }
  }, 30_000);
});
