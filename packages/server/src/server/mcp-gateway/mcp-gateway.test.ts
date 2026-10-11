import http from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import pino from "pino";
import { afterEach, describe, expect, test } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

import {
  createMcpGatewayHandler,
  McpGatewayRequests,
  resolveUpstreamUrl,
  type McpGatewayAgent,
  type McpGatewayUpstreamRequest,
} from "./mcp-gateway.js";
import type { McpGatewayBackend } from "./backends.js";
import type { SessionIdentity } from "../session-runtime-config.js";

interface RecordedRequest {
  method: string;
  url: string;
  headers: http.IncomingHttpHeaders;
  body: string;
}

interface Upstream {
  url: string;
  requests: RecordedRequest[];
  close: () => Promise<void>;
}

type UpstreamHandler = (
  req: http.IncomingMessage,
  res: http.ServerResponse,
  recorded: RecordedRequest,
) => void;

const closers: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (closers.length > 0) {
    await closers.pop()!();
  }
});

async function listen(server: http.Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

function closeServer(server: http.Server): () => Promise<void> {
  return () =>
    new Promise<void>((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    });
}

async function startUpstream(handler?: UpstreamHandler): Promise<Upstream> {
  const requests: RecordedRequest[] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const recorded: RecordedRequest = {
        method: req.method ?? "",
        url: req.url ?? "",
        headers: req.headers,
        body: Buffer.concat(chunks).toString("utf8"),
      };
      requests.push(recorded);
      if (handler) {
        handler(req, res, recorded);
        return;
      }
      res.writeHead(200, { "content-type": "application/json", "mcp-session-id": "upstream-s1" });
      res.end(JSON.stringify({ ok: true }));
    });
  });
  const url = await listen(server);
  const close = closeServer(server);
  closers.push(close);
  return { url, requests, close };
}

interface HalfBodyUpstream {
  url: string;
  /** The agent of each request whose whole body arrived, in order. */
  completed: string[];
  /** Resolved, one per request, when its first bytes arrive. */
  started: Array<() => void>;
}

/** An upstream that tells when each request's first bytes arrive, and answers once a body is whole. */
async function startHalfBodyUpstream(): Promise<HalfBodyUpstream> {
  const upstream: HalfBodyUpstream = { url: "", completed: [], started: [] };
  const server = http.createServer((req, res) => {
    req.once("data", () => upstream.started.shift()?.());
    req.resume();
    req.on("end", () => {
      upstream.completed.push(String(req.headers["x-paseo-agent-id"]));
      res.end("{}");
    });
  });
  upstream.url = await listen(server);
  closers.push(closeServer(server));
  return upstream;
}

interface HalfRequest {
  answer: Promise<{ status: number; body: string }>;
  finish: () => void;
}

function readAnswer(request: http.ClientRequest): HalfRequest["answer"] {
  return new Promise((resolve) => {
    request.on("response", (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.on("end", () =>
        resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }),
      );
    });
    request.on("error", () => resolve({ status: 0, body: "" }));
  });
}

/** Sends half an MCP request's body and resolves once the upstream has that half. */
async function openHalfRequest(
  upstream: HalfBodyUpstream,
  url: string,
  token: string,
): Promise<HalfRequest> {
  const begun = new Promise<void>((resolve) => upstream.started.push(resolve));
  const request = http.request(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
  });
  const answer = readAnswer(request);
  request.write(MCP_INIT.slice(0, 20));
  await begun;
  return { answer, finish: () => request.end(MCP_INIT.slice(20)) };
}

const AGENTS: Record<string, McpGatewayAgent> = {
  "token-a": { agentId: "agent-a", sessionId: "session-a", workspaceId: "workspace-a" },
  "token-b": { agentId: "agent-b", sessionId: null, workspaceId: null },
  // A plugin's daemon-only token for agent-b while its timeline items are delivered.
  "drain-token-b": { agentId: "agent-b", sessionId: null, workspaceId: null, drain: true },
};

const SESSION_IDENTITY: SessionIdentity = { member: "codex/gpt-6-astra", role: "validator" };

interface GatewayOptions {
  backends: Record<string, string | McpGatewayBackend>;
  resolveUpstream?: (request: McpGatewayUpstreamRequest) => Promise<McpGatewayUpstreamRequest>;
  responseTimeoutMs?: number;
  sessionIdentity?: SessionIdentity | null;
  agentRefusal?: (agentId: string) => string | null;
  requests?: McpGatewayRequests;
}

async function startGateway(options: GatewayOptions): Promise<string> {
  const app = express();
  app.use(
    "/mcp/backends",
    createMcpGatewayHandler({
      getBackends: () =>
        new Map(
          Object.entries(options.backends).map(([name, backend]) => [
            name,
            typeof backend === "string" ? { url: backend } : backend,
          ]),
        ),
      resolveAgent: (token) => (token ? (AGENTS[token] ?? null) : null),
      serverId: "server-1",
      sessionIdentity: options.sessionIdentity ?? null,
      agentRefusal: options.agentRefusal,
      requests: options.requests,
      resolveUpstream: options.resolveUpstream ?? (async (request) => request),
      responseTimeoutMs: options.responseTimeoutMs,
      logger: pino({ level: "silent" }),
    }),
  );
  // Proves the gateway owns the raw body: a JSON parser mounted after it never runs first.
  app.use(express.json());
  const server = http.createServer(app);
  const url = await listen(server);
  closers.push(closeServer(server));
  return `${url}/mcp/backends`;
}

async function writeTwoEvents(res: http.ServerResponse, released: Promise<void>): Promise<void> {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
  res.write('event: message\ndata: {"n":1}\n\n');
  await released;
  res.end('event: message\ndata: {"n":2}\n\n');
}

function echoChunksAsTheyArrive(received: string[], onChunk: () => void): http.RequestListener {
  return (req, res) => {
    req.on("data", (chunk: Buffer) => {
      received.push(chunk.toString("utf8"));
      onChunk();
    });
    req.on("end", () => {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end(received.join(""));
    });
  };
}

/** An upstream that sends its response headers and body only after `delayMs`. */
function answerAfter(delayMs: number, body: string): UpstreamHandler {
  return (_req, res) => {
    setTimeout(() => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(body);
    }, delayMs);
  };
}

const MCP_INIT = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });

