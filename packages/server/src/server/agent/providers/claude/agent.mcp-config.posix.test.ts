import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import { createTestLogger } from "../../../../test-utils/test-logger.js";
import { ClaudeAgentClient } from "./agent.js";

interface LaunchRecord {
  argv: string[];
  mcpConfig: { path: string; mode: number; dirMode: number; content: string } | null;
}

const RESOLVED_TOKEN = "resolved-agent-token-7f3c";
const RESOLVED_HEADER = "resolved-plugin-header-91ab";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

/**
 * A stand-in Claude Code executable that records how it was launched: its
 * argv, and the file `--mcp-config` names (while the process is alive).
 */
function createRecordingClaudeBinary(root: string): { binary: string; recordPath: string } {
  const recordPath = join(root, "launch.json");
  const recorder = join(root, "record.cjs");
  writeFileSync(
    recorder,
    `
const fs = require("node:fs");
const path = require("node:path");
const argv = process.argv.slice(2);
const index = argv.indexOf("--mcp-config");
const value = index >= 0 ? argv[index + 1] : null;
let mcpConfig = null;
if (value && fs.existsSync(value)) {
  mcpConfig = {
    path: value,
    mode: fs.statSync(value).mode & 0o777,
    dirMode: fs.statSync(path.dirname(value)).mode & 0o777,
    content: fs.readFileSync(value, "utf8"),
  };
}
fs.writeFileSync(${JSON.stringify(recordPath)}, JSON.stringify({ argv, mcpConfig }));
process.exit(1);
`,
  );
  const binary = join(root, "claude");
  writeFileSync(binary, `#!/bin/sh\nexec "${process.execPath}" "${recorder}" "$@"\n`);
  chmodSync(binary, 0o755);
  return { binary, recordPath };
}

describe("Claude MCP configuration delivery", () => {
  test("a launched Claude process receives MCP credentials only through a private file", async () => {
    const root = mkdtempSync(join(tmpdir(), "paseo-claude-mcp-config-"));
    roots.push(root);
    const { binary, recordPath } = createRecordingClaudeBinary(root);
    const client = new ClaudeAgentClient({
      logger: createTestLogger(),
      resolveBinary: async () => binary,
      resolveVersion: async () => "2.1.0",
    });
    const session = await client.createSession({
      provider: "claude",
      cwd: root,
      mcpServers: {
        cluster: {
          type: "http",
          url: "http://127.0.0.1:6767/mcp/backends/cluster",
          headers: { Authorization: `Bearer ${RESOLVED_TOKEN}`, "X-Plugin": RESOLVED_HEADER },
        },
      },
    });

    try {
      await session.run("hello").catch(() => undefined);
    } finally {
      await session.close();
    }

    const record = JSON.parse(readFileSync(recordPath, "utf8")) as LaunchRecord;
    const argv = record.argv.join(" ");
    expect(argv).not.toContain(RESOLVED_TOKEN);
    expect(argv).not.toContain(RESOLVED_HEADER);
    expect(record.mcpConfig).not.toBeNull();
    expect(record.argv).toContain(record.mcpConfig!.path);
    expect(record.mcpConfig!.mode).toBe(0o600);
    expect(record.mcpConfig!.dirMode).toBe(0o700);
    expect(JSON.parse(record.mcpConfig!.content)).toMatchObject({
      mcpServers: {
        cluster: {
          type: "http",
          headers: { Authorization: `Bearer ${RESOLVED_TOKEN}`, "X-Plugin": RESOLVED_HEADER },
        },
      },
    });
    // The private file is gone once the process has exited and the agent closed.
    expect(existsSync(record.mcpConfig!.path)).toBe(false);
  });
});
