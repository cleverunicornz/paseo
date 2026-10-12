import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import { createTestLogger } from "../../../test-utils/test-logger.js";
import type { ProviderRuntimeSettings } from "@getpaseo/protocol/provider-config";
import { z } from "zod";
import type { PaseoToolCatalog, PaseoToolDefinition } from "../tools/types.js";
import { ClaudeAgentClient } from "./claude/agent.js";
import { CodexAppServerAgentClient } from "./codex-app-server-agent.js";

const PASEO_MCP = {
  type: "http" as const,
  url: "http://127.0.0.1:6767/mcp/agents",
  headers: { Authorization: "Bearer agent-token" },
};

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function createRoot(name: string): string {
  const root = mkdtempSync(join(tmpdir(), `paseo-builtin-tools-${name}-`));
  roots.push(root);
  return root;
}

interface ClaudeLaunch {
  argv: string[];
  mcpConfig: { mcpServers?: Record<string, unknown> } | null;
}

/** A stand-in Claude Code executable that records its argv and the `--mcp-config` file. */
function createRecordingClaudeBinary(root: string): { binary: string; recordPath: string } {
  const recordPath = join(root, "launch.json");
  const binary = join(root, "claude");
  writeFileSync(
    binary,
    `#!${process.execPath}
const fs = require("node:fs");
const argv = process.argv.slice(2);
const index = argv.indexOf("--mcp-config");
const value = index >= 0 ? argv[index + 1] : null;
const mcpConfig = value && fs.existsSync(value) ? JSON.parse(fs.readFileSync(value, "utf8")) : null;
fs.writeFileSync(${JSON.stringify(recordPath)}, JSON.stringify({ argv, mcpConfig }));
process.exit(1);
`,
  );
  chmodSync(binary, 0o755);
  return { binary, recordPath };
}

async function launchClaude(runtimeSettings?: ProviderRuntimeSettings): Promise<ClaudeLaunch> {
  const root = createRoot("claude");
  const { binary, recordPath } = createRecordingClaudeBinary(root);
  const client = new ClaudeAgentClient({
    logger: createTestLogger(),
    runtimeSettings,
    resolveBinary: async () => binary,
    resolveVersion: async () => "2.1.0",
  });
  const session = await client.createSession({
    provider: "claude",
    cwd: root,
    mcpServers: { paseo: PASEO_MCP },
  });
  try {
    await session.run("hello").catch(() => undefined);
  } finally {
    await session.close();
  }
  return JSON.parse(readFileSync(recordPath, "utf8")) as ClaudeLaunch;
}

/**
 * A stand-in Codex app server that records its argv, every request and every answer to its own requests, and
 * answers every request. With `toolCall`, it asks the client to run that dynamic tool once a turn starts.
 */
function createRecordingCodexAppServer(
  root: string,
  toolCall?: { namespace: string; tool: string; arguments: unknown },
): { script: string; recordPath: string } {
  const recordPath = join(root, "codex.jsonl");
  const script = join(root, "fake-codex-app-server.cjs");
  writeFileSync(
    script,
    `const fs = require("node:fs");
const record = (entry) => fs.appendFileSync(${JSON.stringify(recordPath)}, JSON.stringify(entry) + "\\n");
const toolCall = ${JSON.stringify(toolCall ?? null)};
record({ argv: process.argv.slice(2) });
let buffer = "";
function resultFor(method) {
  if (method === "thread/start") return { thread: { id: "thread-1" } };
  if (method === "thread/read") return { thread: { turns: [] } };
  if (method === "model/list") return { data: [{ id: "model", isDefault: true }] };
  if (method === "collaborationMode/list" || method === "skills/list" || method === "thread/loaded/list") return { data: [] };
  if (method === "config/read") return { config: {} };
  return {};
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
    if (message.method === undefined) {
      record({ answer: message });
      continue;
    }
    record({ request: { method: message.method, params: message.params } });
    if (message.id !== undefined) {
      process.stdout.write(JSON.stringify({ id: message.id, result: resultFor(message.method) }) + "\\n");
    }
    if (message.method === "turn/start" && toolCall) {
      const params = { threadId: "thread-1", turnId: "turn-1", callId: "call-1", ...toolCall };
      process.stdout.write(JSON.stringify({ id: 9001, method: "item/tool/call", params }) + "\\n");
    }
  }
});
`,
  );
  return { script, recordPath };
}

