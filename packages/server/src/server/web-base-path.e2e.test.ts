import http from "node:http";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { WebSocket } from "ws";
import { resolveConfigFromPersisted } from "./config.js";
import { DaemonClient } from "./test-utils/daemon-client.js";
import { createTestPaseoDaemon, type TestPaseoDaemon } from "./test-utils/paseo-daemon.js";
import { startPrefixProxy, type PrefixProxy } from "./test-utils/prefix-proxy.js";

const BUNDLE = "/_expo/static/js/web/index-0123456789abcdef0123.js";

interface Answer {
  status: number;
  body: string;
}

function send(input: {
  port: number;
  path: string;
  host: string;
  method?: string;
  body?: string;
}): Promise<Answer> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port: input.port,
        path: input.path,
        method: input.method ?? "GET",
        headers: {
          host: input.host,
          ...(input.body
            ? { "content-type": "application/json", accept: "application/json, text/event-stream" }
            : {}),
        },
      },
      (res) => {
        let body = "";
        res.on("data", (chunk: Buffer) => {
          body += chunk.toString("utf8");
        });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
      },
    );
    req.on("error", reject);
    req.end(input.body);
  });
}

function upgrade(port: number, urlPath: string, host: string): Promise<"open" | number> {
  return new Promise((resolve) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}${urlPath}`, { headers: { host } });
    socket.on("open", () => {
      socket.close();
      resolve("open");
    });
    socket.on("unexpected-response", (_req, res) => resolve(res.statusCode ?? 0));
    socket.on("error", () => undefined);
  });
}

let root: string;
let daemon: TestPaseoDaemon;
let proxy: PrefixProxy;
let proxyHost: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "paseo-base-path-"));
  const distDir = path.join(root, "web-ui");
  await mkdir(path.join(distDir, path.dirname(BUNDLE)), { recursive: true });
  await writeFile(
    path.join(distDir, "index.html"),
    `<html><head><link rel="icon" href="/favicon.ico" /></head><body><script src="${BUNDLE}" defer></script></body></html>`,
  );
  await writeFile(path.join(distDir, BUNDLE), "globalThis.bundleLoaded = true;");
  // The deployment sets both through the environment, without editing a file.
  const config = resolveConfigFromPersisted(
    root,
    {},
    { env: { PASEO_HOSTNAMES: "dash.example", PASEO_WEB_BASE_PATH: "/s/x/" } },
  );
  daemon = await createTestPaseoDaemon({
    hostnames: config.hostnames,
    sessionRuntime: config.sessionRuntime,
    webUi: { enabled: true, distDir },
  });
  proxy = await startPrefixProxy({ prefix: "/s/x/", targetPort: daemon.port });
  proxyHost = `dash.example:${proxy.port}`;
});

afterEach(async () => {
  await proxy.close();
  await daemon.close();
  await rm(root, { recursive: true, force: true });
});

test("behind a prefix-preserving proxy the web UI, /api, /mcp and /ws all answer under the base path", async () => {
  const index = await send({ port: proxy.port, path: "/s/x/", host: proxyHost });
  expect(index.status).toBe(200);
  expect(index.body).toContain(`src="/s/x${BUNDLE}"`);
  expect(index.body).toContain('href="/s/x/favicon.ico"');
  expect(index.body).toContain(`"listen":"${proxyHost}"`);
  expect(index.body).toContain('"basePath":"/s/x/"');

  // A deep link reloads to the same app.
  const deepLink = await send({
    port: proxy.port,
    path: "/s/x/h/srv/workspace/w",
    host: proxyHost,
  });
  expect(deepLink.body).toContain(`src="/s/x${BUNDLE}"`);

  const bundle = await send({ port: proxy.port, path: `/s/x${BUNDLE}`, host: proxyHost });
  expect(bundle).toEqual({ status: 200, body: "globalThis.bundleLoaded = true;" });

  const health = await send({ port: proxy.port, path: "/s/x/api/health", host: proxyHost });
  expect(health.status).toBe(200);
  expect(JSON.parse(health.body)).toMatchObject({ status: "ok" });
  const readiness = await send({
    port: proxy.port,
    path: "/s/x/api/stop-readiness",
    host: proxyHost,
  });
  expect(JSON.parse(readiness.body)).toMatchObject({ ready: false });

  // /mcp answers under the prefix exactly as it does at the daemon's root.
  const initialize = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "t", version: "1" },
    },
  });
  const viaProxy = await send({
    port: proxy.port,
    path: "/s/x/mcp/agents",
    host: proxyHost,
    method: "POST",
    body: initialize,
  });
  const direct = await send({
    port: daemon.port,
    path: "/mcp/agents",
    host: `127.0.0.1:${daemon.port}`,
    method: "POST",
    body: initialize,
  });
  expect(viaProxy.status).not.toBe(404);
  expect(viaProxy.status).toBe(direct.status);

  expect(await upgrade(proxy.port, "/s/x/ws", proxyHost)).toBe("open");

  // A full client session through the proxy.
  const client = new DaemonClient({ url: `ws://127.0.0.1:${proxy.port}/s/x/ws` });
  try {
    await client.connect();
    expect((await client.fetchAgents()).entries).toEqual([]);
  } finally {
    await client.close();
  }
});

test("a Host outside PASEO_HOSTNAMES is refused on HTTP and on the WebSocket", async () => {
  const evil = `evil.example:${proxy.port}`;

  expect((await send({ port: proxy.port, path: "/s/x/api/health", host: evil })).status).toBe(403);
  expect(await upgrade(proxy.port, "/s/x/ws", evil)).toBe(403);
});