describe("MCP gateway", () => {
  test("attaches the token's agent identity and the daemon server id", async () => {
    const upstream = await startUpstream();
    const gateway = await startGateway({ backends: { cluster: `${upstream.url}/mcp` } });

    const response = await fetch(`${gateway}/cluster`, {
      method: "POST",
      headers: { Authorization: "Bearer token-a", "content-type": "application/json" },
      body: MCP_INIT,
    });

    expect(response.status).toBe(200);
    expect(upstream.requests).toHaveLength(1);
    const headers = upstream.requests[0]!.headers;
    expect(headers["x-paseo-agent-id"]).toBe("agent-a");
    expect(headers["x-paseo-session-id"]).toBe("session-a");
    expect(headers["x-paseo-workspace-id"]).toBe("workspace-a");
    expect(headers["x-paseo-server-id"]).toBe("server-1");
  });

  test("omits identity headers the daemon does not know yet", async () => {
    const upstream = await startUpstream();
    const gateway = await startGateway({ backends: { cluster: upstream.url } });

    await fetch(`${gateway}/cluster`, {
      method: "POST",
      headers: { Authorization: "Bearer token-b" },
      body: MCP_INIT,
    });

    const headers = upstream.requests[0]!.headers;
    expect(headers["x-paseo-agent-id"]).toBe("agent-b");
    expect(headers).not.toHaveProperty("x-paseo-session-id");
    expect(headers).not.toHaveProperty("x-paseo-workspace-id");
  });

  test("forwards only daemon-set X-Paseo-* headers and no caller Authorization", async () => {
    const upstream = await startUpstream();
    const gateway = await startGateway({ backends: { cluster: upstream.url } });

    await fetch(`${gateway}/cluster`, {
      method: "POST",
      headers: {
        Authorization: "Bearer token-b",
        "X-Paseo-Agent-ID": "agent-a",
        "X-Paseo-Session-ID": "session-a",
        "X-Paseo-Workspace-ID": "workspace-a",
        "X-Paseo-Server-ID": "other-server",
        "X-Paseo-Anything": "caller-supplied",
        "Proxy-Authorization": "Basic caller-supplied",
      },
      body: MCP_INIT,
    });

    const headers = upstream.requests[0]!.headers;
    expect(headers["x-paseo-agent-id"]).toBe("agent-b");
    expect(headers["x-paseo-server-id"]).toBe("server-1");
    expect(headers).not.toHaveProperty("x-paseo-session-id");
    expect(headers).not.toHaveProperty("x-paseo-workspace-id");
    expect(headers).not.toHaveProperty("x-paseo-anything");
    expect(headers).not.toHaveProperty("authorization");
    expect(headers).not.toHaveProperty("proxy-authorization");
  });

  test("in session mode sends the session's member and role for every agent", async () => {
    const upstream = await startUpstream();
    const gateway = await startGateway({
      backends: { cluster: upstream.url },
      sessionIdentity: SESSION_IDENTITY,
    });

    for (const token of ["token-a", "token-b"]) {
      await fetch(`${gateway}/cluster`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: MCP_INIT,
      });
    }

    expect(upstream.requests.map((request) => request.headers["x-paseo-agent-id"])).toEqual([
      "agent-a",
      "agent-b",
    ]);
    for (const request of upstream.requests) {
      expect(request.headers["x-paseo-member"]).toBe("codex/gpt-6-astra");
      expect(request.headers["x-paseo-role"]).toBe("validator");
    }
  });

  test("in session mode replaces a member or role from the caller or a plugin", async () => {
    const upstream = await startUpstream();
    const gateway = await startGateway({
      backends: { cluster: upstream.url },
      sessionIdentity: SESSION_IDENTITY,
      resolveUpstream: async (request) => ({
        ...request,
        headers: { "X-Paseo-Member": "plugin/supplied", "X-Paseo-Role": "infra" },
      }),
    });

    await fetch(`${gateway}/cluster`, {
      method: "POST",
      headers: {
        Authorization: "Bearer token-a",
        "X-Paseo-Member": "claude/claude-opus-5-5",
        "X-Paseo-Role": "infra",
      },
      body: MCP_INIT,
    });

    const headers = upstream.requests[0]!.headers;
    expect(headers["x-paseo-member"]).toBe("codex/gpt-6-astra");
    expect(headers["x-paseo-role"]).toBe("validator");
  });

  test("forwards nothing for an agent the session refused", async () => {
    const upstream = await startUpstream();
    const refusal =
      "This session's member is codex/gpt-6-astra. This agent would run codex/gpt-5.4. A different model needs a new session.";
    const gateway = await startGateway({
      backends: { cluster: upstream.url },
      sessionIdentity: SESSION_IDENTITY,
      agentRefusal: (agentId) => (agentId === "agent-b" ? refusal : null),
    });

    const refused = await fetch(`${gateway}/cluster`, {
      method: "POST",
      headers: { Authorization: "Bearer token-b" },
      body: MCP_INIT,
    });
    const admitted = await fetch(`${gateway}/cluster`, {
      method: "POST",
      headers: { Authorization: "Bearer token-a" },
      body: MCP_INIT,
    });

    expect(refused.status).toBe(403);
    expect(await refused.json()).toEqual({ error: refusal });
    expect(admitted.status).toBe(200);
    expect(upstream.requests.map((request) => request.headers["x-paseo-agent-id"])).toEqual([
      "agent-a",
    ]);
  });

  test("forwards a plugin's drain call for a refused agent as that agent, and still none of the agent's own", async () => {
    const upstream = await startUpstream();
    const refusal =
      "This session's member is codex/gpt-6-astra. This agent would run codex/gpt-5.4. A different model needs a new session.";
    const gateway = await startGateway({
      backends: { cluster: upstream.url },
      sessionIdentity: SESSION_IDENTITY,
      agentRefusal: (agentId) => (agentId === "agent-b" ? refusal : null),
    });

    const own = await fetch(`${gateway}/cluster`, {
      method: "POST",
      headers: { Authorization: "Bearer token-b" },
      body: MCP_INIT,
    });
    const drain = await fetch(`${gateway}/cluster`, {
      method: "POST",
      headers: { Authorization: "Bearer drain-token-b" },
      body: MCP_INIT,
    });

    expect(own.status).toBe(403);
    expect(drain.status).toBe(200);
    expect(upstream.requests).toHaveLength(1);
    expect(upstream.requests[0]!.headers).toMatchObject({
      "x-paseo-agent-id": "agent-b",
      "x-paseo-member": "codex/gpt-6-astra",
      "x-paseo-role": "validator",
    });
  });

  test("a refusal cuts off the agent's requests already being forwarded, not its drain calls or other agents'", async () => {
    const upstream = await startHalfBodyUpstream();
    const refused = new Map<string, string>();
    const requests = new McpGatewayRequests();
    const gateway = await startGateway({
      backends: { cluster: upstream.url },
      sessionIdentity: SESSION_IDENTITY,
      agentRefusal: (agentId) => refused.get(agentId) ?? null,
      requests,
    });
    const own = await openHalfRequest(upstream, `${gateway}/cluster`, "token-b");
    const drain = await openHalfRequest(upstream, `${gateway}/cluster`, "drain-token-b");
    const other = await openHalfRequest(upstream, `${gateway}/cluster`, "token-a");
    const refusal =
      "This session's member is codex/gpt-6-astra. This agent would run codex/gpt-5.4. A different model needs a new session.";

    refused.set("agent-b", refusal);
    requests.refuse("agent-b", refusal);
    for (const request of [own, drain, other]) request.finish();

    expect(await own.answer).toEqual({ status: 403, body: JSON.stringify({ error: refusal }) });
    expect((await drain.answer).status).toBe(200);
    expect((await other.answer).status).toBe(200);
    // The cut-off request never completed upstream: for agent-b only the drain call did.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(upstream.completed.sort()).toEqual(["agent-a", "agent-b"]);
  });

  test("a request that finished before the refusal is not cut off again", async () => {
    const upstream = await startUpstream();
    const requests = new McpGatewayRequests();
    const gateway = await startGateway({ backends: { cluster: upstream.url }, requests });

    const done = await fetch(`${gateway}/cluster`, {
      method: "POST",
      headers: { Authorization: "Bearer token-a" },
      body: MCP_INIT,
    });
    expect(done.status).toBe(200);
    requests.refuse("agent-a", "refused");
    expect(await done.json()).toEqual({ ok: true });
  });

  test("forwards nothing for an agent refused while its request waits on the upstream hook", async () => {
    const upstream = await startUpstream();
    const refusal =
      "This session's member is codex/gpt-6-astra. This agent would run codex/gpt-5.4. A different model needs a new session.";
    let refused: string | null = null;
    let reachedHook!: () => void;
    let releaseHook!: () => void;
    const hookReached = new Promise<void>((resolve) => {
      reachedHook = resolve;
    });
    const hookReleased = new Promise<void>((resolve) => {
      releaseHook = resolve;
    });
    const gateway = await startGateway({
      backends: { cluster: upstream.url },
      sessionIdentity: SESSION_IDENTITY,
      agentRefusal: () => refused,
      resolveUpstream: async (request) => {
        reachedHook();
        await hookReleased;
        return request;
      },
    });

    const response = fetch(`${gateway}/cluster`, {
      method: "POST",
      headers: { Authorization: "Bearer token-a" },
      body: MCP_INIT,
    });
    await hookReached;
    refused = refusal;
    releaseHook();

    const answered = await response;
    expect(answered.status).toBe(403);
    expect(await answered.json()).toEqual({ error: refusal });
    expect(upstream.requests).toEqual([]);
  });

  test("outside session mode sends no member or role, and drops the caller's", async () => {
    const upstream = await startUpstream();
    const gateway = await startGateway({ backends: { cluster: upstream.url } });

    await fetch(`${gateway}/cluster`, {
      method: "POST",
      headers: {
        Authorization: "Bearer token-a",
        "X-Paseo-Member": "claude/claude-opus-5-5",
        "X-Paseo-Role": "validator",
      },
      body: MCP_INIT,
    });

    const headers = upstream.requests[0]!.headers;
    expect(headers["x-paseo-agent-id"]).toBe("agent-a");
    expect(headers).not.toHaveProperty("x-paseo-member");
    expect(headers).not.toHaveProperty("x-paseo-role");
  });

  test("another agent's token acts only as that other agent", async () => {
    const upstream = await startUpstream();
    const gateway = await startGateway({ backends: { cluster: upstream.url } });

    await fetch(`${gateway}/cluster?callerAgentId=agent-a`, {
      method: "POST",
      headers: { Authorization: "Bearer token-b", "X-Paseo-Agent-ID": "agent-a" },
      body: MCP_INIT,
    });

    expect(upstream.requests[0]!.headers["x-paseo-agent-id"]).toBe("agent-b");
  });

  test("refuses requests without a valid agent token before contacting the backend", async () => {
    const upstream = await startUpstream();
    const gateway = await startGateway({ backends: { cluster: upstream.url } });

    const missing = await fetch(`${gateway}/cluster`, { method: "POST", body: MCP_INIT });
    const unknown = await fetch(`${gateway}/cluster`, {
      method: "POST",
      headers: { Authorization: "Bearer not-a-token", "X-Paseo-Agent-ID": "agent-a" },
      body: MCP_INIT,
    });

    expect(missing.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(upstream.requests).toHaveLength(0);
  });

  test("refuses an unknown backend name and takes no URL from the caller", async () => {
    const upstream = await startUpstream();
    const gateway = await startGateway({ backends: { cluster: upstream.url } });

    const unknown = await fetch(`${gateway}/other`, {
      method: "POST",
      headers: { Authorization: "Bearer token-a" },
      body: MCP_INIT,
    });
    const prototypeKey = await fetch(`${gateway}/constructor`, {
      method: "POST",
      headers: { Authorization: "Bearer token-a" },
      body: MCP_INIT,
    });
    const urlAsName = await fetch(`${gateway}/${encodeURIComponent(upstream.url)}`, {
      method: "POST",
      headers: { Authorization: "Bearer token-a" },
      body: MCP_INIT,
    });
    const bare = await fetch(gateway, {
      method: "POST",
      headers: { Authorization: "Bearer token-a" },
      body: MCP_INIT,
    });

    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toEqual({ error: "Unknown MCP backend: other" });
    expect(prototypeKey.status).toBe(404);
    expect(urlAsName.status).toBe(404);
    expect(bare.status).toBe(404);
    expect(upstream.requests).toHaveLength(0);
  });

  // fetch() normalizes dot segments client-side, so these send raw request targets.
  function rawStatus(gateway: string, target: string): Promise<number> {
    return new Promise<number>((resolve, reject) => {
      const request = http.request(`${gateway}/cluster`, {
        method: "POST",
        path: `/mcp/backends/cluster${target}`,
        headers: { Authorization: "Bearer token-a" },
      });
      request.on("response", (response) => {
        response.resume();
        resolve(response.statusCode ?? 0);
      });
      request.on("error", reject);
      request.end(MCP_INIT);
    });
  }

  test.each([
    ["a dot-dot segment", "/../admin"],
    ["an encoded dot-dot segment", "/%2e%2e/admin"],
    ["a double-encoded dot-dot segment", "/%252e%252e/admin"],
    ["a triple-encoded dot-dot segment", "/%25252e%25252E/admin"],
    ["an encoded dot segment", "/a/%2E/b"],
    ["a double-encoded dot segment", "/a/%252E/b"],
    ["an encoded slash", "/a%2fb"],
    ["a double-encoded slash", "/%2e%2e%252fadmin"],
    ["a triple-encoded slash", "/a%25252Fb"],
    ["an encoded backslash", "/a%5c..%5cb"],
    ["a double-encoded backslash", "/a%255cb"],
    ["a literal backslash", "/a\\b"],
    ["an empty leading segment", "//other.example/mcp"],
    ["an encoded leading double slash", "/%2F%2Fother.example/mcp"],
    ["a URL with a scheme", "/https://other.example/mcp"],
    ["an encoded URL with a scheme", "/https%3A%2F%2Fother.example%2Fmcp"],
    ["a double-encoded URL with a scheme", "/http%253A%252F%252Fother.example"],
    ["a scheme-only segment", "/javascript:alert"],
    ["a URL with a scheme after other segments", "/x/http:%2f%2fother.example"],
    ["a malformed escape", "/a%zz"],
    ["a double-encoded malformed escape", "/a%25zz"],
    ["an invalid UTF-8 escape", "/a%E0%A4%A"],
    ["an encoded control character", "/a%00b"],
  ])("refuses a suffix with %s", async (_name, target) => {
    const upstream = await startUpstream();
    const gateway = await startGateway({ backends: { cluster: `${upstream.url}/mcp` } });

    expect(await rawStatus(gateway, target)).toBe(400);
    expect(upstream.requests).toHaveLength(0);
  });

  test.each([
    ["a literal fragment", "/messages#frag"],
    ["an encoded fragment", "/messages%23frag"],
    ["a double-encoded fragment", "/messages%2523frag"],
    ["a triple-encoded fragment", "/messages%252523frag"],
    ["a mixed-encoded fragment", "/messages%25%32%33frag"],
    ["a fragment as a whole segment", "/%23"],
    ["an encoded query delimiter", "/messages%3Fa=b"],
    ["a double-encoded query delimiter", "/messages%253Fa=b"],
    ["a triple-encoded query delimiter", "/messages%25253fa=b"],
    ["a mixed-encoded query delimiter", "/messages%25%33%46a=b"],
    ["a query delimiter as a whole segment", "/x/%3f"],
  ])(
    "refuses a suffix with %s before the hook runs or the backend is called",
    async (_name, target) => {
      const upstream = await startUpstream();
      let hookCalls = 0;
      const gateway = await startGateway({
        backends: { cluster: `${upstream.url}/mcp` },
        resolveUpstream: async (request) => {
          hookCalls += 1;
          return request;
        },
      });

      expect(await rawStatus(gateway, target)).toBe(400);
      expect(hookCalls).toBe(0);
      expect(upstream.requests).toHaveLength(0);
    },
  );

  test.each([
    ["C0 U+0001", "%01"],
    ["DEL U+007F", "%7F"],
    ["C1 U+0080", "%C2%80"],
    ["C1 U+0085", "%C2%85"],
    ["C1 U+009F", "%C2%9F"],
    ["zero width space U+200B", "%E2%80%8B"],
    ["right-to-left mark U+200F", "%E2%80%8F"],
    ["line separator U+2028", "%E2%80%A8"],
    ["paragraph separator U+2029", "%E2%80%A9"],
    ["left-to-right embedding U+202A", "%E2%80%AA"],
    ["right-to-left override U+202E", "%E2%80%AE"],
    ["word joiner U+2060", "%E2%81%A0"],
    ["U+2065", "%E2%81%A5"],
    ["pop directional isolate U+2069", "%E2%81%A9"],
    ["byte order mark U+FEFF", "%EF%BB%BF"],
    ["double-encoded C1 U+0085", "%25C2%2585"],
    ["double-encoded line separator U+2028", "%25E2%2580%25A8"],
  ])("refuses a suffix holding control or format character %s", async (_name, encoded) => {
    const upstream = await startUpstream();
    const gateway = await startGateway({ backends: { cluster: `${upstream.url}/mcp` } });

    expect(await rawStatus(gateway, `/a${encoded}b`)).toBe(400);
    expect(upstream.requests).toHaveLength(0);
  });

  test("forwards a suffix holding ordinary non-ASCII letters", async () => {
    const upstream = await startUpstream();
    const gateway = await startGateway({ backends: { cluster: `${upstream.url}/mcp` } });

    expect(await rawStatus(gateway, "/caf%C3%A9")).toBe(200);
    expect(upstream.requests.map((request) => request.url)).toEqual(["/mcp/caf%C3%A9"]);
  });

  // Raw request targets relative to the gateway mount, so a literal `#` can
  // sit in the backend name, right after it, or in the suffix.
  function rawGatewayStatus(gateway: string, target: string): Promise<number> {
    return new Promise<number>((resolve, reject) => {
      const request = http.request(gateway, {
        method: "POST",
        path: `/mcp/backends${target}`,
        headers: { Authorization: "Bearer token-a" },
      });
      request.on("response", (response) => {
        response.resume();
        resolve(response.statusCode ?? 0);
      });
      request.on("error", reject);
      request.end(MCP_INIT);
    });
  }

  test.each([
    ["inside the backend name", "/clus#ter"],
    ["at the start of the backend name", "/#cluster"],
    ["right after the backend name", "/cluster#f"],
    ["right after the backend name and a slash", "/cluster/#f"],
    ["in the suffix", "/cluster/messages#f"],
    ["at the end of the suffix", "/cluster/messages#"],
    ["in the query", "/cluster/messages?x=1#f"],
    ["at the end of the query", "/cluster?x=1#"],
    ["after an unknown backend name", "/other#f"],
  ])(
    "refuses a literal fragment marker %s with 400 before the hook runs or the backend is called",
    async (_name, target) => {
      const upstream = await startUpstream();
      let hookCalls = 0;
      const gateway = await startGateway({
        backends: { cluster: `${upstream.url}/mcp` },
        resolveUpstream: async (request) => {
          hookCalls += 1;
          return request;
        },
      });

      expect(await rawGatewayStatus(gateway, target)).toBe(400);
      expect(hookCalls).toBe(0);
      expect(upstream.requests).toHaveLength(0);
    },
  );

  test("forwards an ordinary multi-segment suffix with encoded characters intact", async () => {
    const upstream = await startUpstream();
    const gateway = await startGateway({ backends: { cluster: `${upstream.url}/mcp` } });

    expect(await rawStatus(gateway, "/messages/a%20b/v1.2")).toBe(200);
    expect(upstream.requests.map((request) => request.url)).toEqual(["/mcp/messages/a%20b/v1.2"]);
  });

  test("forwards method, path suffix, query, body and MCP session headers both ways", async () => {
    const upstream = await startUpstream((_req, res, recorded) => {
      res.writeHead(202, {
        "content-type": "application/json",
        "mcp-session-id": "upstream-session",
        "x-upstream": "yes",
      });
      res.end(JSON.stringify({ echoed: recorded.body }));
    });
    const gateway = await startGateway({ backends: { cluster: `${upstream.url}/mcp?tenant=t1` } });

    const response = await fetch(`${gateway}/cluster/messages/x?cursor=2&a=b`, {
      method: "PUT",
      headers: {
        Authorization: "Bearer token-a",
        "content-type": "application/json",
        "mcp-session-id": "client-session",
        "mcp-protocol-version": "2025-06-18",
        accept: "application/json, text/event-stream",
      },
      body: MCP_INIT,
    });

    expect(response.status).toBe(202);
    expect(response.headers.get("mcp-session-id")).toBe("upstream-session");
    expect(response.headers.get("x-upstream")).toBe("yes");
    expect(await response.json()).toEqual({ echoed: MCP_INIT });

    const recorded = upstream.requests[0]!;
    expect(recorded.method).toBe("PUT");
    expect(recorded.url).toBe("/mcp/messages/x?tenant=t1&cursor=2&a=b");
    expect(recorded.body).toBe(MCP_INIT);
    expect(recorded.headers["mcp-session-id"]).toBe("client-session");
    expect(recorded.headers["mcp-protocol-version"]).toBe("2025-06-18");
    expect(recorded.headers["content-type"]).toBe("application/json");
    expect(recorded.headers.host).toBe(new URL(upstream.url).host);
  });

  test("forwards GET and DELETE used by MCP Streamable HTTP", async () => {
    const upstream = await startUpstream((_req, res) => {
      res.writeHead(204);
      res.end();
    });
    const gateway = await startGateway({ backends: { cluster: upstream.url } });

    for (const method of ["GET", "DELETE"]) {
      const response = await fetch(`${gateway}/cluster`, {
        method,
        headers: { Authorization: "Bearer token-a", "mcp-session-id": "s1" },
      });
      expect(response.status).toBe(204);
    }
    expect(upstream.requests.map((request) => request.method)).toEqual(["GET", "DELETE"]);
  });

  test("proxies a streaming response incrementally without buffering", async () => {
    let releaseSecondEvent: () => void = () => {};
    const secondEventReleased = new Promise<void>((resolve) => {
      releaseSecondEvent = resolve;
    });
    // The second event is written only after the client has seen the first,
    // so a buffering proxy would deadlock here and time the test out.
    const upstream = await startUpstream((_req, res) => {
      void writeTwoEvents(res, secondEventReleased);
    });
    const gateway = await startGateway({ backends: { cluster: upstream.url } });

    const response = await fetch(`${gateway}/cluster`, {
      method: "POST",
      headers: { Authorization: "Bearer token-a", accept: "text/event-stream" },
      body: MCP_INIT,
    });
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();

    const first = await reader.read();
    expect(decoder.decode(first.value)).toBe('event: message\ndata: {"n":1}\n\n');
    releaseSecondEvent();

    let rest = "";
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      rest += decoder.decode(chunk.value);
    }
    expect(rest).toBe('event: message\ndata: {"n":2}\n\n');
  });

  test("streams the request body to the backend as it arrives", async () => {
    let firstChunkSeen: () => void = () => {};
    const firstChunk = new Promise<void>((resolve) => {
      firstChunkSeen = resolve;
    });
    const received: string[] = [];
    const server = http.createServer(echoChunksAsTheyArrive(received, () => firstChunkSeen()));
    const upstreamUrl = await listen(server);
    closers.push(closeServer(server));
    const gateway = await startGateway({ backends: { cluster: upstreamUrl } });

    let sendSecond: () => void = () => {};
    const secondReady = new Promise<void>((resolve) => {
      sendSecond = resolve;
    });
    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        controller.enqueue(new TextEncoder().encode("first;"));
        await secondReady;
        controller.enqueue(new TextEncoder().encode("second"));
        controller.close();
      },
    });
    const pending = fetch(`${gateway}/cluster`, {
      method: "POST",
      headers: { Authorization: "Bearer token-a", "content-type": "text/plain" },
      body,
      duplex: "half",
    } as RequestInit);

    await firstChunk;
    expect(received.join("")).toBe("first;");
    sendSecond();
    const response = await pending;
    expect(await response.text()).toBe("first;second");
  });

  test("passes backend errors through unchanged", async () => {
    const upstream = await startUpstream((_req, res) => {
      res.writeHead(403, { "content-type": "application/json", "www-authenticate": "Bearer" });
      res.end(JSON.stringify({ error: "forbidden by backend" }));
    });
    const gateway = await startGateway({ backends: { cluster: upstream.url } });

    const response = await fetch(`${gateway}/cluster`, {
      method: "POST",
      headers: { Authorization: "Bearer token-a" },
      body: MCP_INIT,
    });

    expect(response.status).toBe(403);
    expect(response.headers.get("www-authenticate")).toBe("Bearer");
    expect(await response.json()).toEqual({ error: "forbidden by backend" });
  });

  test("answers 502 when the backend cannot be reached", async () => {
    const upstream = await startUpstream();
    await upstream.close();
    const gateway = await startGateway({ backends: { cluster: upstream.url } });

    const response = await fetch(`${gateway}/cluster`, {
      method: "POST",
      headers: { Authorization: "Bearer token-a" },
      body: MCP_INIT,
    });

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "MCP backend cluster is unreachable" });
  });

  test("answers 504 when the backend does not answer in time", async () => {
    const upstream = await startUpstream(() => {
      // No response.
    });
    const gateway = await startGateway({
      backends: { cluster: upstream.url },
      responseTimeoutMs: 100,
    });

    const response = await fetch(`${gateway}/cluster`, {
      method: "POST",
      headers: { Authorization: "Bearer token-a" },
      body: MCP_INIT,
    });

    expect(response.status).toBe(504);
    expect(await response.json()).toEqual({ error: "MCP backend cluster did not answer" });
  });

  test("a backend's own response timeout answers 504 after that time, not the default", async () => {
    const upstream = await startUpstream(() => {
      // No response.
    });
    // No gateway-wide timeout: the default would wait 30 s.
    const gateway = await startGateway({
      backends: { models: { url: upstream.url, responseTimeoutMs: 150 } },
    });

    const startedAt = Date.now();
    const response = await fetch(`${gateway}/models/v1/responses/compact`, {
      method: "POST",
      headers: { Authorization: "Bearer token-a" },
      body: "{}",
    });
    const elapsed = Date.now() - startedAt;

    expect(response.status).toBe(504);
    expect(await response.json()).toEqual({ error: "MCP backend models did not answer" });
    expect(elapsed).toBeGreaterThanOrEqual(140);
    expect(elapsed).toBeLessThan(5_000);
  });

  test("a backend's own response timeout lets a slow first byte through past the default", async () => {
    const upstream = await startUpstream(answerAfter(400, '{"compacted":true}'));
    const gateway = await startGateway({
      backends: {
        models: { url: upstream.url, responseTimeoutMs: 5_000 },
        cluster: upstream.url,
      },
      responseTimeoutMs: 100,
    });

    const slow = await fetch(`${gateway}/models/v1/responses/compact`, {
      method: "POST",
      headers: { Authorization: "Bearer token-a" },
      body: "{}",
    });
    const defaulted = await fetch(`${gateway}/cluster`, {
      method: "POST",
      headers: { Authorization: "Bearer token-a" },
      body: MCP_INIT,
    });

    expect(slow.status).toBe(200);
    expect(await slow.json()).toEqual({ compacted: true });
    expect(defaulted.status).toBe(504);
  });

  test("the upstream hook's headers reach the backend; identity headers stay the daemon's", async () => {
    const upstream = await startUpstream();
    const seen: McpGatewayUpstreamRequest[] = [];
    const gateway = await startGateway({
      backends: { cluster: upstream.url },
      resolveUpstream: async (request) => {
        seen.push(structuredClone(request));
        return {
          ...request,
          headers: {
            ...request.headers,
            Authorization: `Bearer minted-for-${request.agentId}`,
            "X-Paseo-Agent-ID": "plugin-supplied-identity",
          },
        };
      },
    });

    await fetch(`${gateway}/cluster`, {
      method: "POST",
      headers: { Authorization: "Bearer token-a", "X-Paseo-Agent-ID": "caller-supplied" },
      body: MCP_INIT,
    });

    expect(seen).toEqual([
      {
        backend: "cluster",
        agentId: "agent-a",
        sessionId: "session-a",
        workspaceId: "workspace-a",
        url: upstream.url,
        headers: {},
      },
    ]);
    const headers = upstream.requests[0]!.headers;
    expect(headers.authorization).toBe("Bearer minted-for-agent-a");
    expect(headers["x-paseo-agent-id"]).toBe("agent-a");
  });

  test("a plugin can supply the URL of a backend the daemon config does not name", async () => {
    const upstream = await startUpstream();
    const gateway = await startGateway({
      backends: {},
      resolveUpstream: async (request) =>
        request.backend === "plugin-backend" ? { ...request, url: `${upstream.url}/p` } : request,
    });

    const known = await fetch(`${gateway}/plugin-backend`, {
      method: "POST",
      headers: { Authorization: "Bearer token-a" },
      body: MCP_INIT,
    });
    const unknown = await fetch(`${gateway}/other`, {
      method: "POST",
      headers: { Authorization: "Bearer token-a" },
      body: MCP_INIT,
    });

    expect(known.status).toBe(200);
    expect(upstream.requests.map((request) => request.url)).toEqual(["/p"]);
    expect(unknown.status).toBe(404);
  });

  test("answers 502 without contacting the backend when the upstream hook fails", async () => {
    const upstream = await startUpstream();
    const gateway = await startGateway({
      backends: { cluster: upstream.url },
      resolveUpstream: async () => {
        throw new Error("token exchange failed");
      },
    });

    const response = await fetch(`${gateway}/cluster`, {
      method: "POST",
      headers: { Authorization: "Bearer token-a" },
      body: MCP_INIT,
    });

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      error: "MCP backend cluster upstream credentials unavailable",
    });
    expect(upstream.requests).toHaveLength(0);
  });
});

