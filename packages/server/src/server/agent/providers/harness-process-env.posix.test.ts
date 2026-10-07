import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import { createTestLogger } from "../../../test-utils/test-logger.js";
import {
  CREDENTIAL_AND_REDIRECTION_INPUTS,
  PASSTHROUGH,
  credentialInputs,
  expectedAllowlistedEnv,
  inheritOnDaemonProcess,
  paseoLaunchValues,
  settingsInputs,
} from "../../test-utils/model-gateway-env-inputs.js";
import type { AgentClient, AgentLaunchContext } from "../agent-sdk-types.js";
import type { HarnessEnvironment } from "../model-gateway-env.js";
import { buildProviderRegistry } from "../provider-registry.js";
import { ProviderSnapshotManager } from "../provider-snapshot-manager.js";
import { ClaudeAgentClient } from "./claude/agent.js";
import { CodexAppServerAgentClient } from "./codex-app-server-agent.js";

/**
 * Every process the daemon starts from a harness binary — availability and
 * version probes, the auth-status diagnostic, catalogue and listing
 * app-servers, draft sessions and agent sessions — receives the allowlisted
 * environment when the harness's provider routes its model traffic through
 * the gateway. Each process records its own environment, and every recorded
 * process is judged on its own.
 */

/**
 * Variables the Claude Agent SDK sets on its own child to select its protocol
 * features; they derive from the SDK options, never from an inherited value.
 */
const CLAUDE_SDK_CHILD_VARIABLES = new Set(["CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING"]);

const ALLOWLIST: HarnessEnvironment = { kind: "allowlist", envPassthrough: PASSTHROUGH };

interface ProcessRecord {
  argv: string[];
  env: Record<string, string>;
}

const roots: string[] = [];
const restores: Array<() => void> = [];

afterEach(() => {
  for (const restore of restores.splice(0)) restore();
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function createRoot(name: string): string {
  const root = mkdtempSync(join(tmpdir(), `paseo-harness-env-${name}-`));
  roots.push(root);
  return root;
}

const RECORD_PROCESS = (recordPath: string) => `
const fs = require("node:fs");
const argv = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(recordPath)}, JSON.stringify({ argv, env: process.env }) + "\\n");
`;

/**
 * A stand-in Claude Code executable that records every start: it answers
 * `--version` and `auth status`, and exits on a session launch.
 */
function createRecordingClaude(root: string): { binary: string; recordPath: string } {
  const recordPath = join(root, "claude.jsonl");
  const binary = join(root, "claude");
  writeFileSync(
    binary,
    `#!${process.execPath}
${RECORD_PROCESS(recordPath)}
if (argv[0] === "--version") { process.stdout.write("2.1.0 (Claude Code)\\n"); process.exit(0); }
if (argv[0] === "auth" && argv[1] === "status") { process.stdout.write("Logged in\\n"); process.exit(0); }
process.exit(1);
`,
  );
  chmodSync(binary, 0o755);
  return { binary, recordPath };
}

/**
 * A stand-in Codex executable that records every start: it answers `--version`
 * and serves `app-server` JSON-RPC.
 */
function createRecordingCodex(root: string): { binary: string; recordPath: string } {
  const recordPath = join(root, "codex.jsonl");
  const binary = join(root, "codex");
  writeFileSync(
    binary,
    `#!${process.execPath}
${RECORD_PROCESS(recordPath)}
if (argv[0] === "--version") { process.stdout.write("codex-cli 0.200.0\\n"); process.exit(0); }
if (argv[0] !== "app-server") process.exit(1);
let buffer = "";
function resultFor(method) {
  if (method === "thread/start") return { thread: { id: "thread-1" } };
  if (method === "thread/resume") return { thread: { id: "thread-1" } };
  if (method === "thread/read") return { thread: { turns: [] } };
  if (method === "thread/list" || method === "thread/loaded/list") return { data: [] };
  if (method === "config/read" || method === "getUserSavedConfig") return { config: {} };
  if (method === "model/list") return { data: [{ id: "listed-model", isDefault: true }] };
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
    if (message.id !== undefined) {
      process.stdout.write(JSON.stringify({ id: message.id, result: resultFor(message.method) }) + "\\n");
    }
  }
});
`,
  );
  chmodSync(binary, 0o755);
  return { binary, recordPath };
}

function readProcessRecords(recordPath: string): ProcessRecord[] {
  if (!existsSync(recordPath)) return [];
  return readFileSync(recordPath, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as ProcessRecord);
}

function withoutClaudeSdkChildVariables(env: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).filter(([name]) => !CLAUDE_SDK_CHILD_VARIABLES.has(name)),
  );
}

function plainLaunch(agentId: string, cwd: string): AgentLaunchContext {
  return { agentId, env: { ...credentialInputs("launch"), ...paseoLaunchValues(agentId, cwd) } };
}

function claudeClient(binary: string, harnessEnvironment?: HarnessEnvironment): ClaudeAgentClient {
  return new ClaudeAgentClient({
    logger: createTestLogger(),
    runtimeSettings: { command: { mode: "replace", argv: [binary] }, env: settingsInputs() },
    ...(harnessEnvironment ? { harnessEnvironment } : {}),
  });
}

