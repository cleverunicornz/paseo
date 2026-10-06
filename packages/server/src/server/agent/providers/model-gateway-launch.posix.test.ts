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
const INHERITED_KEY = "inherited-model-key-77a1";
const INHERITED_OAUTH = "inherited-oauth-token-0c4d";

const RECORDED_ENV_KEYS = [
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_API_KEY",
  "CLAUDE_CODE_OAUTH_TOKEN",
  "OPENAI_API_KEY",
  "CODEX_API_KEY",
  "PASEO_MODEL_GATEWAY_TOKEN",
];

interface LaunchRecord {
  argv: string[];
  env: Record<string, string>;
}

const roots: string[] = [];
const savedOauth = process.env.CLAUDE_CODE_OAUTH_TOKEN;

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
  if (savedOauth === undefined) {
    delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
  } else {
    process.env.CLAUDE_CODE_OAUTH_TOKEN = savedOauth;
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

function gatewayLaunch(
  agentId: string,
  modelKeyVariable: string,
  token = AGENT_TOKEN,
): AgentLaunchContext {
  return {
    agentId,
    // A plugin session_open hook may hand back a model key; the gateway still wins.
    env: { [modelKeyVariable]: INHERITED_KEY },
    modelGateway: { baseUrl: GATEWAY_URL, token },
  };
}

async function launchClaude(
  root: string,
  launchContext: AgentLaunchContext,
): Promise<LaunchRecord> {
  const { binary, recordPath } = createRecordingClaudeBinary(root);
  process.env.CLAUDE_CODE_OAUTH_TOKEN = INHERITED_OAUTH;
  const client = new ClaudeAgentClient({
    logger: createTestLogger(),
    runtimeSettings: { env: { ANTHROPIC_API_KEY: INHERITED_KEY } },
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
  const client = new CodexAppServerAgentClient(createTestLogger(), {
    command: { mode: "replace", argv: [process.execPath, script] },
    env: { OPENAI_API_KEY: INHERITED_KEY, CODEX_API_KEY: INHERITED_KEY },
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
  test("Claude Code launches against the gateway with exactly its own agent token", async () => {
    const root = createRoot("claude");

    const launch = await launchClaude(root, gatewayLaunch("agent-claude", "ANTHROPIC_API_KEY"));

    expect(launch.env).toEqual({
      ANTHROPIC_BASE_URL: GATEWAY_URL,
      ANTHROPIC_AUTH_TOKEN: AGENT_TOKEN,
    });
    expect(launch.argv.join(" ")).not.toContain(AGENT_TOKEN);
  });

  test("a second Claude agent launches with its own, different token", async () => {
    const first = await launchClaude(
      createRoot("claude-a"),
      gatewayLaunch("agent-a", "ANTHROPIC_API_KEY", "token-a"),
    );
    const second = await launchClaude(
      createRoot("claude-b"),
      gatewayLaunch("agent-b", "ANTHROPIC_API_KEY", "token-b"),
    );

    expect(first.env.ANTHROPIC_AUTH_TOKEN).toBe("token-a");
    expect(second.env.ANTHROPIC_AUTH_TOKEN).toBe("token-b");
  });

  test("Claude Code without a model gateway keeps its inherited credentials", async () => {
    const root = createRoot("claude-plain");

    const launch = await launchClaude(root, { agentId: "agent-plain", env: {} });

    expect(launch.env).toEqual({
      ANTHROPIC_API_KEY: INHERITED_KEY,
      CLAUDE_CODE_OAUTH_TOKEN: INHERITED_OAUTH,
    });
  });

  test("Codex launches a responses provider at the gateway keyed by its own agent token", async () => {
    const root = createRoot("codex");

    const { launch, threadStartConfig } = await launchCodex(
      root,
      gatewayLaunch("agent-codex", "OPENAI_API_KEY"),
    );

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
    const first = await launchCodex(
      createRoot("codex-a"),
      gatewayLaunch("agent-a", "OPENAI_API_KEY", "token-a"),
    );
    const second = await launchCodex(
      createRoot("codex-b"),
      gatewayLaunch("agent-b", "OPENAI_API_KEY", "token-b"),
    );

    expect(first.launch.env.PASEO_MODEL_GATEWAY_TOKEN).toBe("token-a");
    expect(second.launch.env.PASEO_MODEL_GATEWAY_TOKEN).toBe("token-b");
  });

  test("Codex without a model gateway launches as before", async () => {
    const root = createRoot("codex-plain");

    const { launch, threadStartConfig } = await launchCodex(root, {
      agentId: "agent-plain",
      env: {},
    });

    expect(launch.env).toEqual({ OPENAI_API_KEY: INHERITED_KEY, CODEX_API_KEY: INHERITED_KEY });
    expect(threadStartConfig ?? {}).not.toHaveProperty("model_provider");
    expect(threadStartConfig ?? {}).not.toHaveProperty("model_providers");
  });
});
