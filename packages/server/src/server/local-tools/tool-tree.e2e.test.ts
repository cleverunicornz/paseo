import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
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
  const record = (launchContext: AgentLaunchContext | undefined): void => {
    const tree = launchContext?.env?.PASEO_TOOL_TREE;
    const treeFilesAtLaunch =
      tree && existsSync(tree)
        ? readdirSync(tree, { recursive: true, encoding: "utf8" }).map((entry) =>
            entry.split(path.sep).join("/"),
          )
        : [];
    seen.push({ context: launchContext, treeFilesAtLaunch });
  };
  recording.createSession = (config, launchContext, options) => {
    record(launchContext);
    return claude.createSession(config, launchContext, options);
  };
  recording.resumeSession = (handle, overrides, launchContext, options) => {
    record(launchContext);
    return claude.resumeSession(handle, overrides, launchContext, options);
  };
  return { ...clients, claude: recording };
}

const BETA_TOOLS = ["beta_one", "beta_two", "beta_three"];

interface FixtureBackend {
  name: string;
  registerTools: (mcp: McpServer, agentId: string) => void;
  /** Runs before a `tools/list` request is answered. */
  beforeList?: () => Promise<void>;
  /** Runs once a `tools/list` response has been sent. */
  afterList?: () => void;
}

/** A stateless MCP backend. */
async function serveFixtureBackend(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  backend: FixtureBackend,
): Promise<void> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");
  const body = raw ? (JSON.parse(raw) as { method?: string }) : undefined;
  if (body?.method === "tools/list") {
    await backend.beforeList?.();
    res.on("finish", () => backend.afterList?.());
  }
  const mcp = new McpServer({ name: backend.name, version: "1.0.0" });
  backend.registerTools(mcp, String(req.headers["x-paseo-agent-id"]));
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => {
    void transport.close();
    void mcp.close();
  });
  await mcp.connect(transport);
  await transport.handleRequest(req, res, body);
}

