import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname } from "node:path";
import { describe, expect, test } from "vitest";

import { moveInlineMcpConfigToPrivateFiles } from "./mcp-config-file.js";

const INLINE = '{"mcpServers":{"cluster":{"type":"http","headers":{"Authorization":"Bearer t"}}}}';

describe("moveInlineMcpConfigToPrivateFiles", () => {
  test("replaces inline values in both flag forms with private files it removes on cleanup", () => {
    const moved = moveInlineMcpConfigToPrivateFiles([
      "--print",
      "--mcp-config",
      INLINE,
      `--mcp-config=${INLINE}`,
    ]);
    const first = moved.args[2]!;
    const second = moved.args[3]!.slice("--mcp-config=".length);

    expect(moved.args.join(" ")).not.toContain("Bearer t");
    for (const file of [first, second]) {
      expect(readFileSync(file, "utf8")).toBe(INLINE);
      expect(statSync(file).mode & 0o777).toBe(0o600);
      expect(statSync(dirname(file)).mode & 0o777).toBe(0o700);
    }

    moved.cleanup();
    moved.cleanup();
    expect(existsSync(first)).toBe(false);
    expect(existsSync(dirname(first))).toBe(false);
  });

  test("leaves file paths and unrelated arguments unchanged and creates no files", () => {
    const args = ["--mcp-config", "/etc/claude/mcp.json", "--model", "opus"];
    const moved = moveInlineMcpConfigToPrivateFiles(args);
    expect(moved.args).toEqual(args);
    moved.cleanup();
  });
});