interface CodexRecord {
  argv?: string[];
  request?: { method: string; params?: Record<string, unknown> };
  answer?: { id?: unknown; result?: unknown; error?: unknown };
}

interface CodexLaunch {
  /** The argv of every app server the session started. */
  launches: string[][];
  requests: Array<{ method: string; params?: Record<string, unknown> }>;
  answers: Array<{ id?: unknown; result?: unknown; error?: unknown }>;
}

function readCodexRecords(recordPath: string): CodexRecord[] {
  return readFileSync(recordPath, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as CodexRecord);
}

async function launchCodex(
  runtimeSettings: Omit<ProviderRuntimeSettings, "command"> = {},
  options: {
    paseoTools?: PaseoToolCatalog;
    toolCall?: { namespace: string; tool: string; arguments: unknown };
  } = {},
): Promise<CodexLaunch> {
  const root = createRoot("codex");
  const { script, recordPath } = createRecordingCodexAppServer(root, options.toolCall);
  const client = new CodexAppServerAgentClient(createTestLogger(), {
    ...runtimeSettings,
    command: { mode: "replace", argv: [process.execPath, script] },
  });
  const session = await client
    .createSession(
      { provider: "codex", cwd: root, modeId: "auto" },
      options.paseoTools ? { paseoTools: options.paseoTools } : undefined,
    )
    .catch(() => null);
  try {
    await session?.startTurn("hello").catch(() => undefined);
    if (options.toolCall) {
      // The answer to the app server's tool call arrives after the turn started.
      const start = Date.now();
      while (!readCodexRecords(recordPath).some((entry) => entry.answer?.id === 9001)) {
        if (Date.now() - start > 10_000) throw new Error("No answer to the dynamic tool call");
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    }
  } finally {
    await session?.close().catch(() => undefined);
  }
  expect(existsSync(recordPath)).toBe(true);
  const records = readCodexRecords(recordPath);
  const launches = records.flatMap((entry) => (entry.argv ? [entry.argv] : []));
  // Every app server the session started carries the same options.
  expect(launches.length).toBeGreaterThan(0);
  return {
    launches,
    requests: records.flatMap((entry) => (entry.request ? [entry.request] : [])),
    answers: records.flatMap((entry) => (entry.answer ? [entry.answer] : [])),
  };
}

async function launchCodexArgv(
  runtimeSettings: Omit<ProviderRuntimeSettings, "command"> = {},
): Promise<string[]> {
  return (await launchCodex(runtimeSettings)).launches[0]!;
}

/** Every value that follows `flag` in `argv`. */
function followingValues(argv: string[], flag: string): string[] {
  return argv.flatMap((arg, index) =>
    arg === flag && index + 1 < argv.length ? [argv[index + 1]!] : [],
  );
}

/** Two Paseo tools as a catalogue, recording each call. */
function createDirectCatalog(calls: Array<{ name: string; input: unknown }>): PaseoToolCatalog {
  const tools = new Map<string, PaseoToolDefinition>();
  const define = (name: string, description: string, inputSchema: z.ZodRawShape): void => {
    tools.set(name, {
      name,
      description,
      inputSchema,
      handler: async () => ({ content: [{ type: "text", text: `${name} ran` }] }),
    });
  };
  define("exec", "Run a command.", { command: z.array(z.string()) });
  define("read_file", "Read a file.", { path: z.string() });
  return {
    tools,
    getTool: (name) => tools.get(name),
    executeTool: async (name, input, context) => {
      calls.push({ name, input });
      const tool = tools.get(name);
      if (!tool) throw new Error(`Unknown tool ${name}`);
      return tool.handler(input, context ?? {});
    },
  };
}

function followingValue(argv: string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] : undefined;
}