describe.skipIf(!codexPath)("tool tree (daemon)", () => {
  let root: string;
  let paseoHome: string;
  let daemon: Awaited<ReturnType<typeof createPaseoDaemon>>;
  let backend: http.Server;
  let port: number;
  let backendHasExtraTool = false;
  let backendFails = false;
  let betaFails = false;
  let betaListings = 0;
  /** While set, the next `fixture` listing waits for `release`. */
  let fixtureListingHold: { reached: () => void; release: Promise<void> } | null = null;
  const launches: RecordedLaunch[] = [];

  const fixture: FixtureBackend = {
    name: "fixture",
    registerTools: (mcp, agentId) => {
      // `whoami` answers with the agent identity the gateway attached.
      mcp.registerTool("whoami", { description: "Who is calling.", inputSchema: {} }, async () => ({
        content: [{ type: "text", text: agentId }],
      }));
      if (backendHasExtraTool) {
        mcp.registerTool("added_later", { inputSchema: {} }, async () => ({ content: [] }));
      }
    },
    beforeList: async () => {
      const hold = fixtureListingHold;
      if (!hold) return;
      fixtureListingHold = null;
      hold.reached();
      await hold.release;
    },
  };
  const beta: FixtureBackend = {
    name: "beta",
    registerTools: (mcp) => {
      for (const name of BETA_TOOLS) {
        mcp.registerTool(name, { inputSchema: {} }, async () => ({ content: [] }));
      }
    },
    afterList: () => {
      betaListings += 1;
    },
  };

  async function waitFor(check: () => boolean, what: string): Promise<void> {
    const start = Date.now();
    while (!check()) {
      if (Date.now() - start > 15_000) throw new Error(`Timed out waiting for ${what}`);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }

  /**
   * Starts a launch and holds its tree discovery open after `beta` has answered; meanwhile the agent
   * lists its own tools, which queues an ordinary refresh, and `beta` fails for that queued pass.
   */
  async function launchOverlappedByOrdinaryRefresh(
    agentId: string,
    launch: () => Promise<unknown>,
  ): Promise<{ launched: Promise<unknown> }> {
    let reached!: () => void;
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      reached = resolve;
    });
    fixtureListingHold = {
      reached,
      release: new Promise<void>((resolve) => {
        release = resolve;
      }),
    };
    const betaListingsBefore = betaListings;
    const launched = launch();
    launched.catch(() => undefined);
    const client = new Client({ name: "tree-overlap", version: "1.0.0" });
    try {
      await held;
      await waitFor(() => betaListings > betaListingsBefore, "beta's launch listing");
      await client.connect(
        new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp/agents`), {
          requestInit: {
            headers: {
              Authorization: `Bearer ${daemon.agentManager.issueAgentToken(agentId)}`,
            },
          },
        }),
      );
      await client.listTools();
      betaFails = true;
    } finally {
      fixtureListingHold = null;
      release();
      await client.close();
    }
    return { launched };
  }

  beforeAll(async () => {
    root = await realpath(await mkdtemp(path.join(os.tmpdir(), "paseo-tool-tree-e2e-")));
    paseoHome = path.join(root, "home");
    await mkdir(paseoHome);
    await mkdir(path.join(root, "static"));

    backend = http.createServer((req, res) => {
      const isBeta = req.url?.startsWith("/beta") === true;
      if (backendFails || (isBeta && betaFails)) {
        res.writeHead(503).end();
        return;
      }
      void serveFixtureBackend(req, res, isBeta ? beta : fixture);
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
        mcpGatewayBackends: {
          fixture: { url: `http://127.0.0.1:${backendPort}/mcp` },
          beta: { url: `http://127.0.0.1:${backendPort}/beta` },
        },
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
    // The whole tree, Paseo's tools and every backend's, exists before the harness starts.
    expect(launch?.treeFilesAtLaunch).toEqual(
      expect.arrayContaining([
        "client.ts",
        "servers/paseo/exec.ts",
        "servers/paseo/read_file.ts",
        "servers/fixture/whoami.ts",
        ...BETA_TOOLS.map((name) => `servers/beta/${name}.ts`),
      ]),
    );

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

  test("an agent whose backends cannot be listed is not launched", async () => {
    const cwd = path.join(root, "workspace-unlisted");
    await mkdir(cwd);
    const launchesBefore = launches.length;
    backendFails = true;
    try {
      await expect(
        daemon.agentManager.createAgent(
          { provider: "claude", cwd, title: "Unlisted backend agent" },
          undefined,
          { workspaceId: undefined },
        ),
      ).rejects.toThrow(/tool tree.*fixture/s);
    } finally {
      backendFails = false;
    }
    expect(launches.length).toBe(launchesBefore);
  });

  test("a launch overlapped by an ordinary refresh fails when a backend drops out of the tree", async () => {
    const cwd = path.join(root, "workspace-overlap");
    await mkdir(cwd);
    const agentId = randomUUID();
    const launchesBefore = launches.length;
    try {
      const { launched } = await launchOverlappedByOrdinaryRefresh(agentId, () =>
        daemon.agentManager.createAgent(
          { provider: "claude", cwd, title: "Overlapped launch agent" },
          agentId,
          { workspaceId: undefined },
        ),
      );
      await expect(launched).rejects.toThrow(/tool tree.*beta/s);
    } finally {
      betaFails = false;
    }
    expect(launches.length).toBe(launchesBefore);
  });

  test("a reload overlapped by an ordinary refresh fails when a backend drops out of the tree", async () => {
    const cwd = path.join(root, "workspace-overlap-reload");
    await mkdir(cwd);
    const agent = await daemon.agentManager.createAgent(
      { provider: "claude", cwd, title: "Overlapped reload agent" },
      undefined,
      { workspaceId: undefined },
    );
    const tree = path.join(paseoHome, "tool-trees", agent.id);
    const launchesBefore = launches.length;
    try {
      const { launched } = await launchOverlappedByOrdinaryRefresh(agent.id, () =>
        daemon.agentManager.reloadAgentSession(agent.id),
      );
      await expect(launched).rejects.toThrow(/tool tree.*beta/s);
    } finally {
      betaFails = false;
    }
    expect(launches.length).toBe(launchesBefore);
    // The tree the agent already had keeps every backend's tools.
    for (const name of BETA_TOOLS) {
      expect(existsSync(path.join(tree, "servers/beta", `${name}.ts`))).toBe(true);
    }
  });
});
