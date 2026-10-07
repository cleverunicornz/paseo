import http from "node:http";
import type net from "node:net";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { DaemonClient } from "../test-utils/daemon-client.js";
import { createTestPaseoDaemon, type TestPaseoDaemon } from "../test-utils/paseo-daemon.js";

interface RecordedRequest {
  method: string | undefined;
  headers: http.IncomingHttpHeaders;
}

/** A stateless MCP backend whose `whoami` answers with the agent identity the gateway attached. */
function startFixtureBackend(recorded: RecordedRequest[]): Promise<http.Server> {
  const server = http.createServer((req, res) => {
    void (async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const raw = Buffer.concat(chunks).toString("utf8");
      const body = raw ? (JSON.parse(raw) as { method?: string }) : undefined;
      recorded.push({ method: body?.method, headers: req.headers });
      const mcp = new McpServer({ name: "fixture", version: "1.0.0" });
      mcp.registerTool("whoami", { inputSchema: {} }, async () => ({
        content: [{ type: "text", text: String(req.headers["x-paseo-agent-id"]) }],
      }));
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      res.on("close", () => {
        void transport.close();
        void mcp.close();
      });
      await mcp.connect(transport);
      await transport.handleRequest(req, res, body);
    })();
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

let backend: http.Server;
let daemon: TestPaseoDaemon;
let directory: string;
const recorded: RecordedRequest[] = [];

beforeEach(async () => {
  recorded.length = 0;
  backend = await startFixtureBackend(recorded);
  const backendPort = (backend.address() as net.AddressInfo).port;
  directory = await mkdtemp(path.join(tmpdir(), "paseo-plugin-gateway-"));
  daemon = await createTestPaseoDaemon({
    daemonVersion: "0.8.0",
    mcpGatewayBackends: { memory: { url: `http://127.0.0.1:${backendPort}/mcp` } },
  });
});

afterEach(async () => {
  await daemon.close();
  backend.closeAllConnections();
  await new Promise<void>((resolve) => backend.close(() => resolve()));
  await rm(directory, { recursive: true, force: true });
});

test("a plugin calls a gateway backend as an agent, through the agent's hook and headers, without its token", async () => {
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
  const client = new DaemonClient({ url: `ws://127.0.0.1:${daemon.port}/ws`, appVersion: "0.8.0" });
  await client.connect();
  try {
    await client.patchDaemonConfig({ pluginsEnabled: true });
    await client.installDirectoryPlugin(directory);
    const agent = await client.createAgent({
      provider: "codex",
      cwd: directory,
      title: "Called for",
    });

    await expect
      .poll(async () => await readFile(path.join(directory, "events.log"), "utf8").catch(() => ""))
      .toContain("unknownAgent");
    const text = await readFile(path.join(directory, "events.log"), "utf8");
    const logged = text
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>);

    expect(logged).toEqual([
      { keys: ["callTool"] },
      { result: { content: [{ type: "text", text: agent.id }] } },
      { unknownAgent: expect.stringContaining("No live agent no-such-agent") },
    ]);
    const toolCall = recorded.find((request) => request.method === "tools/call");
    expect(toolCall?.headers).toMatchObject({
      "x-paseo-agent-id": agent.id,
      "x-paseo-server-id": expect.any(String),
      "x-recorder-hook": agent.id,
    });
    expect(toolCall?.headers.authorization).toBeUndefined();
    // Nothing the plugin saw, and nothing the backend saw, carries the agent's token.
    const token = daemon.daemon.agentManager.issueAgentToken(agent.id);
    expect(text).not.toContain(token);
    expect(JSON.stringify(recorded)).not.toContain(token);
  } finally {
    await client.close();
  }
});
