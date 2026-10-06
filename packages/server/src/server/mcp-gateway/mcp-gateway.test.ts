import http from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import pino from "pino";
import { afterEach, describe, expect, test } from "vitest";

import {
  createMcpGatewayHandler,
  type McpGatewayAgent,
  type McpGatewayUpstreamRequest,
} from "./mcp-gateway.js";

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

const AGENTS: Record<string, McpGatewayAgent> = {
  "token-a": { agentId: "agent-a", sessionId: "session-a", workspaceId: "workspace-a" },
  "token-b": { agentId: "agent-b", sessionId: null, workspaceId: null },
};

interface GatewayOptions {
  backends: Record<string, string>;
  resolveUpstream?: (request: McpGatewayUpstreamRequest) => Promise<McpGatewayUpstreamRequest>;
  responseTimeoutMs?: number;
}

async function startGateway(options: GatewayOptions): Promise<string> {
  const app = express();
  app.use(
    "/mcp/backends",
    createMcpGatewayHandler({
      getBackends: () => new Map(Object.entries(options.backends)),
      resolveAgent: (token) => (token ? (AGENTS[token] ?? null) : null),
      serverId: "server-1",
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

  test("never forwards a forged X-Paseo-* or Authorization header from the agent", async () => {
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
        "X-Paseo-Anything": "forged",
        "Proxy-Authorization": "Basic forged",
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

  test("refuses an unknown backend name and never takes a URL from the caller", async () => {
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
    ["an empty leading segment", "//evil.example/mcp"],
    ["an encoded leading double slash", "/%2F%2Fevil.example/mcp"],
    ["a URL with a scheme", "/https://evil.example/mcp"],
    ["an encoded URL with a scheme", "/https%3A%2F%2Fevil.example%2Fmcp"],
    ["a double-encoded URL with a scheme", "/http%253A%252F%252Fevil.example"],
    ["a scheme-only segment", "/javascript:alert"],
    ["a URL with a scheme after other segments", "/x/http:%2f%2fevil.example"],
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
      // Never respond.
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
            "X-Paseo-Agent-ID": "plugin-cannot-change-identity",
          },
        };
      },
    });

    await fetch(`${gateway}/cluster`, {
      method: "POST",
      headers: { Authorization: "Bearer token-a", "X-Paseo-Agent-ID": "forged" },
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
