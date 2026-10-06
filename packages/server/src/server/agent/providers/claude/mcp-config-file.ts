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
 * MCP configuration can hold credentials (the agent's daemon token, plugin
 * headers), and process arguments are visible to every local user. The Claude
 * SDK passes MCP configuration inline after `--mcp-config`; Claude Code also
 * accepts a file path there. This writes each inline value to a file readable
 * only by the daemon user, in a directory only the daemon user can enter, and
 * passes the path instead. Call `cleanup` when the process exits.
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