/** How the fake backend answers a tool call in the refusal cases an MCP client sees. */
type SdkRefusalCase =
  /** A 256 KiB argument: the SDK writes `id` last, past any kept prefix of the body. */
  | "large-request"
  /** A whole result event whose terminating blank line has not arrived. */
  | "result-without-terminator"
  /** A result event cut off inside its JSON. */
  | "unfinished-result"
  /** A body still arriving, whose `id` follows a nested object. */
  | "id-after-object"
  /** The `id` member's name written with a JSON escape, `"\u0069d"`. */
  | "escaped-key";

const SDK_REFUSAL =
  "This session's member is claude/claude-opus-5-5. This agent would run claude/claude-sonnet-5-5. A different model needs a new session.";

/** A backend speaking MCP Streamable HTTP that opens each tool call's event stream as `mode` says. */
async function startSdkBackend(mode: SdkRefusalCase, answered: () => void): Promise<string> {
  const server = http.createServer((req, res) => {
    if (req.method !== "POST") {
      res.writeHead(405).end();
      return;
    }
    let body = "";
    req.on("error", () => undefined);
    req.on("data", (chunk: Buffer) => {
      body += chunk.toString("utf8");
      // The streamed tool call never ends; its event stream opens on its first bytes.
      if (mode === "id-after-object" && body.startsWith('{"params":') && !res.headersSent) {
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.write(": ready\n\n");
        answered();
      }
    });
    req.on("end", () => {
      const message = JSON.parse(body) as {
        id?: number;
        method: string;
        params?: { protocolVersion?: string };
      };
      if (message.method === "initialize") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            id: message.id,
            result: {
              protocolVersion: message.params?.protocolVersion,
              capabilities: { tools: {} },
              serverInfo: { name: "fixture", version: "1" },
            },
          }),
        );
        return;
      }
      if (message.id === undefined) {
        res.writeHead(202).end();
        return;
      }
      res.writeHead(200, { "content-type": "text/event-stream" });
      const result = { jsonrpc: "2.0", id: message.id, result: { content: [] } };
      if (mode === "result-without-terminator") {
        res.write(`event: message\ndata: ${JSON.stringify(result)}`);
      } else if (mode === "unfinished-result") {
        res.write(`event: message\ndata: {"jsonrpc":"2.0","id":${message.id},"result":`);
      } else {
        res.write(": ready\n\n");
      }
      answered();
    });
  });
  const url = await listen(server);
  closers.push(closeServer(server));
  return url;
}