function codexClient(
  binary: string,
  harnessEnvironment?: HarnessEnvironment,
): CodexAppServerAgentClient {
  return new CodexAppServerAgentClient(
    createTestLogger(),
    { command: { mode: "replace", argv: [binary] }, env: settingsInputs() },
    harnessEnvironment ? { harnessEnvironment } : {},
  );
}

async function runClaudeSession(
  client: AgentClient,
  cwd: string,
  launchContext?: AgentLaunchContext,
): Promise<void> {
  const session = await client.createSession({ provider: "claude", cwd }, launchContext);
  try {
    await session.run("hello").catch(() => undefined);
  } finally {
    await session.close();
  }
}

async function runCodexSession(
  client: AgentClient,
  cwd: string,
  launchContext?: AgentLaunchContext,
): Promise<void> {
  const session = await client
    .createSession({ provider: "codex", cwd, modeId: "auto" }, launchContext)
    .catch(() => null);
  await session?.close().catch(() => undefined);
}

interface HarnessPath {
  name: string;
  provider: "claude" | "codex";
  /** Arguments of a process this path must start, proving the path ran. */
  starts: string[];
  /** Paseo's launch values the processes of this path carry. */
  launchValues?: (cwd: string) => Record<string, string>;
  run: (client: AgentClient, cwd: string) => Promise<unknown>;
}

const HARNESS_PATHS: HarnessPath[] = [
  {
    name: "Claude availability probe",
    provider: "claude",
    starts: ["--version"],
    run: (client) => client.isAvailable(),
  },
  {
    name: "Claude version probe for the model catalogue",
    provider: "claude",
    starts: ["--version"],
    run: (client) => client.fetchCatalog({ scope: "global", force: true }),
  },
  {
    name: "Claude diagnostic (version and auth status)",
    provider: "claude",
    starts: ["--version", "auth status"],
    run: (client) => client.getDiagnostic!(),
  },
  {
    name: "Claude draft session started without a launch context",
    provider: "claude",
    starts: ["--version"],
    run: (client, cwd) => runClaudeSession(client, cwd),
  },
  {
    name: "Claude agent session started without a gateway route",
    provider: "claude",
    starts: ["--version"],
    launchValues: (cwd) => paseoLaunchValues("agent-claude", cwd),
    run: (client, cwd) => runClaudeSession(client, cwd, plainLaunch("agent-claude", cwd)),
  },
  {
    name: "Codex availability probe",
    provider: "codex",
    starts: ["--version"],
    run: (client) => client.isAvailable(),
  },
  {
    name: "Codex version probe for the default mode",
    provider: "codex",
    starts: ["--version"],
    run: (client, cwd) => client.resolveDefaultModeId!({ config: { provider: "codex", cwd } }),
  },
  {
    name: "Codex model catalogue app-server",
    provider: "codex",
    starts: ["app-server"],
    run: (client) => client.fetchCatalog({ scope: "global", force: true }),
  },
  {
    name: "Codex importable-session listing app-server",
    provider: "codex",
    starts: ["app-server"],
    run: (client) => client.listImportableSessions!(),
  },
  {
    name: "Codex native archive app-server",
    provider: "codex",
    starts: ["app-server"],
    run: (client) => client.archiveNativeSession!({ provider: "codex", sessionId: "thread-1" }),
  },
  {
    name: "Codex diagnostic",
    provider: "codex",
    starts: ["--version"],
    run: (client) => client.getDiagnostic!(),
  },
  {
    name: "Codex draft session started without a launch context",
    provider: "codex",
    starts: ["app-server"],
    run: (client, cwd) => runCodexSession(client, cwd),
  },
  {
    name: "Codex agent session started without a gateway route",
    provider: "codex",
    starts: ["app-server"],
    launchValues: (cwd) => paseoLaunchValues("agent-codex", cwd),
    run: (client, cwd) => runCodexSession(client, cwd, plainLaunch("agent-codex", cwd)),
  },
];

async function runPath(
  path: HarnessPath,
  harnessEnvironment: HarnessEnvironment | undefined,
): Promise<{ root: string; records: ProcessRecord[] }> {
  const root = createRoot(path.provider);
  const fake =
    path.provider === "claude" ? createRecordingClaude(root) : createRecordingCodex(root);
  restores.push(inheritOnDaemonProcess());
  const client =
    path.provider === "claude"
      ? claudeClient(fake.binary, harnessEnvironment)
      : codexClient(fake.binary, harnessEnvironment);
  await path.run(client, root);
  await client.shutdown?.();
  return { root, records: readProcessRecords(fake.recordPath) };
}

function isProbe(record: ProcessRecord): boolean {
  return record.argv[0] === "--version" || record.argv[0] === "auth";
}

function expectPathRan(path: HarnessPath, records: ProcessRecord[]): void {
  const started = records.map((record) => record.argv.join(" "));
  for (const start of path.starts) {
    expect(
      started.some((argv) => argv.startsWith(start)),
      `${path.name} starts \`${start}\``,
    ).toBe(true);
  }
}

