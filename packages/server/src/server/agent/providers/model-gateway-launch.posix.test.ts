import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import { createTestLogger } from "../../../test-utils/test-logger.js";
import type { AgentLaunchContext } from "../agent-sdk-types.js";
import { ClaudeAgentClient } from "./claude/agent.js";
import { CodexAppServerAgentClient } from "./codex-app-server-agent.js";

const GATEWAY_URL = "http://127.0.0.1:6767/mcp/backends/models";
const AGENT_TOKEN = "per-agent-token-3b9e";
/**
 * Model-provider credential and endpoint variables a harness could inherit.
 * Stated here independently of the implementation's list.
 */
const MODEL_PROVIDER_VARIABLES = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_BASE_URL",
  "CLAUDE_CODE_OAUTH_TOKEN",
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "CODEX_API_KEY",
] as const;

/** One inherited value per variable and source, so any survivor is identifiable. */
function inherited(source: "process" | "settings" | "launch"): Record<string, string> {
  return Object.fromEntries(
    MODEL_PROVIDER_VARIABLES.map((name) => [name, `inherited-${source}-${name.toLowerCase()}`]),
  );
}

const RECORDED_ENV_KEYS = [...MODEL_PROVIDER_VARIABLES, "PASEO_MODEL_GATEWAY_TOKEN"];

interface LaunchRecord {
  argv: string[];
  env: Record<string, string>;
}

const roots: string[] = [];
const savedProcessEnv = Object.fromEntries(
  MODEL_PROVIDER_VARIABLES.map((name) => [name, process.env[name]]),
);

/** The daemon's own environment carries every variable, as a host with model credentials would. */
function inheritFromDaemonProcess(): void {
  Object.assign(process.env, inherited("process"));
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
  for (const [name, value] of Object.entries(savedProcessEnv)) {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
});

function createRoot(name: string): string {
  const root = mkdtempSync(join(tmpdir(), `paseo-model-gateway-${name}-`));
  roots.push(root);
  return root;
}

const RECORD_LAUNCH = (recordPath: string) => `
const fs = require("node:fs");
const env = {};
for (const key of ${JSON.stringify(RECORDED_ENV_KEYS)}) {
  if (process.env[key] !== undefined) env[key] = process.env[key];
}
fs.appendFileSync(${JSON.stringify(recordPath)}, JSON.stringify({ kind: "launch", argv: process.argv.slice(2), env }) + "\\n");
`;

/** A stand-in Claude Code executable that records its argv and model environment, then exits. */
function createRecordingClaudeBinary(root: string): { binary: string; recordPath: string } {
  const recordPath = join(root, "launches.jsonl");
  const recorder = join(root, "record.cjs");
  writeFileSync(recorder, `${RECORD_LAUNCH(recordPath)}\nprocess.exit(1);\n`);
  const binary = join(root, "claude");
  writeFileSync(binary, `#!/bin/sh\nexec "${process.execPath}" "${recorder}" "$@"\n`);
  chmodSync(binary, 0o755);
  return { binary, recordPath };
}

/** A stand-in Codex app-server that records its launch and every JSON-RPC request. */
function createRecordingCodexAppServer(root: string): { script: string; recordPath: string } {
  const recordPath = join(root, "codex.jsonl");
  const script = join(root, "fake-codex-app-server.cjs");
  writeFileSync(
    script,
    `${RECORD_LAUNCH(recordPath)}
let buffer = "";
function resultFor(method) {
  if (method === "thread/start") return { thread: { id: "thread-1" } };
  if (method === "config/read" || method === "getUserSavedConfig") return { config: {} };
  if (method === "model/list") return { data: [{ id: "gateway-model", isDefault: true }] };
  if (method === "collaborationMode/list" || method === "skills/list") return { data: [] };
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
    fs.appendFileSync(${JSON.stringify(recordPath)}, JSON.stringify({ kind: "request", method: message.method, params: message.params }) + "\\n");
    if (message.id !== undefined) {
      process.stdout.write(JSON.stringify({ id: message.id, result: resultFor(message.method) }) + "\\n");
    }
  }
});
`,
  );
  return { script, recordPath };
}

