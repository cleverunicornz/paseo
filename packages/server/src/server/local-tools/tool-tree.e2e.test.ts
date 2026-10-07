import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { existsSync, readdirSync } from "node:fs";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import pino from "pino";

import { createPaseoDaemon } from "../bootstrap.js";
import type { AgentClient, AgentLaunchContext } from "../agent/agent-sdk-types.js";
import { createTestAgentClients } from "../test-utils/fake-agent-client.js";
import { resolveTestCodexBinary } from "../test-utils/codex-binary.js";

const codexPath = resolveTestCodexBinary();

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

async function waitForPath(target: string, timeoutMs = 15_000): Promise<void> {
  const start = Date.now();
  while (!existsSync(target)) {
    if (Date.now() - start > timeoutMs) throw new Error(`Timed out waiting for ${target}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

interface RecordedLaunch {
  context: AgentLaunchContext | undefined;
  /** The tree's files that existed when the harness was started. */
  treeFilesAtLaunch: string[];
}

function recordLaunchContexts(
  clients: Record<string, AgentClient>,
  seen: RecordedLaunch[],
): Record<string, AgentClient> {
  const claude = clients.claude!;
  const recording = Object.create(claude) as AgentClient;
  recording.createSession = (config, launchContext, options) => {
    const tree = launchContext?.env?.PASEO_TOOL_TREE;
    const treeFilesAtLaunch =
      tree && existsSync(tree)
        ? readdirSync(tree, { recursive: true, encoding: "utf8" }).map((entry) =>
            entry.split(path.sep).join("/"),
          )
        : [];
    seen.push({ context: launchContext, treeFilesAtLaunch });
    return claude.createSession(config, launchContext, options);
  };
  return { ...clients, claude: recording };
}

/** A stateless MCP backend whose `whoami` answers with the agent identity the gateway attached. */
async function serveFixtureBackend(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  withExtraTool: boolean,
): Promise<void> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const agentId = String(req.headers["x-paseo-agent-id"]);
  const mcp = new McpServer({ name: "fixture", version: "1.0.0" });
  mcp.registerTool("whoami", { description: "Who is calling.", inputSchema: {} }, async () => ({
    content: [{ type: "text", text: agentId }],
  }));
  if (withExtraTool) {
    mcp.registerTool("added_later", { inputSchema: {} }, async () => ({ content: [] }));
  }
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => {
    void transport.close();
    void mcp.close();
  });
  await mcp.connect(transport);
  const body = Buffer.concat(chunks).toString("utf8");
  await transport.handleRequest(req, res, body ? JSON.parse(body) : undefined);
}

describe.skipIf(!codexPath)("tool tree (daemon)", () => {
  let root: string;
  let paseoHome: string;
  let daemon: Awaited<ReturnType<typeof createPaseoDaemon>>;
  let backend: http.Server;
  let port: number;
  let backendHasExtraTool = false;
  const launches: RecordedLaunch[] = [];

  beforeAll(async () => {
    root = await realpath(await mkdtemp(path.join(os.tmpdir(), "paseo-tool-tree-e2e-")));
    paseoHome = path.join(root, "home");
    await mkdir(paseoHome);
    await mkdir(path.join(root, "static"));

    backend = http.createServer((req, res) => {
      void serveFixtureBackend(req, res, backendHasExtraTool);
    });
    await new Promise<void>((resolve) => backend.listen(0, "127.0.0.1", resolve));
    const backendPort = (backend.address() as net.AddressInfo).port;

    port = await getAvailablePort();
    daemon = await createPaseoDaemon(
      {
        listen: `127.0.0.1:${port}`,
        paseoHome,
        corsAllowedOrigins: [],
        hostnames: true,
        mcpEnabled: true,
        staticDir: path.join(root, "static"),
        mcpDebug: false,
        agentClients: recordLaunchContexts(createTestAgentClients(), launches),
        agentStoragePath: path.join(paseoHome, "agents"),
        mcpGatewayBackends: { fixture: { url: `http://127.0.0.1:${backendPort}/mcp` } },
        localTools: { codexPath: codexPath! },
        toolTree: { enabled: true },
      },
      pino({ level: "silent" }),
    );
    await daemon.start();
  }, 60_000);

  afterAll(async () => {
    await daemon?.stop();
    backend?.closeAllConnections();
    await new Promise<void>((resolve) => backend?.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  });

  test("each agent gets a tree of Paseo's and every backend's tools, callable from its scripts", async () => {
    const cwd = path.join(root, "workspace");
    await mkdir(cwd);
    await writeFile(path.join(cwd, "marker.txt"), "tree workspace\n");
    const agent = await daemon.agentManager.createAgent(
      { provider: "claude", cwd, title: "Tree agent" },
      undefined,
      { workspaceId: undefined },
    );
    const tree = path.join(paseoHome, "tool-trees", agent.id);
    const launch = launches.at(-1);
    expect(launch?.context?.env?.PASEO_TOOL_TREE).toBe(tree);
    // The tree exists with Paseo's tools before the harness starts.
    expect(launch?.treeFilesAtLaunch).toEqual(
      expect.arrayContaining(["client.ts", "servers/paseo/exec.ts", "servers/paseo/read_file.ts"]),
    );
    // The gateway answers for the agent once it is registered; its backends follow.
    await waitForPath(path.join(tree, "servers/fixture/whoami.ts"));
    expect(existsSync(path.join(tree, "servers/paseo/exec.ts"))).toBe(true);

    const token = daemon.agentManager.issueAgentToken(agent.id);
    const client = new Client({ name: "tree-test", version: "1.0.0" });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp/agents`), {
        requestInit: { headers: { Authorization: `Bearer ${token}` } },
      }),
    );
    try {
      const script = [
        "const tree = process.env.PASEO_TOOL_TREE;",
        'const { whoami } = await import(tree + "/servers/fixture/whoami.ts");',
        'const { readFile } = await import(tree + "/servers/paseo/read_file.ts");',
        "const who = await whoami();",
        'const marker = await readFile({ path: "marker.txt" });',
        "console.log(JSON.stringify({ who: who[0].text, marker: marker.content }));",
      ].join("\n");
      await client.callTool({
        name: "write_file",
        arguments: { path: "use-tree.ts", content: script },
      });
      const ran = (await client.callTool({
        name: "exec",
        arguments: {
          command: ["node", "--experimental-strip-types", "--no-warnings", "use-tree.ts"],
        },
      })) as { structuredContent?: { stdout?: string; stderr?: string } };
      expect(ran.structuredContent?.stderr).toBe("");
      expect(JSON.parse(ran.structuredContent?.stdout ?? "null")).toEqual({
        who: agent.id,
        marker: "tree workspace\n",
      });

      // A changed tool list reaches the tree the next time the agent lists its tools.
      backendHasExtraTool = true;
      await client.listTools();
      await waitForPath(path.join(tree, "servers/fixture/added_later.ts"));
    } finally {
      await client.close();
    }
  });
});