type SdkOutcome = { outcome: "result" } | { outcome: "error"; code: unknown; message: string };

/**
 * Calls a tool through the gateway with the MCP SDK's own client, refuses the
 * agent while the call is pending, and returns how the call ended and any
 * message the transport could not handle.
 */
async function refuseSdkToolCall(mode: SdkRefusalCase) {
  const refused = new Map<string, string>();
  const requests = new McpGatewayRequests();
  let backendAnswered = () => undefined as void;
  const answered = new Promise<void>((resolve) => {
    backendAnswered = resolve;
  });
  const backendUrl = await startSdkBackend(mode, backendAnswered);
  const gateway = await startGateway({
    backends: { cluster: backendUrl },
    sessionIdentity: { member: "claude/claude-opus-5-5", role: "implementer" },
    agentRefusal: (agentId) => refused.get(agentId) ?? null,
    requests,
  });
  let toolResponse = () => undefined as void;
  const responded = new Promise<void>((resolve) => {
    toolResponse = resolve;
  });
  let streamedBody: ReadableStreamDefaultController<Uint8Array> | null = null;
  const toolFetch = async (url: string | URL, init?: RequestInit) => {
    const message = typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : null;
    const toolCall =
      message !== null &&
      typeof message === "object" &&
      (message as { method?: string }).method === "tools/call";
    let sent = init;
    if (toolCall && mode === "escaped-key" && typeof init?.body === "string") {
      const { id } = message as { id: number };
      sent = { ...init, body: init.body.replace(`"id":${id}`, `"\\u0069d":${id}`) };
    }
    if (toolCall && mode === "id-after-object") {
      const { id, params } = message as { id: number; params: unknown };
      const start = `{"params":${JSON.stringify(params)},"id":${id},"jsonrpc":"2.0","method":`;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          streamedBody = controller;
          controller.enqueue(new TextEncoder().encode(start));
        },
      });
      sent = { ...init, body, duplex: "half" } as RequestInit;
    }
    const response = await fetch(url, sent);
    if (toolCall) toolResponse();
    return response;
  };
  const client = new Client({ name: "refusal-check", version: "1" });
  const transportErrors: string[] = [];
  // eslint-disable-next-line unicorn/prefer-add-event-listener -- the SDK's Client takes its error handler as a property, not an EventTarget listener.
  client.onerror = (error) => transportErrors.push(`${error.name}: ${error.message}`);
  const transport = new StreamableHTTPClientTransport(new URL(`${gateway}/cluster`), {
    requestInit: { headers: { Authorization: "Bearer token-a" } },
    fetch: toolFetch,
    reconnectionOptions: {
      maxRetries: 0,
      initialReconnectionDelay: 1,
      maxReconnectionDelay: 1,
      reconnectionDelayGrowFactor: 1,
    },
  });
  try {
    await client.connect(transport);
    let settled = false;
    const call = client
      .callTool(
        {
          name: "read",
          arguments: { text: mode === "large-request" ? "x".repeat(256 * 1024) : "small" },
        },
        undefined,
        { timeout: 3_000 },
      )
      .then(
        (): SdkOutcome => ({ outcome: "result" }),
        (error: { code?: unknown; message: string }): SdkOutcome => ({
          outcome: "error",
          code: error.code,
          message: error.message,
        }),
      )
      .finally(() => {
        settled = true;
      });
    await answered;
    await responded;
    await new Promise((resolve) => setTimeout(resolve, 20));
    const settledBeforeRefusal = settled;

    refused.set("agent-a", SDK_REFUSAL);
    requests.refuse("agent-a", SDK_REFUSAL);

    const ending = await call;
    // Errors from closing the client afterwards are not part of the refusal.
    return { settledBeforeRefusal, ending, transportErrors: [...transportErrors] };
  } finally {
    (streamedBody as ReadableStreamDefaultController<Uint8Array> | null)?.close();
    await client.close();
  }
}