function readRecords(recordPath: string): Array<Record<string, unknown>> {
  if (!existsSync(recordPath)) return [];
  return readFileSync(recordPath, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

function launches(recordPath: string): LaunchRecord[] {
  return readRecords(recordPath).filter(
    (record) => record.kind === "launch",
  ) as unknown as LaunchRecord[];
}

function gatewayLaunch(agentId: string, token = AGENT_TOKEN): AgentLaunchContext {
  return {
    agentId,
    // Launch values (e.g. from an agent.session_open hook) carry every variable too.
    env: inherited("launch"),
    modelGateway: { baseUrl: GATEWAY_URL, token },
  };
}

function plainLaunch(agentId: string): AgentLaunchContext {
  return { agentId, env: inherited("launch") };
}

async function launchClaude(
  root: string,
  launchContext: AgentLaunchContext,
): Promise<LaunchRecord> {
  const { binary, recordPath } = createRecordingClaudeBinary(root);
  inheritFromDaemonProcess();
  const client = new ClaudeAgentClient({
    logger: createTestLogger(),
    runtimeSettings: { env: inherited("settings") },
    resolveBinary: async () => binary,
    resolveVersion: async () => "2.1.0",
  });
  const session = await client.createSession({ provider: "claude", cwd: root }, launchContext);
  try {
    await session.run("hello").catch(() => undefined);
  } finally {
    await session.close();
  }
  const [launch] = launches(recordPath);
  expect(launch).toBeDefined();
  return launch!;
}

async function launchCodex(
  root: string,
  launchContext: AgentLaunchContext,
): Promise<{ launch: LaunchRecord; threadStartConfig: unknown }> {
  const { script, recordPath } = createRecordingCodexAppServer(root);
  inheritFromDaemonProcess();
  const client = new CodexAppServerAgentClient(createTestLogger(), {
    command: { mode: "replace", argv: [process.execPath, script] },
    env: inherited("settings"),
  });
  const session = await client.createSession(
    { provider: "codex", cwd: root, modeId: "auto", model: "gateway-model" },
    launchContext,
  );
  try {
    await session.startTurn("hello");
  } finally {
    await session.close();
  }
  const threadStart = readRecords(recordPath).find(
    (record) => record.kind === "request" && record.method === "thread/start",
  );
  const [launch] = launches(recordPath);
  expect(launch).toBeDefined();
  return {
    launch: launch!,
    threadStartConfig: (threadStart?.params as { config?: unknown } | undefined)?.config,
  };
}

describe("model traffic through the daemon's gateway", () => {
  test("Claude Code inherits no model-provider variable; only its own gateway values remain", async () => {
    const root = createRoot("claude");

    const launch = await launchClaude(root, gatewayLaunch("agent-claude"));

    expect(launch.env).toEqual({
      ANTHROPIC_BASE_URL: GATEWAY_URL,
      ANTHROPIC_AUTH_TOKEN: AGENT_TOKEN,
    });
    expect(launch.argv.join(" ")).not.toContain(AGENT_TOKEN);
  });

  test("a second Claude agent launches with its own, different token", async () => {
    const first = await launchClaude(createRoot("claude-a"), gatewayLaunch("agent-a", "token-a"));
    const second = await launchClaude(createRoot("claude-b"), gatewayLaunch("agent-b", "token-b"));

    expect(first.env.ANTHROPIC_AUTH_TOKEN).toBe("token-a");
    expect(second.env.ANTHROPIC_AUTH_TOKEN).toBe("token-b");
  });

  test("Claude Code without a model gateway keeps its inherited variables", async () => {
    const root = createRoot("claude-plain");

    const launch = await launchClaude(root, plainLaunch("agent-plain"));

    expect(launch.env).toEqual(inherited("launch"));
  });

  test("Codex inherits no model-provider variable; only its own gateway token remains", async () => {
    const root = createRoot("codex");

    const { launch, threadStartConfig } = await launchCodex(root, gatewayLaunch("agent-codex"));

    expect(launch.env).toEqual({ PASEO_MODEL_GATEWAY_TOKEN: AGENT_TOKEN });
    expect(launch.argv.join(" ")).not.toContain(AGENT_TOKEN);
    expect(threadStartConfig).toEqual({
      model_provider: "codex",
      model_providers: {
        codex: {
          name: "Paseo model gateway",
          base_url: GATEWAY_URL,
          wire_api: "responses",
          env_key: "PASEO_MODEL_GATEWAY_TOKEN",
          requires_openai_auth: false,
        },
      },
    });
    expect(JSON.stringify(threadStartConfig)).not.toContain(AGENT_TOKEN);
  });

  test("a second Codex agent launches with its own, different token", async () => {
    const first = await launchCodex(createRoot("codex-a"), gatewayLaunch("agent-a", "token-a"));
    const second = await launchCodex(createRoot("codex-b"), gatewayLaunch("agent-b", "token-b"));

    expect(first.launch.env.PASEO_MODEL_GATEWAY_TOKEN).toBe("token-a");
    expect(second.launch.env.PASEO_MODEL_GATEWAY_TOKEN).toBe("token-b");
  });

  test("Codex without a model gateway launches as before", async () => {
    const root = createRoot("codex-plain");

    const { launch, threadStartConfig } = await launchCodex(root, plainLaunch("agent-plain"));

    expect(launch.env).toEqual(inherited("launch"));
    expect(threadStartConfig ?? {}).not.toHaveProperty("model_provider");
    expect(threadStartConfig ?? {}).not.toHaveProperty("model_providers");
  });
});
