import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { describe, expect, test, vi } from "vitest";
import { experimental_createMCPClient } from "ai";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import pino from "pino";

import { withTimeout } from "../../utils/promise-timeout.js";
import { hashDaemonPassword } from "../auth.js";
import { createPaseoDaemon, type PaseoDaemonConfig } from "../bootstrap.js";
import { DEFAULT_SESSION_RUNTIME_CONFIG } from "../session-runtime-config.js";
import { createTestAgentClients } from "../test-utils/fake-agent-client.js";
import { ClaudeAgentClient } from "./providers/claude/agent.js";
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
 * whatever model it was launched with, then holds the turn open until closed.
 */
function claudeQueryReportingModel(reportedModel: string, launches: string[]) {
  return ({ options }: { options: { model?: string } }) => {
    launches.push(String(options.model));
    const queued: Array<Record<string, unknown>> = [
      {
        type: "system",
        subtype: "init",
        session_id: "fixture-claude",
        permissionMode: "default",
        model: reportedModel,
      },
    ];
    const closedRef = { value: false };
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
  test("in session mode an agent whose harness switches to another model is stopped and the gateway refuses it", async () => {
    const paseoHome = await mkdtemp(path.join(os.tmpdir(), "paseo-home-"));
    const staticDir = await mkdtemp(path.join(os.tmpdir(), "paseo-static-"));
    const agentCwd = await mkdtemp(path.join(os.tmpdir(), "paseo-agent-cwd-"));
    const port = await getAvailablePort();

    const seen: http.IncomingHttpHeaders[] = [];
    const backend = http.createServer(recordHeadersAndAnswer(seen));
    await new Promise<void>((resolve) => backend.listen(0, "127.0.0.1", resolve));
    const backendPort = (backend.address() as net.AddressInfo).port;

    // The real Claude adapter, launched as Opus, whose harness reports Sonnet mid-turn.
    const launches: string[] = [];
    const claude = new ClaudeAgentClient({
      logger: pino({ level: "silent" }),
      resolveBinary: async () => "/fixture/claude",
      queryFactory: claudeQueryReportingModel("claude-sonnet-5-5", launches) as never,
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

    try {
      const manager = daemon.agentManager;
      const agent = await manager.createAgent(
        { provider: "claude", cwd: agentCwd, model: "claude-opus-5-5" },
        undefined,
        { workspaceId: undefined },
      );
      const token = manager.issueAgentToken(agent.id);
      const callGateway = () =>
        fetch(`http://127.0.0.1:${port}/mcp/backends/cluster`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}',
        });
      expect((await callGateway()).status).toBe(200);

      const refusal =
        "This session's member is claude/claude-opus-5-5. This agent would run claude/claude-sonnet-5-5. A different model needs a new session.";
      await expect(manager.runAgent(agent.id, "/model claude-sonnet-5-5")).rejects.toThrow(refusal);

      expect(launches).toEqual(["claude-opus-5-5"]);
      await vi.waitFor(() => expect(manager.getAgent(agent.id)).toBeNull());
      expect(manager.getSessionMemberRefusal(agent.id)).toBe(refusal);
      expect((await callGateway()).status).not.toBe(200);
      expect(seen.map((headers) => headers["x-paseo-member"])).toEqual(["claude/claude-opus-5-5"]);
    } finally {
      await daemon.stop();
      backend.closeAllConnections();
      await new Promise<void>((resolve) => backend.close(() => resolve()));
      await rm(paseoHome, { recursive: true, force: true });
      await rm(staticDir, { recursive: true, force: true });
      await rm(agentCwd, { recursive: true, force: true });
    }
  }, 30_000);
});
