import http from "node:http";
import https from "node:https";
import type { IncomingHttpHeaders, OutgoingHttpHeaders } from "node:http";
import type express from "express";
import type { Logger } from "pino";
import type { PluginMcpGatewayUpstreamRequest } from "@getpaseo/plugin/server";

import { extractHttpBearerToken } from "../auth.js";
import { MCP_GATEWAY_BACKEND_NAME_PATTERN } from "./backends.js";

export type McpGatewayUpstreamRequest = PluginMcpGatewayUpstreamRequest;

export interface McpGatewayAgent {
  agentId: string;
  sessionId: string | null;
  workspaceId: string | null;
}

export interface McpGatewayOptions {
  getBackends: () => ReadonlyMap<string, string>;
  /** Resolves the caller from its daemon-issued bearer token; nothing else names a caller. */
  resolveAgent: (token: string | null) => McpGatewayAgent | null;
  serverId: string;
  /** Runs the `mcp_gateway.upstream` plugin hooks. */
  resolveUpstream: (request: McpGatewayUpstreamRequest) => Promise<McpGatewayUpstreamRequest>;
  /** How long to wait for the backend's response headers. Streams are not limited once they start. */
  responseTimeoutMs?: number;
  logger: Logger;
}

const DEFAULT_RESPONSE_TIMEOUT_MS = 30_000;

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

const IDENTITY_HEADER_PREFIX = "x-paseo-";

type ParsedTarget =
  | { kind: "backend"; backend: string; suffix: string; search: string }
  | { kind: "unknown" }
  | { kind: "invalid" };

function decodeSegment(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

const MAX_DECODE_ROUNDS = 8;
const URL_SCHEME_PATTERN = /^[A-Za-z][A-Za-z0-9+.-]*:/;
// Unicode controls (C0, DEL, C1), format characters, line and paragraph
// separators, and the whole U+2060–U+2069 block.
// oxlint-disable-next-line no-control-regex -- control characters are what this matches.
const CONTROL_CHARACTER_PATTERN = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\u2060-\u2069]/u;

/**
 * Decodes until the value stops changing, so every layer of percent-encoding
 * is judged at once. Null when an escape is malformed or decoding never settles.
 */
function decodeCompletely(value: string): string | null {
  let current = value;
  for (let round = 0; round < MAX_DECODE_ROUNDS; round += 1) {
    const next = decodeSegment(current);
    if (next === null) return null;
    if (next === current) return current;
    current = next;
  }
  return null;
}

/**
 * A suffix segment the backend sees as one plain path segment under its base
 * path: it decodes cleanly at every layer, and its fully decoded form is not a
 * dot segment, holds no separator, query or fragment delimiter, or control or
 * format character, and is not a URL. Empty segments (`//`) are allowed only
 * as a trailing slash.
 */
function isPlainSuffixSegment(segment: string, isLast: boolean): boolean {
  const decoded = decodeCompletely(segment);
  if (decoded === null) return false;
  if (decoded === "") return isLast;
  return (
    decoded !== "." &&
    decoded !== ".." &&
    !decoded.includes("/") &&
    !decoded.includes("\\") &&
    !decoded.includes("?") &&
    !decoded.includes("#") &&
    !CONTROL_CHARACTER_PATTERN.test(decoded) &&
    !URL_SCHEME_PATTERN.test(decoded)
  );
}

/**
 * Splits `/<backend>/<suffix>?<query>` (relative to the gateway mount). The
 * suffix stays percent-encoded for the backend, and every segment must be a
 * plain path segment, so a request always stays under the configured backend
 * path on the configured host. A target holding a literal `#` anywhere is
 * invalid, whatever the backend name.
 */