describe("harness built-in tools", () => {
  test("Claude Code with built-ins off has no built-in tool and only Paseo's MCP servers", async () => {
    const launch = await launchClaude({ builtinTools: "off" });
    expect(followingValue(launch.argv, "--tools")).toBe("");
    expect(launch.argv).toContain("--strict-mcp-config");
    expect(launch.mcpConfig?.mcpServers).toEqual({ paseo: PASEO_MCP });
  });

  test("Claude Code keeps its built-ins by default", async () => {
    const launch = await launchClaude();
    expect(launch.argv).not.toContain("--tools");
    expect(launch.argv).not.toContain("--strict-mcp-config");
    expect(launch.mcpConfig?.mcpServers).toEqual({ paseo: PASEO_MCP });
  });

  test("Codex with built-ins off starts its app server with the shell tools disabled", async () => {
    const argv = await launchCodexArgv({ builtinTools: "off" });
    expect(argv).toEqual(
      expect.arrayContaining([
        "app-server",
        "--disable",
        "shell_tool",
        "--disable",
        "unified_exec",
      ]),
    );
    expect(argv.join(" ")).toContain("--disable shell_tool");
    expect(argv.join(" ")).toContain("--disable unified_exec");
  });

  test("Codex with built-ins off offers none of its own tools but apply_patch", async () => {
    const { launches } = await launchCodex({ builtinTools: "off" });
    for (const argv of launches) {
      // Codex turns goals, view_image and sleep on by default: they are switched off, never on.
      expect(argv).not.toContain("--enable");
      expect(followingValues(argv, "--disable")).toEqual(
        expect.arrayContaining(["shell_tool", "unified_exec", "goals", "view_image", "sleep_tool"]),
      );
      expect(followingValues(argv, "-c")).toContain(
        "tools.experimental_request_user_input.enabled=false",
      );
    }
  });

  test("Codex given Paseo's tools offers them as its own tools in the paseo namespace, with no MCP server", async () => {
    const calls: Array<{ name: string; input: unknown }> = [];
    const { requests, answers } = await launchCodex(
      { builtinTools: "off" },
      {
        paseoTools: createDirectCatalog(calls),
        toolCall: { namespace: "paseo", tool: "read_file", arguments: { path: "package.json" } },
      },
    );
    const threadStart = requests.find((request) => request.method === "thread/start");
    expect(threadStart?.params?.dynamicTools).toEqual([
      {
        type: "namespace",
        name: "paseo",
        description: expect.any(String),
        tools: [
          {
            type: "function",
            name: "exec",
            description: "Run a command.",
            inputSchema: expect.objectContaining({ type: "object", required: ["command"] }),
          },
          {
            type: "function",
            name: "read_file",
            description: "Read a file.",
            inputSchema: expect.objectContaining({ type: "object", required: ["path"] }),
          },
        ],
      },
    ]);
    const config = (threadStart?.params?.config ?? {}) as Record<string, unknown>;
    expect(config.mcp_servers).toBeUndefined();

    // The app server's call runs the catalogue's tool and gets its result back.
    expect(calls).toEqual([{ name: "read_file", input: { path: "package.json" } }]);
    expect(answers.find((answer) => answer.id === 9001)?.result).toEqual({
      contentItems: [{ type: "inputText", text: "read_file ran" }],
      success: true,
    });
  });

  test("Codex answers a call to a tool outside its paseo namespace as failed, running nothing", async () => {
    const calls: Array<{ name: string; input: unknown }> = [];
    const { answers } = await launchCodex(
      { builtinTools: "off" },
      {
        paseoTools: createDirectCatalog(calls),
        toolCall: { namespace: "memory", tool: "memory_status", arguments: {} },
      },
    );
    expect(calls).toEqual([]);
    expect(answers.find((answer) => answer.id === 9001)?.result).toEqual({
      contentItems: [{ type: "inputText", text: expect.stringMatching(/memory\.memory_status/) }],
      success: false,
    });
  });

  test("Codex keeps its shell tools by default", async () => {
    const argv = await launchCodexArgv();
    expect(argv).toContain("app-server");
    expect(argv).not.toContain("--disable");
  });
});