describe("the session's refusal, as the MCP SDK client sees it", () => {
  test.each<SdkRefusalCase>([
    "large-request",
    "result-without-terminator",
    "unfinished-result",
    "id-after-object",
    "escaped-key",
  ])(
    "a pending tool call whose event stream is under way ends in the refusal (%s)",
    async (mode) => {
      const { settledBeforeRefusal, ending, transportErrors } = await refuseSdkToolCall(mode);

      expect(settledBeforeRefusal).toBe(false);
      expect(ending).toEqual({
        outcome: "error",
        code: -32003,
        message: `MCP error -32003: ${SDK_REFUSAL}`,
      });
      expect(transportErrors).toEqual([]);
    },
    10_000,
  );
});

/** Error events (JSON-RPC messages) at the end of an event-stream answer. */
function errorEvents(
  text: string,
): Array<{ id: unknown; error: { code: number; message: string } }> {
  return text
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map(
      (line) =>
        JSON.parse(line.slice(6)) as { id: unknown; error: { code: number; message: string } },
    )
    .filter((message) => message.error !== undefined);
}

/** Sends `body` to an event-stream backend, refuses the agent once the stream is open, and reads the end. */
async function refuseOpenStream(body: string) {
  const requests = new McpGatewayRequests();
  let refused: string | null = null;
  const server = http.createServer((req, res) => {
    req.resume();
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write(": ready\n\n");
  });
  const backendUrl = await listen(server);
  closers.push(closeServer(server));
  const gateway = await startGateway({
    backends: { cluster: backendUrl },
    sessionIdentity: SESSION_IDENTITY,
    agentRefusal: () => refused,
    requests,
  });
  const request = http.request(`${gateway}/cluster`, {
    method: "POST",
    headers: { Authorization: "Bearer token-a", "content-type": "application/json" },
  });
  const answer = new Promise<{ status: number; text: string }>((resolve) => {
    request.on("response", (response) => {
      let text = "";
      response.on("data", (chunk: Buffer) => {
        text += chunk.toString("utf8");
        if (text.startsWith(": ready") && refused === null) {
          refused = "refused for the test";
          requests.refuse("agent-a", refused);
        }
      });
      response.on("end", () => resolve({ status: response.statusCode ?? 0, text }));
    });
  });
  request.end(body);
  return answer;
}

