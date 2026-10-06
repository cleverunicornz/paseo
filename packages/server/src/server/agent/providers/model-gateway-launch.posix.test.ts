import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import { createTestLogger } from "../../../test-utils/test-logger.js";
import {
  CREDENTIAL_AND_REDIRECTION_INPUTS,
  LOOPBACK_NO_PROXY,
  PASSTHROUGH,
  credentialInputs,
  expectedGatewayEnv,
  inheritOnDaemonProcess,
  paseoLaunchValues,
  settingsInputs,
} from "../../test-utils/model-gateway-env-inputs.js";
import type { AgentClient, AgentLaunchContext, AgentSession } from "../agent-sdk-types.js";
import { ClaudeAgentClient } from "./claude/agent.js";
import { CodexAppServerAgentClient } from "./codex-app-server-agent.js";

const GATEWAY_URL = "http://127.0.0.1:6767/mcp/backends/models";
const AGENT_TOKEN = "per-agent-token-3b9e";

/**
 * Variables the Claude Agent SDK sets on its own child to select its protocol
 * features; they derive from the SDK options, never from an inherited value.
 */
const CLAUDE_SDK_CHILD_VARIABLES = new Set(["CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING"]);

interface LaunchRecord {
  argv: string[];
  env: Record<string, string>;
}

type LaunchPath = "create" | "resume" | "import";
const LAUNCH_PATHS: LaunchPath[] = ["create", "resume", "import"];

const roots: string[] = [];
const restores: Array<() => void> = [];