function parseTarget(rawUrl: string): ParsedTarget {
  if (rawUrl.includes("#")) {
    return { kind: "invalid" };
  }
  const queryIndex = rawUrl.indexOf("?");
  const pathname = queryIndex < 0 ? rawUrl : rawUrl.slice(0, queryIndex);
  const search = queryIndex < 0 ? "" : rawUrl.slice(queryIndex + 1);
  const [rawBackend = "", ...rest] = pathname.replace(/^\//, "").split("/");
  const backend = decodeSegment(rawBackend);
  if (backend === null || !MCP_GATEWAY_BACKEND_NAME_PATTERN.test(backend)) {
    return { kind: "unknown" };
  }
  if (pathname.includes("\\")) {
    return { kind: "invalid" };
  }
  const plain = rest.every((segment, index) =>
    isPlainSuffixSegment(segment, index === rest.length - 1),
  );
  if (!plain) {
    return { kind: "invalid" };
  }
  return { kind: "backend", backend, suffix: rest.join("/"), search };
}

/**
 * Joins the base URL, the validated suffix and both queries, and returns the
 * result only when no part holds a fragment marker and it stays on the base
 * origin, under the base path, with exactly the joined query.
 */
export function resolveUpstreamUrl(base: URL, suffix: string, search: string): URL | null {
  if (suffix.includes("#") || search.includes("#") || base.href.includes("#")) {
    return null;
  }
  const basePath = base.pathname.replace(/\/$/, "");
  const path = suffix ? `${basePath}/${suffix}` : basePath || "/";
  const query = [base.search.replace(/^\?/, ""), search]
    .filter((part) => part.length > 0)
    .join("&");
  let resolved: URL;
  let expectedSearch = "";
  try {
    resolved = new URL(`${path}${query ? `?${query}` : ""}`, base.origin);
    if (query) {
      expectedSearch = new URL(`/?${query}`, base.origin).search;
    }
  } catch {
    return null;
  }
  const underBasePath =
    basePath === "" ||
    resolved.pathname === basePath ||
    resolved.pathname.startsWith(`${basePath}/`);
  if (
    resolved.origin !== base.origin ||
    !underBasePath ||
    resolved.hash !== "" ||
    resolved.search !== expectedSearch
  ) {
    return null;
  }
  return resolved;
}

function connectionListedHeaders(headers: IncomingHttpHeaders): Set<string> {
  const value = headers.connection;
  const listed = new Set<string>();
  for (const token of (Array.isArray(value) ? value.join(",") : (value ?? "")).split(",")) {
    const name = token.trim().toLowerCase();
    if (name) listed.add(name);
  }
  return listed;
}

function isHopByHop(name: string, connectionListed: Set<string>): boolean {
  return HOP_BY_HOP_HEADERS.has(name) || connectionListed.has(name);
}

function buildUpstreamHeaders(input: {
  incoming: IncomingHttpHeaders;
  pluginHeaders: Record<string, string>;
  agent: McpGatewayAgent;
  serverId: string;
}): OutgoingHttpHeaders {
  const connectionListed = connectionListedHeaders(input.incoming);
  const headers: OutgoingHttpHeaders = {};
  for (const [name, value] of Object.entries(input.incoming)) {
    if (value === undefined) continue;
    // The caller's Authorization and X-Paseo-* headers stay at the daemon; the
    // daemon sets the identity headers below.
    if (
      isHopByHop(name, connectionListed) ||
      name === "host" ||
      name === "authorization" ||
      name.startsWith(IDENTITY_HEADER_PREFIX)
    ) {
      continue;
    }
    headers[name] = value;
  }
  for (const [rawName, value] of Object.entries(input.pluginHeaders)) {
    const name = rawName.toLowerCase();
    if (isHopByHop(name, new Set()) || name === "host" || name.startsWith(IDENTITY_HEADER_PREFIX)) {
      continue;
    }
    headers[name] = value;
  }
  headers["x-paseo-agent-id"] = input.agent.agentId;
  if (input.agent.sessionId) headers["x-paseo-session-id"] = input.agent.sessionId;
  if (input.agent.workspaceId) headers["x-paseo-workspace-id"] = input.agent.workspaceId;
  headers["x-paseo-server-id"] = input.serverId;
  return headers;
}

function buildResponseHeaders(incoming: IncomingHttpHeaders): OutgoingHttpHeaders {
  const connectionListed = connectionListedHeaders(incoming);
  const headers: OutgoingHttpHeaders = {};
  for (const [name, value] of Object.entries(incoming)) {
    if (value === undefined || isHopByHop(name, connectionListed)) continue;
    headers[name] = value;
  }
  return headers;
}

function sendError(res: express.Response, status: number, error: string): void {
  if (res.headersSent || res.destroyed) {
    res.destroy();
    return;
  }
  res.status(status).json({ error });
}

/**
 * The daemon's MCP gateway, mounted at `/mcp/backends`. An agent reaches a
 * configured backend by name through its own daemon; the daemon authenticates
 * the agent by its token, strips caller-supplied credentials and identity
 * headers, attaches the identity it knows plus any plugin-supplied upstream
 * credential, and proxies MCP Streamable HTTP both ways without buffering.
 */
export function createMcpGatewayHandler(options: McpGatewayOptions): express.RequestHandler {
  const logger = options.logger.child({ module: "mcp-gateway" });
  const responseTimeoutMs = options.responseTimeoutMs ?? DEFAULT_RESPONSE_TIMEOUT_MS;

  const handle = async (req: express.Request, res: express.Response): Promise<void> => {
    const agent = options.resolveAgent(extractHttpBearerToken(req.headers.authorization));
    if (!agent) {
      sendError(res, 401, "Unauthorized");
      return;
    }
    const target = parseTarget(req.url);
    if (target.kind === "invalid") {
      sendError(res, 400, "Invalid MCP backend path");
      return;
    }
    if (target.kind === "unknown") {
      sendError(res, 404, "Unknown MCP backend");
      return;
    }
    const { backend } = target;

    let upstream: McpGatewayUpstreamRequest;
    try {
      upstream = await options.resolveUpstream({
        backend,
        agentId: agent.agentId,
        sessionId: agent.sessionId,
        workspaceId: agent.workspaceId,
        url: options.getBackends().get(backend) ?? null,
        headers: {},
      });
    } catch (error) {
      logger.warn(
        { err: error, backend, agentId: agent.agentId },
        "MCP gateway upstream hook failed",
      );
      sendError(res, 502, `MCP backend ${backend} upstream credentials unavailable`);
      return;
    }
    if (!upstream.url) {
      sendError(res, 404, `Unknown MCP backend: ${backend}`);
      return;
    }
    if (res.destroyed || req.destroyed) {
      return;
    }

    const base = new URL(upstream.url);
    const upstreamUrl = resolveUpstreamUrl(base, target.suffix, target.search);
    if (!upstreamUrl) {
      sendError(res, 400, "Invalid MCP backend path");
      return;
    }
    const transport = base.protocol === "https:" ? https : http;
    let upstreamRequest: http.ClientRequest;
    try {
      upstreamRequest = transport.request({
        protocol: base.protocol,
        hostname: base.hostname.replace(/^\[(.*)\]$/, "$1"),
        port: base.port || undefined,
        method: req.method,
        path: `${upstreamUrl.pathname}${upstreamUrl.search}`,
        headers: buildUpstreamHeaders({
          incoming: req.headers,
          pluginHeaders: upstream.headers,
          agent,
          serverId: options.serverId,
        }),
      });
    } catch (error) {
      logger.warn({ err: error, backend, agentId: agent.agentId }, "MCP gateway request rejected");
      sendError(res, 502, `MCP backend ${backend} request could not be built`);
      return;
    }

    let timedOut = false;
    const responseTimer = setTimeout(() => {
      timedOut = true;
      logger.warn({ backend, agentId: agent.agentId }, "MCP backend did not answer");
      sendError(res, 504, `MCP backend ${backend} did not answer`);
      upstreamRequest.destroy();
    }, responseTimeoutMs);

    upstreamRequest.on("response", (upstreamResponse) => {
      clearTimeout(responseTimer);
      if (res.headersSent || res.destroyed) {
        upstreamResponse.destroy();
        return;
      }
      res.writeHead(
        upstreamResponse.statusCode ?? 502,
        upstreamResponse.statusMessage,
        buildResponseHeaders(upstreamResponse.headers),
      );
      res.flushHeaders();
      upstreamResponse.on("error", () => res.destroy());
      upstreamResponse.pipe(res);
    });
    upstreamRequest.on("error", (error) => {
      clearTimeout(responseTimer);
      if (timedOut) return;
      logger.warn({ err: error, backend, agentId: agent.agentId }, "MCP backend unreachable");
      sendError(res, 502, `MCP backend ${backend} is unreachable`);
    });
    res.on("close", () => {
      clearTimeout(responseTimer);
      if (!res.writableFinished) {
        upstreamRequest.destroy();
      }
    });
    req.pipe(upstreamRequest);
  };

  return (req, res) => {
    void handle(req, res).catch((error: unknown) => {
      logger.error({ err: error }, "MCP gateway request failed");
      sendError(res, 500, "MCP gateway error");
    });
  };
}