describe("the refusal names every valid request id", () => {
  test.each([1025, 1024 * 1024])(
    "a string id of %i characters is named in full",
    async (length) => {
      const id = "x".repeat(length);
      const { status, text } = await refuseOpenStream(
        JSON.stringify({ jsonrpc: "2.0", id, method: "x" }),
      );
      expect(status).toBe(200);
      const events = errorEvents(text);
      expect(events).toHaveLength(1);
      expect(events[0]?.id).toBe(id);
      expect(events[0]?.error).toEqual({ code: -32003, message: "refused for the test" });
    },
    20_000,
  );

  test.each([
    String.raw`{"\u0069d":7,"method":"x"}`,
    String.raw`{"i\u0064":7,"method":"x"}`,
    String.raw`{"\u0069\u0064":7,"method":"x"}`,
    String.raw`{"\u0049d":8,"\u0069d":7,"method":"x"}`,
  ])("an id whose member name is escaped is named: %s", async (body) => {
    const { text } = await refuseOpenStream(body);
    expect(errorEvents(text).map((event) => event.id)).toEqual([7]);
  });

  test("a complete body with a duplicate id names the one JSON.parse keeps, the last", async () => {
    const { text } = await refuseOpenStream('{"id":999,"jsonrpc":"2.0","method":"x","id":1}');
    expect(errorEvents(text).map((event) => event.id)).toEqual([1]);
  });
});

