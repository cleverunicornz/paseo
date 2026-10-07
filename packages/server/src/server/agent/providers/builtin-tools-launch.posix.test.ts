import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import { createTestLogger } from "../../../test-utils/test-logger.js";
import type { ProviderRuntimeSettings } from "@getpaseo/protocol/provider-config";
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

/** A stand-in Codex app server that records its argv and answers every request. */
function createRecordingCodexAppServer(root: string): { script: string; recordPath: string } {
  const recordPath = join(root, "codex.jsonl");
  const script = join(root, "fake-codex-app-server.cjs");
  writeFileSync(
    script,
    `const fs = require("node:fs");
fs.appendFileSync(${JSON.stringify(recordPath)}, JSON.stringify({ argv: process.argv.slice(2) }) + "\\n");
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
    if (message.id !== undefined) {
      process.stdout.write(JSON.stringify({ id: message.id, result: resultFor(message.method) }) + "\\n");
    }
  }
});
`,
  );
  return { script, recordPath };
}

async function launchCodexArgv(
  runtimeSettings: Omit<ProviderRuntimeSettings, "command"> = {},
): Promise<string[]> {
  const root = createRoot("codex");
  const { script, recordPath } = createRecordingCodexAppServer(root);
  const client = new CodexAppServerAgentClient(createTestLogger(), {
    ...runtimeSettings,
    command: { mode: "replace", argv: [process.execPath, script] },
  });
  const session = await client
    .createSession({ provider: "codex", cwd: root, modeId: "auto" })
    .catch(() => null);
  try {
    await session?.startTurn("hello").catch(() => undefined);
  } finally {
    await session?.close().catch(() => undefined);
  }
  expect(existsSync(recordPath)).toBe(true);
  const launches = readFileSync(recordPath, "utf8")
    .trim()
    .split("\n")
    .map((line) => (JSON.parse(line) as { argv: string[] }).argv);
  // Every app server the session started carries the same options.
  expect(launches.length).toBeGreaterThan(0);
  return launches[0]!;
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

  test("Codex keeps its shell tools by default", async () => {
    const argv = await launchCodexArgv();
    expect(argv).toContain("app-server");
    expect(argv).not.toContain("--disable");
  });
});
