import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import { createTestLogger } from "../../../test-utils/test-logger.js";
import type { AgentLaunchContext } from "../agent-sdk-types.js";
import { ClaudeAgentClient } from "./claude/agent.js";
import { CodexAppServerAgentClient } from "./codex-app-server-agent.js";

const AGENT_TOKEN = "per-agent-token-proxy-5d1a";
const PROXY_CREDENTIAL = "proxy-user:proxy-secret";

interface StandIn {
  url: string;
  requests: Array<{ method: string; url: string; authorization?: string; apiKey?: string }>;
  connects: number;
}

const closers: Array<() => Promise<void>> = [];
const roots: string[] = [];
const savedEnv = new Map<string, string | undefined>();

afterEach(async () => {
  for (const [name, value] of savedEnv) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  savedEnv.clear();
  while (closers.length > 0) await closers.pop()!();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function setDaemonEnv(values: Record<string, string>): void {
  for (const [name, value] of Object.entries(values)) {
    if (!savedEnv.has(name)) savedEnv.set(name, process.env[name]);
    process.env[name] = value;
  }
}

async function listen(server: http.Server, standIn: Omit<StandIn, "url">): Promise<StandIn> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  closers.push(
    () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  );
  const { port } = server.address() as AddressInfo;
  return Object.assign(standIn, { url: `http://127.0.0.1:${port}` });
}

/** The daemon's gateway stand-in: records each model request and answers it. */
async function startGateway(answer: { status: number; body: string }): Promise<StandIn> {
  const state: Omit<StandIn, "url"> = { requests: [], connects: 0 };
  const server = http.createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      state.requests.push({
        method: req.method ?? "",
        url: req.url ?? "",
        authorization: req.headers.authorization,
        apiKey: req.headers["x-api-key"] as string | undefined,
      });
      // Connectivity probes (HEAD) succeed; model requests get the configured answer.
      if (req.method === "HEAD") {
        res.writeHead(200);
        res.end();
        return;
      }
      res.writeHead(answer.status, { "content-type": "application/json" });
      res.end(answer.body);
    });
  });
  return listen(server, state);
}

/** An authenticated forward proxy stand-in: it refuses everything and counts each attempt. */
async function startProxy(): Promise<StandIn> {
  const state: Omit<StandIn, "url"> = { requests: [], connects: 0 };
  const server = http.createServer((req, res) => {
    state.requests.push({ method: req.method ?? "", url: req.url ?? "" });
    res.writeHead(407, { "proxy-authenticate": 'Basic realm="stand-in"' });
    res.end();
  });
  server.on("connect", (_req, socket) => {
    state.connects += 1;
    socket.end("HTTP/1.1 407 Proxy Authentication Required\r\n\r\n");
  });
  const proxy = await listen(server, state);
  return proxy;
}

/** Points every proxy variable, in every case, at the stand-in, and excludes nothing. */
function inheritProxy(proxy: StandIn): void {
  const proxyUrl = proxy.url.replace("http://", `http://${PROXY_CREDENTIAL}@`);
  setDaemonEnv({
    HTTP_PROXY: proxyUrl,
    http_proxy: proxyUrl,
    HTTPS_PROXY: proxyUrl,
    https_proxy: proxyUrl,
    ALL_PROXY: proxyUrl,
    all_proxy: proxyUrl,
    NO_PROXY: "example.invalid",
    no_proxy: "example.invalid",
  });
}

function createRoot(name: string): string {
  const root = mkdtempSync(join(tmpdir(), `paseo-gateway-proxy-${name}-`));
  roots.push(root);
  return root;
}

function gatewayLaunch(
  gateway: StandIn,
  cwd: string,
  envPassthrough: string[] = [],
): AgentLaunchContext {
  return {
    agentId: "agent-proxy",
    env: { PASEO_AGENT_ID: "agent-proxy", PASEO_AGENT_CWD: cwd },
    modelGateway: {
      baseUrl: `${gateway.url}/mcp/backends/models`,
      token: AGENT_TOKEN,
      envPassthrough,
    },
  };
}