describe("a held answer whose backend stops sending", () => {
  test("a finite answer stalled after its head ends in a clean 504 once the backend's response timeout passes without a byte", async () => {
    const upstream = await startUpstream((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.write('{"jsonrpc":"2.0","id":1,"result":');
    });
    const requests = new McpGatewayRequests();
    const gateway = await startGateway({
      backends: { cluster: { url: upstream.url, responseTimeoutMs: 200 } },
      sessionIdentity: SESSION_IDENTITY,
      agentRefusal: () => null,
      requests,
    });
    const started = Date.now();
    const answer = await Promise.race([
      fetch(`${gateway}/cluster`, {
        method: "POST",
        headers: { Authorization: "Bearer token-a" },
        body: MCP_INIT,
      }).then(async (response) => ({ status: response.status, body: await response.text() })),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 3_000)),
    ]);

    expect(answer).toEqual({
      status: 504,
      body: JSON.stringify({ error: "MCP backend cluster stopped sending its answer for 200 ms" }),
    });
    expect(Date.now() - started).toBeLessThan(2_000);
  }, 10_000);
});

/** The most of one event the gateway holds back for an agent in session mode. */
const HELD_EVENT_LIMIT = 16 * 1024 * 1024;

describe("events held whole in session mode", () => {
  async function eventOfSize(size: number, terminated: boolean) {
    const upstream = await startUpstream((_req, res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      const data = "data: ";
      res.write(`${data}${"x".repeat(size - data.length)}`);
      if (terminated) res.end("\n\n");
    });
    const gateway = await startGateway({
      backends: { cluster: upstream.url },
      sessionIdentity: SESSION_IDENTITY,
      agentRefusal: () => null,
      requests: new McpGatewayRequests(),
    });
    return Promise.race([
      fetch(`${gateway}/cluster`, {
        method: "POST",
        headers: { Authorization: "Bearer token-a" },
        body: '{"jsonrpc":"2.0","id":5,"method":"tools/call"}',
      }).then(async (response) => ({ status: response.status, text: await response.text() })),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 5_000)),
    ]);
  }

  test("an event of at most 16 MiB is passed on whole", async () => {
    const answer = await eventOfSize(HELD_EVENT_LIMIT, true);
    expect(answer?.status).toBe(200);
    expect(answer?.text.length).toBe(HELD_EVENT_LIMIT + 2);
  }, 20_000);

  test("an event over 16 MiB is dropped and the stream ends with an error for the request", async () => {
    const answer = await eventOfSize(HELD_EVENT_LIMIT + 1, false);
    expect(answer?.status).toBe(200);
    expect(answer?.text.startsWith("data: x")).toBe(false);
    expect(errorEvents(answer?.text ?? "")).toEqual([
      {
        jsonrpc: "2.0",
        id: 5,
        error: {
          code: -32603,
          message:
            "MCP backend cluster sent an event of more than 16 MiB; in session mode an event is held whole before it is passed on, up to 16 MiB",
        },
      },
    ]);
  }, 20_000);
});

