import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ensurePrivateDirectory, PRIVATE_FILE_MODE } from "../../../private-files.js";

const MCP_CONFIG_FLAG = "--mcp-config";

export interface PrivateMcpConfigArgs {
  args: string[];
  /** Removes the private files; safe to call more than once. */
  cleanup: () => void;
}

function isInlineJson(value: string | undefined): value is string {
  return value !== undefined && value.trimStart().startsWith("{");
}

/**
 * Writes each inline `--mcp-config` value to its own file and passes the file
 * path in its place, so the returned arguments carry no MCP configuration
 * values. Each file is owner-only (0600) inside an owner-only (0700)
 * directory; `cleanup` removes both and is called when the process exits.
 */
export function moveInlineMcpConfigToPrivateFiles(args: readonly string[]): PrivateMcpConfigArgs {
  let directory: string | null = null;
  let written = 0;
  const writePrivateFile = (contents: string): string => {
    if (directory === null) {
      directory = mkdtempSync(join(tmpdir(), "paseo-claude-mcp-"));
      ensurePrivateDirectory(directory);
    }
    written += 1;
    const filePath = join(directory, `mcp-config-${written}.json`);
    writeFileSync(filePath, contents, { encoding: "utf8", mode: PRIVATE_FILE_MODE, flag: "wx" });
    return filePath;
  };

  const next: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === MCP_CONFIG_FLAG && isInlineJson(args[index + 1])) {
      next.push(arg, writePrivateFile(args[index + 1]!));
      index += 1;
      continue;
    }
    if (arg.startsWith(`${MCP_CONFIG_FLAG}=`)) {
      const value = arg.slice(MCP_CONFIG_FLAG.length + 1);
      next.push(isInlineJson(value) ? `${MCP_CONFIG_FLAG}=${writePrivateFile(value)}` : arg);
      continue;
    }
    next.push(arg);
  }

  return {
    args: next,
    cleanup: () => {
      if (directory !== null) {
        rmSync(directory, { recursive: true, force: true });
      }
    },
  };
}