describe("every harness process of a gateway provider starts from the allowlisted environment", () => {
  test.each(HARNESS_PATHS.map((path) => [path.name, path] as const))("%s", async (_name, path) => {
    const { root, records } = await runPath(path, ALLOWLIST);

    expectPathRan(path, records);
    records.forEach((record, index) => {
      expect(
        withoutClaudeSdkChildVariables(record.env),
        `${path.name}: process ${index} (${record.argv.join(" ")})`,
      ).toEqual(
        expectedAllowlistedEnv({
          daemonEnv: process.env,
          launchValues: isProbe(record) ? undefined : path.launchValues?.(root),
        }),
      );
    });
  });
});

describe("without a gateway route every harness process inherits as before", () => {
  test.each(HARNESS_PATHS.map((path) => [path.name, path] as const))("%s", async (_name, path) => {
    const { records } = await runPath(path, undefined);

    expectPathRan(path, records);
    records.forEach((record, index) => {
      const label = `${path.name}: process ${index} (${record.argv.join(" ")})`;
      for (const name of CREDENTIAL_AND_REDIRECTION_INPUTS) {
        expect(record.env[name], `${label}: ${name}`).toBeDefined();
      }
      expect(record.env.UNLISTED_SETTING, label).toBe("unlisted");
    });
  });
});

describe("the daemon's model-gateway configuration selects the allowlist per provider", () => {
  function registryOptions(claudeBinary: string, codexBinary: string) {
    return {
      runtimeSettings: {
        claude: {
          command: { mode: "replace" as const, argv: [claudeBinary] },
          env: settingsInputs(),
        },
        codex: {
          command: { mode: "replace" as const, argv: [codexBinary] },
          env: settingsInputs(),
        },
      },
      providerOverrides: {
        "work-claude": {
          extends: "claude",
          label: "Work Claude",
          command: [claudeBinary],
          env: settingsInputs(),
        },
      },
    };
  }

  function expectAllowlisted(records: ProcessRecord[], label: string): void {
    expect(records.length, `${label} started`).toBeGreaterThan(0);
    records.forEach((record, index) => {
      expect(record.env, `${label}: process ${index}`).toEqual(
        expectedAllowlistedEnv({ daemonEnv: process.env }),
      );
    });
  }

  function expectInherited(records: ProcessRecord[], label: string): void {
    expect(records.length, `${label} started`).toBeGreaterThan(0);
    records.forEach((record, index) => {
      expect(record.env.UNLISTED_SETTING, `${label}: process ${index}`).toBe("unlisted");
      expect(record.env.HTTPS_PROXY, `${label}: process ${index}`).toBeDefined();
    });
  }

  test("the provider registry gives a gateway provider, built-in or derived, the allowlist", async () => {
    const claudeRoot = createRoot("registry-claude");
    const derivedRoot = createRoot("registry-derived");
    const codexRoot = createRoot("registry-codex");
    const claude = createRecordingClaude(claudeRoot);
    const derived = createRecordingClaude(derivedRoot);
    const codex = createRecordingCodex(codexRoot);
    restores.push(inheritOnDaemonProcess());
    const options = registryOptions(claude.binary, codex.binary);
    options.providerOverrides["work-claude"].command = [derived.binary];
    const registry = buildProviderRegistry(createTestLogger(), {
      ...options,
      mcpGatewayModelBackends: { claude: "models", "work-claude": "models" },
      mcpGatewayEnvPassthrough: PASSTHROUGH,
    });

    await registry.claude.createClient(createTestLogger()).isAvailable();
    await registry["work-claude"].createClient(createTestLogger()).isAvailable();
    await registry.codex.createClient(createTestLogger()).isAvailable();

    expectAllowlisted(readProcessRecords(claude.recordPath), "claude");
    expectAllowlisted(readProcessRecords(derived.recordPath), "work-claude");
    expectInherited(readProcessRecords(codex.recordPath), "codex without a model backend");
  });

  test("the provider snapshot manager hands the agent manager allowlisted clients", async () => {
    const claudeRoot = createRoot("snapshot-claude");
    const codexRoot = createRoot("snapshot-codex");
    const claude = createRecordingClaude(claudeRoot);
    const codex = createRecordingCodex(codexRoot);
    restores.push(inheritOnDaemonProcess());
    const manager = new ProviderSnapshotManager({
      logger: createTestLogger(),
      ...registryOptions(claude.binary, codex.binary),
      mcpGatewayModelBackends: { codex: "models" },
      mcpGatewayEnvPassthrough: PASSTHROUGH,
    });
    try {
      const { clients } = manager.getAgentManagerProviderState();
      await clients.codex.isAvailable();
      await clients.claude.isAvailable();
    } finally {
      manager.destroy();
    }

    expectAllowlisted(readProcessRecords(codex.recordPath), "codex");
    expectInherited(readProcessRecords(claude.recordPath), "claude without a model backend");
  });
});