/** A result event of `size` bytes before its blank line, as a tool call's answer. */
function resultEvent(size: number): Buffer {
  const prefix =
    'event: message\ndata: {"jsonrpc":"2.0","id":5,"result":{"content":[{"type":"text","text":"';
  const suffix = '"}]}}';
  return Buffer.from(`${prefix}${"x".repeat(size - prefix.length - suffix.length)}${suffix}`);
}

/**
 * Streams `stream` from an event-stream backend: its first `split` bytes in
 * 64 KiB writes, then the rest in one last write, and reads the answer.
 */
async function streamInWrites(stream: Buffer, split: number) {
  const upstream = await startUpstream((_req, res) => {
    res.writeHead(200, { "content-type": "text/event-stream" });
    void (async () => {
      for (let offset = 0; offset < split; offset += 64 * 1024) {
        const ready = res.write(stream.subarray(offset, Math.min(split, offset + 64 * 1024)));
        if (!ready) await new Promise((resolve) => res.once("drain", resolve));
      }
      res.end(stream.subarray(split));
    })();
  });
  const gateway = await startGateway({
    backends: { cluster: upstream.url },
    sessionIdentity: SESSION_IDENTITY,
    agentRefusal: () => null,
    requests: new McpGatewayRequests(),
  });
  const response = await fetch(`${gateway}/cluster`, {
    method: "POST",
    headers: { Authorization: "Bearer token-a" },
    body: '{"jsonrpc":"2.0","id":5,"method":"tools/call"}',
  });
  return { status: response.status, text: await response.text() };
}

const OVERSIZED_EVENT_ERROR = {
  jsonrpc: "2.0",
  id: 5,
  error: {
    code: -32603,
    message:
      "MCP backend cluster sent an event of more than 16 MiB; in session mode an event is held whole before it is passed on, up to 16 MiB",
  },
};

describe("events bounded by their full size, however they are chunked", () => {
  const BLANK_LINE = Buffer.from("\n\n");

  test("an event over 16 MiB whose last bytes come with its blank line is refused", async () => {
    const stream = Buffer.concat([resultEvent(HELD_EVENT_LIMIT + 1), BLANK_LINE]);
    const answer = await streamInWrites(stream, HELD_EVENT_LIMIT - 256);
    expect(answer.status).toBe(200);
    expect(answer.text).not.toContain('"result"');
    expect(errorEvents(answer.text)).toEqual([OVERSIZED_EVENT_ERROR]);
  }, 20_000);

  test("an event over 16 MiB split exactly at the bound is refused", async () => {
    const stream = Buffer.concat([resultEvent(HELD_EVENT_LIMIT + 1), BLANK_LINE]);
    const answer = await streamInWrites(stream, HELD_EVENT_LIMIT);
    expect(answer.text).not.toContain('"result"');
    expect(errorEvents(answer.text)).toEqual([OVERSIZED_EVENT_ERROR]);
  }, 20_000);

  test("an event over 16 MiB in one chunk after a smaller event is refused, the smaller one passed on", async () => {
    const progress =
      'event: message\ndata: {"jsonrpc":"2.0","method":"notifications/progress","params":{}}\n\n';
    const stream = Buffer.concat([
      Buffer.from(progress),
      resultEvent(HELD_EVENT_LIMIT + 1),
      BLANK_LINE,
    ]);
    const answer = await streamInWrites(stream, 0);
    expect(answer.text.startsWith(progress)).toBe(true);
    expect(answer.text).not.toContain('"result"');
    expect(errorEvents(answer.text)).toEqual([OVERSIZED_EVENT_ERROR]);
  }, 20_000);

  test("an event of exactly 16 MiB passes whole, its blank line with its last bytes or after them", async () => {
    const stream = Buffer.concat([resultEvent(HELD_EVENT_LIMIT), BLANK_LINE]);
    for (const split of [HELD_EVENT_LIMIT - 256, HELD_EVENT_LIMIT]) {
      const answer = await streamInWrites(stream, split);
      expect(answer.status).toBe(200);
      expect(answer.text).toBe(stream.toString("utf8"));
    }
  }, 30_000);
});

/** The most of a finite answer the gateway holds for an agent in session mode. */
const HELD_ANSWER_LIMIT = 16 * 1024 * 1024;

describe("finite answers held in session mode", () => {
  async function answerOfSize(size: number) {
    const upstream = await startUpstream((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(Buffer.alloc(size, 0x20));
    });
    const gateway = await startGateway({
      backends: { cluster: upstream.url },
      sessionIdentity: SESSION_IDENTITY,
      agentRefusal: () => null,
      requests: new McpGatewayRequests(),
    });
    const response = await fetch(`${gateway}/cluster`, {
      method: "POST",
      headers: { Authorization: "Bearer token-a" },
      body: MCP_INIT,
    });
    return { status: response.status, body: Buffer.from(await response.arrayBuffer()) };
  }

  test("an answer of at most 16 MiB reaches the caller whole", async () => {
    const { status, body } = await answerOfSize(HELD_ANSWER_LIMIT);
    expect(status).toBe(200);
    expect(body.length).toBe(HELD_ANSWER_LIMIT);
  }, 20_000);

  test("an answer over 16 MiB is refused with a clear error, and none of it is passed on", async () => {
    const { status, body } = await answerOfSize(HELD_ANSWER_LIMIT + 1);
    expect(status).toBe(502);
    expect(JSON.parse(body.toString("utf8"))).toEqual({
      error:
        "MCP backend cluster answered more than 16 MiB; in session mode an answer is held whole before it is passed on, up to 16 MiB",
    });
  }, 20_000);
});

describe("resolveUpstreamUrl", () => {
  test("joins a plain suffix and both queries under the backend base path", () => {
    expect(
      resolveUpstreamUrl(new URL("http://backend.example/mcp?tenant=t1"), "a/b", "x=1")?.href,
    ).toBe("http://backend.example/mcp/a/b?tenant=t1&x=1");
    expect(resolveUpstreamUrl(new URL("http://backend.example"), "", "")?.href).toBe(
      "http://backend.example/",
    );
  });

  test.each([
    ["a dot-dot suffix", "../admin"],
    ["an encoded dot-dot suffix", "%2e%2e/admin"],
    ["a suffix that leaves the base path", "../mcp-other"],
    ["a fragment-bearing suffix", "a#b"],
    ["a query-bearing suffix", "a?b"],
  ])("returns null for %s whose resolved path leaves the base path", (_name, suffix) => {
    expect(resolveUpstreamUrl(new URL("http://backend.example/mcp"), suffix, "")).toBeNull();
  });
  test.each([
    ["an empty fragment marker in the suffix", "a#", ""],
    ["a fragment marker alone as the suffix", "#", ""],
    ["a fragment marker inside the suffix", "a#b/c", ""],
    ["a query ending in a fragment marker", "a", "x=1#"],
    ["a query holding a fragment", "a", "x=1#frag"],
    ["a query that is only a fragment marker", "", "#"],
  ])("returns null for %s", (_name, suffix, search) => {
    expect(resolveUpstreamUrl(new URL("http://backend.example/mcp"), suffix, search)).toBeNull();
  });
});