afterEach(() => {
  for (const restore of restores.splice(0)) restore();
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function createRoot(name: string): string {
  const root = mkdtempSync(join(tmpdir(), `paseo-model-gateway-${name}-`));
  roots.push(root);
  return root;
}

const RECORD_LAUNCH = (recordPath: string) => `
const fs = require("node:fs");
fs.appendFileSync(${JSON.stringify(recordPath)}, JSON.stringify({ kind: "launch", argv: process.argv.slice(2), env: process.env }) + "\\n");
`;

/**
 * A stand-in Claude Code executable, run directly (no shell between it and
 * the launch), that records its argv and complete environment, then exits.
 */
function createRecordingClaudeBinary(root: string): { binary: string; recordPath: string } {
  const recordPath = join(root, "launches.jsonl");
  const binary = join(root, "claude");
  writeFileSync(binary, `#!${process.execPath}\n${RECORD_LAUNCH(recordPath)}\nprocess.exit(1);\n`);
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
  if (method === "thread/resume") return { thread: { id: "thread-1" } };
  if (method === "thread/read") return { thread: { turns: [] } };
  if (method === "thread/loaded/list") return { data: [] };
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

function firstLaunch(recordPath: string): LaunchRecord {
  const launch = readRecords(recordPath).find((record) => record.kind === "launch");
  expect(launch).toBeDefined();
  return launch as unknown as LaunchRecord;
}

function gatewayLaunch(agentId: string, cwd: string, token = AGENT_TOKEN): AgentLaunchContext {
  return {
    agentId,
    // Launch values carry Paseo's own values and, as a plugin hook could, every input too.
    env: { ...credentialInputs("launch"), ...paseoLaunchValues(agentId, cwd) },
    modelGateway: { baseUrl: GATEWAY_URL, token, envPassthrough: PASSTHROUGH },
  };
}

function plainLaunch(agentId: string, cwd: string): AgentLaunchContext {
  return { agentId, env: { ...credentialInputs("launch"), ...paseoLaunchValues(agentId, cwd) } };
}

async function openSession(
  client: AgentClient,
  provider: "claude" | "codex",
  path: LaunchPath,
  cwd: string,
  launchContext: AgentLaunchContext,
): Promise<AgentSession> {
  const config = { provider, cwd, ...(provider === "codex" ? { modeId: "auto" } : {}) };
  if (path === "create") {
    return client.createSession(config, launchContext);
  }
  if (path === "resume") {
    return client.resumeSession(
      { provider, sessionId: "native-session-1", metadata: { provider, cwd } },
      { cwd },
      launchContext,
    );
  }
  const imported = await client.importSession!(
    { providerHandleId: "native-session-1", cwd },
    { config, storedConfig: config, launchContext },
  );
  return imported.session;
}

async function launchClaude(
  path: LaunchPath,
  root: string,
  launchContext: AgentLaunchContext,
): Promise<LaunchRecord> {
  const { binary, recordPath } = createRecordingClaudeBinary(root);
  restores.push(inheritOnDaemonProcess());
  const client = new ClaudeAgentClient({
    logger: createTestLogger(),
    runtimeSettings: { env: settingsInputs() },
    resolveBinary: async () => binary,
    resolveVersion: async () => "2.1.0",
  });
  const session = await openSession(client, "claude", path, root, launchContext);
  try {
    await session.run("hello").catch(() => undefined);
  } finally {
    await session.close();
  }
  return firstLaunch(recordPath);
}

async function launchCodex(
  path: LaunchPath,
  root: string,
  launchContext: AgentLaunchContext,
): Promise<{ launch: LaunchRecord; threadStartConfig: unknown }> {
  const { script, recordPath } = createRecordingCodexAppServer(root);
  restores.push(inheritOnDaemonProcess());
  const client = new CodexAppServerAgentClient(createTestLogger(), {
    command: { mode: "replace", argv: [process.execPath, script] },
    env: settingsInputs(),
  });
  // Resume and import may stop after the launch; the launch record is what is judged.
  const session = await openSession(client, "codex", path, root, launchContext).catch(() => null);
  try {
    if (path === "create") {
      await session?.startTurn("hello").catch(() => undefined);
    }
  } finally {
    await session?.close().catch(() => undefined);
  }
  const threadStart = readRecords(recordPath).find(
    (record) => record.kind === "request" && record.method === "thread/start",
  );
  return {
    launch: firstLaunch(recordPath),
    threadStartConfig: (threadStart?.params as { config?: unknown } | undefined)?.config,
  };
}

function withoutClaudeSdkChildVariables(env: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).filter(([name]) => !CLAUDE_SDK_CHILD_VARIABLES.has(name)),
  );
}

describe("a gateway harness's environment is built, not inherited", () => {
  test.each(LAUNCH_PATHS)(
    "Claude Code on %s holds only base variables, pass-through, launch values, NO_PROXY and its gateway values",
    async (path) => {
      const root = createRoot(`claude-${path}`);

      const launch = await launchClaude(path, root, gatewayLaunch("agent-claude", root));

      expect(withoutClaudeSdkChildVariables(launch.env)).toEqual(
        expectedGatewayEnv({
          daemonEnv: process.env,
          launchValues: paseoLaunchValues("agent-claude", root),
          noProxy: LOOPBACK_NO_PROXY,
          gatewayValues: { ANTHROPIC_BASE_URL: GATEWAY_URL, ANTHROPIC_AUTH_TOKEN: AGENT_TOKEN },
        }),
      );
      expect(launch.argv.join(" ")).not.toContain(AGENT_TOKEN);
    },
  );

  test.each(LAUNCH_PATHS)(
    "Codex on %s holds only base variables, pass-through, launch values, NO_PROXY and its gateway token",
    async (path) => {
      const root = createRoot(`codex-${path}`);

      const { launch } = await launchCodex(path, root, gatewayLaunch("agent-codex", root));

      expect(launch.env).toEqual(
        expectedGatewayEnv({
          daemonEnv: process.env,
          launchValues: paseoLaunchValues("agent-codex", root),
          noProxy: LOOPBACK_NO_PROXY,
          gatewayValues: { PASEO_MODEL_GATEWAY_TOKEN: AGENT_TOKEN },
        }),
      );
      expect(launch.argv.join(" ")).not.toContain(AGENT_TOKEN);
    },
  );

  test("Codex starts a responses provider at the gateway keyed by its own agent token", async () => {
    const root = createRoot("codex-config");

    const { threadStartConfig } = await launchCodex(
      "create",
      root,
      gatewayLaunch("agent-codex", root),
    );

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

  test("a second agent of each provider launches with its own, different token", async () => {
    const claudeA = await launchClaude(
      "create",
      createRoot("claude-a"),
      gatewayLaunch("agent-a", "a", "token-a"),
    );
    const claudeB = await launchClaude(
      "create",
      createRoot("claude-b"),
      gatewayLaunch("agent-b", "b", "token-b"),
    );
    const codexA = await launchCodex(
      "create",
      createRoot("codex-a"),
      gatewayLaunch("agent-a", "a", "token-a"),
    );
    const codexB = await launchCodex(
      "create",
      createRoot("codex-b"),
      gatewayLaunch("agent-b", "b", "token-b"),
    );

    expect(claudeA.env.ANTHROPIC_AUTH_TOKEN).toBe("token-a");
    expect(claudeB.env.ANTHROPIC_AUTH_TOKEN).toBe("token-b");
    expect(codexA.launch.env.PASEO_MODEL_GATEWAY_TOKEN).toBe("token-a");
    expect(codexB.launch.env.PASEO_MODEL_GATEWAY_TOKEN).toBe("token-b");
  });

  test("without a model gateway both harnesses inherit as before", async () => {
    const claudeRoot = createRoot("claude-plain");
    const codexRoot = createRoot("codex-plain");

    const claude = await launchClaude("create", claudeRoot, plainLaunch("agent-c", claudeRoot));
    const codex = await launchCodex("create", codexRoot, plainLaunch("agent-x", codexRoot));

    const launchInputs = credentialInputs("launch");
    for (const name of CREDENTIAL_AND_REDIRECTION_INPUTS) {
      expect(claude.env[name]).toBe(launchInputs[name]);
      expect(codex.launch.env[name]).toBe(launchInputs[name]);
    }
    expect(claude.env.UNLISTED_SETTING).toBe("unlisted");
    expect(codex.launch.env.UNLISTED_SETTING).toBe("unlisted");
    expect(codex.threadStartConfig ?? {}).not.toHaveProperty("model_provider");
  });
});