async function waitFor(condition: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

function resolveBundledClaudeCode(): string | null {
  try {
    const require = createRequire(import.meta.url);
    const manifest = require.resolve(
      `@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}/package.json`,
    );
    const binary = join(dirname(manifest), "claude");
    return existsSync(binary) ? binary : null;
  } catch {
    return null;
  }
}

const bundledClaudeCode = resolveBundledClaudeCode();

describe("with a proxy in the daemon's environment, model traffic still goes to the gateway", () => {
  // The bundled Claude Code binary ships for the platform CI runs on.
  test.skipIf(bundledClaudeCode === null)(
    "real Claude Code sends every model request to the gateway and none to the proxy",
    async () => {
      const gateway = await startGateway({
        status: 400,
        body: JSON.stringify({
          type: "error",
          error: { type: "invalid_request_error", message: "stand-in gateway" },
        }),
      });
      const proxy = await startProxy();
      inheritProxy(proxy);
      const root = createRoot("claude");
      // A deployment that runs agents as root in a sandbox tells Claude Code so
      // through a configured pass-through variable.
      setDaemonEnv({ HOME: root, IS_SANDBOX: "1" });

      const client = new ClaudeAgentClient({
        logger: createTestLogger(),
        resolveBinary: async () => bundledClaudeCode!,
      });
      const session = await client.createSession(
        { provider: "claude", cwd: root },
        gatewayLaunch(gateway, root, ["IS_SANDBOX"]),
      );
      const modelRequests = () =>
        gateway.requests.filter((request) => request.url.includes("/v1/messages"));
      try {
        await Promise.race([
          session.run("hello").catch(() => undefined),
          waitFor(() => modelRequests().length > 0, 60_000),
        ]);
        await waitFor(() => modelRequests().length > 0, 60_000);
      } finally {
        await session.close();
      }

      // Every request, including Claude Code's connectivity probe, reached the gateway.
      for (const request of gateway.requests) {
        expect(request.url.startsWith("/mcp/backends/models/")).toBe(true);
      }
      expect(modelRequests().length).toBeGreaterThan(0);
      for (const request of modelRequests()) {
        expect(request.authorization).toBe(`Bearer ${AGENT_TOKEN}`);
        expect(request.apiKey).toBeUndefined();
      }
      expect(proxy.requests).toEqual([]);
      expect(proxy.connects).toBe(0);
    },
    90_000,
  );

  test("a Codex stand-in using a proxy-honouring HTTP client reaches the gateway, not the proxy", async () => {
    const gateway = await startGateway({ status: 200, body: "{}" });
    const proxy = await startProxy();
    inheritProxy(proxy);
    const root = createRoot("codex");
    const script = join(root, "fake-codex-app-server.cjs");
    // Like Codex, it sends model requests to `<base_url>/responses` with the
    // bearer from `env_key`; curl applies the proxy variables it inherits.
    writeFileSync(
      script,
      `
const { execFileSync } = require("node:child_process");
let buffer = "";
let provider = null;
function respond(message, result) {
  process.stdout.write(JSON.stringify({ id: message.id, result }) + "\\n");
}
process.stdin.on("data", (chunk) => {
  buffer += chunk.toString();
  for (;;) {
    const newline = buffer.indexOf("\\n");
    if (newline === -1) break;
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    if (!line) continue;
    const message = JSON.parse(line);
    if (message.method === "thread/start") {
      const config = message.params.config;
      provider = config.model_providers[config.model_provider];
      respond(message, { thread: { id: "thread-1" } });
      continue;
    }
    if (message.method === "turn/start" && provider) {
      try {
        execFileSync("curl", ["-sS", "-m", "10", "-o", "/dev/null", "-X", "POST",
          "-H", "Authorization: Bearer " + process.env[provider.env_key],
          "-H", "content-type: application/json", "--data", "{}",
          provider.base_url + "/responses"], { stdio: "ignore" });
      } catch {}
      respond(message, {});
      continue;
    }
    if (message.id !== undefined) respond(message, message.method === "model/list" ? { data: [{ id: "gateway-model", isDefault: true }] } : {});
  }
});
`,
    );
    const client = new CodexAppServerAgentClient(createTestLogger(), {
      command: { mode: "replace", argv: [process.execPath, script] },
    });
    const session = await client.createSession(
      { provider: "codex", cwd: root, modeId: "auto", model: "gateway-model" },
      gatewayLaunch(gateway, root),
    );
    try {
      await session.startTurn("hello");
      await waitFor(() => gateway.requests.length > 0, 15_000);
    } finally {
      await session.close();
    }

    expect(gateway.requests).toEqual([
      {
        method: "POST",
        url: "/mcp/backends/models/responses",
        authorization: `Bearer ${AGENT_TOKEN}`,
        apiKey: undefined,
      },
    ]);
    expect(proxy.requests).toEqual([]);
    expect(proxy.connects).toBe(0);
  }, 30_000);
});
