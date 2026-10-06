import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import { createTestLogger } from "../../../test-utils/test-logger.js";
import type { AgentClient, AgentSessionConfig } from "../agent-sdk-types.js";
import { CodexAppServerAgentClient } from "./codex-app-server-agent.js";
import { GenericACPAgentClient } from "./generic-acp-agent.js";

const RESOLVED_TOKEN = "resolved-agent-token-c41d";
const RESOLVED_HEADER = "resolved-plugin-header-5e02";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

/** A stand-in provider executable that appends each launch's argv to a record and exits. */
function createRecordingBinary(root: string): { binary: string; recordPath: string } {
  const recordPath = join(root, "launches.jsonl");
  const recorder = join(root, "record.cjs");
  writeFileSync(
    recorder,
    `require("node:fs").appendFileSync(${JSON.stringify(recordPath)}, JSON.stringify(process.argv.slice(2)) + "\\n");
process.exit(1);
`,
  );
  const binary = join(root, "provider");
  writeFileSync(binary, `#!/bin/sh\nexec "${process.execPath}" "${recorder}" "$@"\n`);
  chmodSync(binary, 0o755);
  return { binary, recordPath };
}

function credentialBearingConfig(provider: string, cwd: string): AgentSessionConfig {
  return {
    provider,
    cwd,
    mcpServers: {
      cluster: {
        type: "http",
        url: "http://127.0.0.1:6767/mcp/backends/cluster",
        headers: { Authorization: `Bearer ${RESOLVED_TOKEN}`, "X-Plugin": RESOLVED_HEADER },
      },
    },
  };
}

async function launchOnce(client: AgentClient, config: AgentSessionConfig): Promise<void> {
  const session = await client.createSession(config).catch(() => null);
  if (!session) return;
  try {
    await session.run("hello").catch(() => undefined);
  } finally {
    await session.close().catch(() => undefined);
  }
}

async function waitForLaunch(recordPath: string, arg: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(recordPath) && readFileSync(recordPath, "utf8").includes(JSON.stringify(arg))) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

describe("provider launches keep MCP credentials out of process arguments", () => {
  test.each([
    {
      provider: "codex",
      sessionArg: "app-server",
      createClient: (binary: string) =>
        new CodexAppServerAgentClient(createTestLogger(), {
          command: { mode: "replace", argv: [binary] },
        }),
    },
    {
      provider: "acp",
      sessionArg: "acp",
      createClient: (binary: string) =>
        new GenericACPAgentClient({ logger: createTestLogger(), command: [binary, "acp"] }),
    },
  ])(
    "$provider argv holds no resolved MCP credential",
    async ({ provider, sessionArg, createClient }) => {
      const root = mkdtempSync(join(tmpdir(), `paseo-${provider}-argv-`));
      roots.push(root);
      const { binary, recordPath } = createRecordingBinary(root);

      // Some clients keep waiting on a process that exits at once; the launch
      // record is what this test judges, so wait for that rather than the session.
      const launched = launchOnce(createClient(binary), credentialBearingConfig(provider, root));
      await Promise.race([launched, waitForLaunch(recordPath, sessionArg, 10_000)]);

      expect(existsSync(recordPath)).toBe(true);
      const launches = readFileSync(recordPath, "utf8").trim().split("\n");
      expect(launches.some((launch) => launch.includes(JSON.stringify(sessionArg)))).toBe(true);
      for (const launch of launches) {
        expect(launch).not.toContain(RESOLVED_TOKEN);
        expect(launch).not.toContain(RESOLVED_HEADER);
      }
    },
  );
});
