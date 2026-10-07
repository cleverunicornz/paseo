import { execFileSync } from "node:child_process";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { existsSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import pino from "pino";

import { createPaseoDaemon, type PaseoDaemonConfig } from "../bootstrap.js";
import { createTestAgentClients } from "../test-utils/fake-agent-client.js";
import { resolveTestCodexBinary } from "../test-utils/codex-binary.js";

const codexPath = resolveTestCodexBinary();

const LOCAL_TOOL_NAMES = [
  "exec",
  "read_file",
  "write_file",
  "list_dir",
  "apply_patch",
  "process_spawn",
  "process_write",
  "process_read",
  "process_kill",
  "process_list",
  "search",
  "find_files",
  "git_status",
  "git_diff",
  "git_log",
  "git_commit",
  "git_push",
];

interface ToolCallResult {
  structuredContent?: Record<string, unknown>;
  content?: Array<{ type: string; text?: string }>;
  isError?: boolean;
}

interface Caller {
  agentId: string;
  cwd: string;
  token: string;
  client: Client;
  call: (name: string, args?: Record<string, unknown>) => Promise<ToolCallResult>;
  ok: (name: string, args?: Record<string, unknown>) => Promise<Record<string, unknown>>;
  error: (name: string, args?: Record<string, unknown>) => Promise<string>;
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

async function connect(url: string, token?: string): Promise<Client> {
  const client = new Client({ name: "local-tools-test", version: "1.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(
      new URL(url),
      token ? { requestInit: { headers: { Authorization: `Bearer ${token}` } } } : undefined,
    ),
  );
  return client;
}

function bind(client: Client, agentId: string, cwd: string, token: string): Caller {
  const call = async (name: string, args: Record<string, unknown> = {}) =>
    (await client.callTool({ name, arguments: args })) as ToolCallResult;
  return {
    agentId,
    cwd,
    token,
    client,
    call,
    ok: async (name, args) => {
      const result = await call(name, args);
      if (result.isError) {
        throw new Error(`${name} failed: ${result.content?.map((c) => c.text).join("\n")}`);
      }
      return result.structuredContent ?? {};
    },
    error: async (name, args) => {
      const result = await call(name, args);
      if (!result.isError) {
        throw new Error(`${name} unexpectedly succeeded: ${JSON.stringify(result)}`);
      }
      return result.content?.map((c) => c.text ?? "").join("\n") ?? "";
    },
  };
}

async function listFilesRecursive(dir: string): Promise<string[]> {
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(entry.parentPath, entry.name));
}

async function waitForOutput(
  caller: Caller,
  processId: string,
  predicate: (seen: { stdout: string; exited: boolean }) => boolean,
): Promise<{ stdout: string; stderr: string; exited: boolean; exitCode: unknown }> {
  let stdout = "";
  let stderr = "";
  const start = Date.now();
  while (Date.now() - start < 10_000) {
    const read = await caller.ok("process_read", { processId, waitMs: 500 });
    stdout += String(read.stdout ?? "");
    stderr += String(read.stderr ?? "");
    const exited = read.exited === true;
    if (predicate({ stdout, exited })) {
      return { stdout, stderr, exited, exitCode: read.exitCode };
    }
  }
  throw new Error(`Timed out waiting for process output; saw: ${stdout}`);
}

describe.skipIf(!codexPath)("local tools through /mcp/agents (real Codex app server)", () => {
  let root: string;
  let paseoHome: string;
  let mcpUrl: string;
  let daemon: Awaited<ReturnType<typeof createPaseoDaemon>>;
  let a: Caller;
  let b: Caller;
  let anonymous: Client;
  let outsideDir: string;

  beforeAll(async () => {
    root = await realpath(await mkdtemp(path.join(os.tmpdir(), "paseo-local-tools-")));
    paseoHome = path.join(root, "home");
    outsideDir = path.join(root, "outside");
    await mkdir(paseoHome);
    await mkdir(outsideDir);
    await writeFile(path.join(outsideDir, "secret.txt"), "outside\n");
    const staticDir = path.join(root, "static");
    await mkdir(staticDir);
    const port = await getAvailablePort();
    const config: PaseoDaemonConfig = {
      listen: `127.0.0.1:${port}`,
      paseoHome,
      corsAllowedOrigins: [],
      hostnames: true,
      mcpEnabled: true,
      staticDir,
      mcpDebug: false,
      agentClients: createTestAgentClients(),
      agentStoragePath: path.join(paseoHome, "agents"),
      localTools: { codexPath: codexPath! },
    };
    daemon = await createPaseoDaemon(config, pino({ level: "silent" }));
    await daemon.start();
    mcpUrl = `http://127.0.0.1:${port}/mcp/agents`;

    const callers: Caller[] = [];
    for (const name of ["a", "b"]) {
      const cwd = path.join(root, `workspace-${name}`);
      await mkdir(cwd);
      await writeFile(path.join(cwd, "marker.txt"), `workspace ${name}\n`);
      const agent = await daemon.agentManager.createAgent(
        { provider: "claude", cwd, title: `Local tools ${name}` },
        undefined,
        { workspaceId: undefined },
      );
      const token = daemon.agentManager.issueAgentToken(agent.id);
      callers.push(bind(await connect(mcpUrl, token), agent.id, cwd, token));
    }
    [a, b] = callers as [Caller, Caller];
    anonymous = await connect(mcpUrl);
  }, 60_000);

  afterAll(async () => {
    await a?.client.close();
    await b?.client.close();
    await anonymous?.close();
    await daemon?.stop();
    await rm(root, { recursive: true, force: true });
  });

  test("every local tool is listed for an agent", async () => {
    const { tools } = await a.client.listTools();
    const names = tools.map((tool) => tool.name);
    for (const name of LOCAL_TOOL_NAMES) {
      expect(names).toContain(name);
    }
  });

  test("local tools need an agent-scoped caller", async () => {
    const result = (await anonymous.callTool({
      name: "exec",
      arguments: { command: ["true"] },
    })) as ToolCallResult;
    expect(result.isError).toBe(true);
    expect(result.content?.[0]?.text).toMatch(/agent/i);
  });

  test("exec runs a command in the caller's workspace and returns its output", async () => {
    expect(
      await a.ok("exec", { command: ["sh", "-c", "pwd; echo warn >&2; exit 3"] }),
    ).toMatchObject({
      exitCode: 3,
      stdout: `${a.cwd}\n`,
      stderr: "warn\n",
      stdoutTruncated: false,
      stderrTruncated: false,
    });
    expect(await b.ok("exec", { command: ["pwd"] })).toMatchObject({ stdout: `${b.cwd}\n` });
    expect(await a.ok("exec", { command: ["pwd"], cwd: "." })).toMatchObject({
      stdout: `${a.cwd}\n`,
    });
  });

  test("exec refuses a working directory outside the workspace", async () => {
    expect(await a.error("exec", { command: ["pwd"], cwd: ".." })).toMatch(/outside/);
    expect(await a.error("exec", { command: ["pwd"], cwd: b.cwd })).toMatch(/outside/);
  });

  test("exec bounds its output", async () => {
    const result = await a.ok("exec", {
      command: ["sh", "-c", "yes | head -c 200000"],
      maxOutputBytes: 1000,
    });
    expect(String(result.stdout).length).toBe(1000);
    expect(result.stdoutTruncated).toBe(true);
  });

  test("write_file, read_file and list_dir work inside the workspace", async () => {
    expect(
      await a.ok("write_file", { path: "notes/today.txt", content: "alpha\nbeta\ngamma\n" }),
    ).toMatchObject({ path: "notes/today.txt", bytes: 17 });
    expect(await readFile(path.join(a.cwd, "notes/today.txt"), "utf8")).toBe(
      "alpha\nbeta\ngamma\n",
    );

    expect(await a.ok("read_file", { path: "notes/today.txt" })).toMatchObject({
      path: "notes/today.txt",
      content: "alpha\nbeta\ngamma\n",
      truncated: false,
    });
    expect(
      await a.ok("read_file", { path: "notes/today.txt", startLine: 2, maxLines: 1 }),
    ).toMatchObject({ content: "beta\n", truncated: true });

    expect(await a.ok("list_dir", { path: "notes" })).toMatchObject({
      path: "notes",
      entries: [{ name: "today.txt", kind: "file" }],
      truncated: false,
    });
    const rootListing = await a.ok("list_dir", {});
    expect(rootListing.entries).toEqual(
      expect.arrayContaining([
        { name: "notes", kind: "directory" },
        { name: "marker.txt", kind: "file" },
      ]),
    );
  });

  test("file tools refuse paths that leave the workspace", async () => {
    await symlink(outsideDir, path.join(a.cwd, "escape-link"));

    expect(await a.error("read_file", { path: "../outside/secret.txt" })).toMatch(/outside/);
    expect(await a.error("read_file", { path: path.join(outsideDir, "secret.txt") })).toMatch(
      /outside/,
    );
    expect(await a.error("read_file", { path: "escape-link/secret.txt" })).toMatch(/outside/);
    expect(await a.error("write_file", { path: "escape-link/new.txt", content: "x" })).toMatch(
      /outside/,
    );
    expect(
      await a.error("write_file", { path: "escape-link/deeper/new.txt", content: "x" }),
    ).toMatch(/outside/);
    expect(await a.error("list_dir", { path: "escape-link" })).toMatch(/outside/);
    expect(await a.error("read_file", { path: path.join(b.cwd, "marker.txt") })).toMatch(/outside/);

    expect(existsSync(path.join(outsideDir, "new.txt"))).toBe(false);
    expect(existsSync(path.join(outsideDir, "deeper"))).toBe(false);
  });

  test("apply_patch edits files and refuses patches that leave the workspace", async () => {
    await writeFile(path.join(a.cwd, "patch-me.txt"), "one\ntwo\nthree\n");
    const patch = [
      "*** Begin Patch",
      "*** Update File: patch-me.txt",
      "@@",
      " one",
      "-two",
      "+TWO",
      " three",
      "*** Add File: added/new.txt",
      "+fresh",
      "*** End Patch",
      "",
    ].join("\n");
    expect(await a.ok("apply_patch", { patch })).toMatchObject({ exitCode: 0 });
    expect(await readFile(path.join(a.cwd, "patch-me.txt"), "utf8")).toBe("one\nTWO\nthree\n");
    expect(await readFile(path.join(a.cwd, "added/new.txt"), "utf8")).toBe("fresh\n");

    for (const target of ["../escape.txt", path.join(outsideDir, "abs.txt"), "escape-link/p.txt"]) {
      const escaping = [
        "*** Begin Patch",
        `*** Add File: ${target}`,
        "+x",
        "*** End Patch",
        "",
      ].join("\n");
      expect(await a.error("apply_patch", { patch: escaping })).toMatch(/outside/);
    }
    const moving = [
      "*** Begin Patch",
      "*** Update File: patch-me.txt",
      "*** Move to: ../moved.txt",
      "@@",
      " one",
      "*** End Patch",
      "",
    ].join("\n");
    expect(await a.error("apply_patch", { patch: moving })).toMatch(/outside/);
    expect(existsSync(path.join(root, "escape.txt"))).toBe(false);
    expect(existsSync(path.join(root, "moved.txt"))).toBe(false);
    expect(await readdir(outsideDir)).toEqual(["secret.txt"]);
  });

  test("process tools run, feed, read and kill a long-running process of the caller only", async () => {
    const spawned = await a.ok("process_spawn", {
      command: ["sh", "-c", 'while read line; do echo "got:$line"; done; echo bye'],
    });
    const processId = String(spawned.processId);

    await a.ok("process_write", { processId, input: "one\n" });
    const first = await waitForOutput(a, processId, ({ stdout }) => stdout.includes("got:one"));
    expect(first.exited).toBe(false);

    expect((await a.ok("process_list")).processes).toEqual([
      expect.objectContaining({ processId, running: true }),
    ]);
    expect((await b.ok("process_list")).processes).toEqual([]);
    expect(await b.error("process_read", { processId })).toMatch(/not found/i);
    expect(await b.error("process_write", { processId, input: "x\n" })).toMatch(/not found/i);
    expect(await b.error("process_kill", { processId })).toMatch(/not found/i);

    await a.ok("process_write", { processId, closeStdin: true });
    const done = await waitForOutput(a, processId, ({ exited }) => exited);
    expect(done.stdout).toContain("bye");
    expect(done.exitCode).toBe(0);

    const sleeper = String((await a.ok("process_spawn", { command: ["sleep", "60"] })).processId);
    await a.ok("process_kill", { processId: sleeper });
    const killed = await waitForOutput(a, sleeper, ({ exited }) => exited);
    expect(killed.exited).toBe(true);
  });

  test("search finds content and files in the workspace", async () => {
    await mkdir(path.join(a.cwd, "src"), { recursive: true });
    await writeFile(
      path.join(a.cwd, "src/needle.ts"),
      "export const marker = 'unique_marker_42';\n",
    );
    await writeFile(path.join(b.cwd, "other.ts"), "unique_marker_42\n");

    const content = await a.ok("search", { pattern: "unique_marker_42" });
    expect(content.output).toContain("src/needle.ts:1:");
    expect(content.output).not.toContain("other.ts");

    const files = await a.ok("find_files", { query: "needle" });
    expect(files.files).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: "src/needle.ts" })]),
    );

    expect(await a.error("search", { pattern: "x", path: "../" })).toMatch(/outside/);
  });

  test("git tools report status, diff and log, commit and push", async () => {
    const remote = path.join(root, "remote.git");
    execFileSync("git", ["init", "--bare", "-q", "-b", "main", remote]);
    const git = (...args: string[]) => a.ok("exec", { command: ["git", ...args] });
    await git("init", "-q", "-b", "main");
    await git("config", "user.email", "agent@example.invalid");
    await git("config", "user.name", "Agent");
    await git("remote", "add", "origin", remote);

    expect(String((await a.ok("git_status")).output)).toContain("?? marker.txt");

    const commit = await a.ok("git_commit", { message: "first commit", paths: ["marker.txt"] });
    expect(commit.exitCode).toBe(0);
    expect(String((await a.ok("git_log", { maxCount: 5 })).output)).toContain("first commit");

    await writeFile(path.join(a.cwd, "marker.txt"), "workspace a changed\n");
    expect(String((await a.ok("git_diff", {})).output)).toContain("+workspace a changed");
    expect(
      await a.error("git_commit", { message: "nope", paths: ["../outside/secret.txt"] }),
    ).toMatch(/outside/);

    const push = await a.ok("git_push", { remote: "origin", branch: "main", setUpstream: true });
    expect(push.exitCode).toBe(0);
    expect(
      execFileSync("git", ["--git-dir", remote, "log", "--format=%s", "main"], {
        encoding: "utf8",
      }),
    ).toContain("first commit");
  });

  test("an exec run gets the calling agent's token and MCP URL, and calls Paseo as that agent", async () => {
    const printEnv = ["sh", "-c", 'printf "%s\\n%s" "$PASEO_AGENT_TOKEN" "$PASEO_MCP_URL"'];
    expect(String((await a.ok("exec", { command: printEnv })).stdout)).toBe(
      `${a.token}\n${mcpUrl}`,
    );
    expect(String((await b.ok("exec", { command: printEnv })).stdout)).toBe(
      `${b.token}\n${mcpUrl}`,
    );
    expect(a.token).not.toBe(b.token);

    // A script the agent writes reaches Paseo with the run's own credentials;
    // read_file answers from the caller's workspace, so the marker names the caller.
    const script = `
      const post = async (body, session) => {
        const res = await fetch(process.env.PASEO_MCP_URL, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "application/json, text/event-stream",
            authorization: "Bearer " + process.env.PASEO_AGENT_TOKEN,
            ...(session ? { "mcp-session-id": session } : {}),
          },
          body: JSON.stringify(body),
        });
        const text = await res.text();
        const data = text.split("\\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5)).join("");
        return { session: res.headers.get("mcp-session-id"), message: JSON.parse(data || text) };
      };
      const init = await post({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "script", version: "1" } } });
      const call = await post({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "read_file", arguments: { path: "marker.txt" } } }, init.session);
      process.stdout.write(call.message.result.structuredContent.content);
    `;
    await a.ok("write_file", { path: "call-paseo.mjs", content: script });
    await b.ok("write_file", { path: "call-paseo.mjs", content: script });
    expect((await a.ok("exec", { command: ["node", "call-paseo.mjs"] })).stdout).toBe(
      "workspace a\n",
    );
    expect((await b.ok("exec", { command: ["node", "call-paseo.mjs"] })).stdout).toBe(
      "workspace b\n",
    );

    // Neither token reaches a file: not in the daemon's home (executor home included)
    // nor in either workspace.
    const files = [
      ...(await listFilesRecursive(paseoHome)),
      ...(await listFilesRecursive(a.cwd)),
      ...(await listFilesRecursive(b.cwd)),
    ];
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const bytes = await readFile(file);
      expect(bytes.includes(a.token), file).toBe(false);
      expect(bytes.includes(b.token), file).toBe(false);
    }
  });
});

describe("local tools when no executor is configured", () => {
  test("lists none of them and starts nothing", async () => {
    const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "paseo-no-local-tools-")));
    const paseoHome = path.join(root, "home");
    const staticDir = path.join(root, "static");
    await mkdir(paseoHome);
    await mkdir(staticDir);
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
    );
    await daemon.start();
    let client: Client | null = null;
    try {
      const agent = await daemon.agentManager.createAgent(
        { provider: "claude", cwd: root, title: "No local tools" },
        undefined,
        { workspaceId: undefined },
      );
      client = await connect(
        `http://127.0.0.1:${port}/mcp/agents`,
        daemon.agentManager.issueAgentToken(agent.id),
      );
      const names = (await client.listTools()).tools.map((tool) => tool.name);
      for (const name of LOCAL_TOOL_NAMES) {
        expect(names).not.toContain(name);
      }
      expect(existsSync(path.join(paseoHome, "local-tools"))).toBe(false);
    } finally {
      await client?.close();
      await daemon.stop();
      await rm(root, { recursive: true, force: true });
    }
  });
});
