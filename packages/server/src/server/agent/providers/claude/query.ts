import { type ChildProcess, type ChildProcessWithoutNullStreams } from "node:child_process";
import { query, type Options, type Query, type SpawnOptions } from "@anthropic-ai/claude-agent-sdk";

import {
  createProviderEnv,
  createProviderEnvSpec,
  PARENT_SESSION_ENV_VARS,
  type ProviderRuntimeSettings,
} from "../../provider-launch-config.js";
import { isRefusedHarnessEnvName } from "../../model-gateway-env.js";
import { buildSelfNodeCommand, type ProcessEnvRecord } from "../../../paseo-env.js";
import { spawnProcess, type SpawnProcessOptions } from "../../../../utils/spawn.js";
import { moveInlineMcpConfigToPrivateFiles } from "./mcp-config-file.js";

// Keep the raw SDK query import in this module only. Claude process launch behavior
// must stay shared between production and tests so Windows .cmd/.bat handling cannot
// diverge from the daemon path.

export type ClaudeOptions = Options;
export type ClaudeQueryInput = Parameters<typeof query>[0] & { options: ClaudeOptions };
export type ClaudeQueryFactory = (input: ClaudeQueryInput) => Query;

export interface ClaudeQueryContext {
  runtimeSettings?: ProviderRuntimeSettings;
  launchEnv?: ProcessEnvRecord;
  /**
   * The complete environment of a gateway harness, passed to the SDK as
   * `options.env`. When set, the launch uses it instead of inheriting.
   */
  builtEnv?: ProcessEnvRecord;
  queryFactory?: ClaudeQueryFactory;
  /** Called with the spawned child process so the caller can tree-kill it on close. */
  onChildProcess?: (child: ChildProcess) => void;
}

function isChildProcessWithStreams(child: ChildProcess): child is ChildProcessWithoutNullStreams {
  return child.stdin !== null && child.stdout !== null && child.stderr !== null;
}

function resolveClaudeSpawnCommand(
  spawnOptions: SpawnOptions,
  runtimeSettings?: ProviderRuntimeSettings,
): { command: string; args: string[] } {
  const commandConfig = runtimeSettings?.command;
  if (!commandConfig || commandConfig.mode === "default") {
    return {
      command: spawnOptions.command,
      args: [...spawnOptions.args],
    };
  }

  if (commandConfig.mode === "append") {
    return {
      command: spawnOptions.command,
      args: [...spawnOptions.args, ...(commandConfig.args ?? [])],
    };
  }

  return {
    command: commandConfig.argv[0],
    args: [...commandConfig.argv.slice(1), ...spawnOptions.args],
  };
}

interface ClaudeLaunch {
  command: string;
  args: string[];
  envOptions: Pick<SpawnProcessOptions, "env" | "envMode" | "baseEnv" | "envOverlay">;
}

/**
 * A launch that inherits: the SDK's environment with runtime settings and
 * launch values overlaid.
 */
function inheritedLaunch(input: {
  spawnOptions: SpawnOptions;
  runtimeSettings?: ProviderRuntimeSettings;
  launchEnv?: ProcessEnvRecord;
  isDefaultRuntime: boolean;
  command: string;
  args: string[];
}): ClaudeLaunch {
  const overlay = {
    baseEnv: input.spawnOptions.env,
    runtimeSettings: input.runtimeSettings,
    overlays: [input.launchEnv],
  };
  if (input.isDefaultRuntime) {
    const selfNodeCommand = buildSelfNodeCommand(input.args, createProviderEnv(overlay));
    return {
      command: selfNodeCommand.command,
      args: selfNodeCommand.args,
      envOptions: { env: selfNodeCommand.env, envMode: "internal" },
    };
  }
  return { command: input.command, args: input.args, envOptions: createProviderEnvSpec(overlay) };
}

/**
 * A gateway harness's launch: its environment is the built one, which the SDK
 * received as `options.env`, plus the SDK's own protocol variables. Nothing
 * from the daemon's environment, runtime settings or launch values is
 * overlaid again.
 */
function builtLaunch(input: {
  spawnOptions: SpawnOptions;
  builtEnv: ProcessEnvRecord;
  isDefaultRuntime: boolean;
  command: string;
  args: string[];
}): ClaudeLaunch {
  const env: ProcessEnvRecord = {};
  for (const [name, value] of Object.entries(input.spawnOptions.env ?? {})) {
    const fromSdk = !Object.hasOwn(input.builtEnv, name);
    if (value === undefined || (fromSdk && isRefusedHarnessEnvName(name))) continue;
    env[name] = value;
  }
  // Parent-session markers are dropped as for every Claude launch.
  for (const name of PARENT_SESSION_ENV_VARS) {
    delete env[name];
  }
  if (input.isDefaultRuntime) {
    const selfNodeCommand = buildSelfNodeCommand(input.args);
    return {
      command: selfNodeCommand.command,
      args: selfNodeCommand.args,
      // Runs the daemon's own executable (which may be Electron) as Node.
      envOptions: { env: { ...env, ELECTRON_RUN_AS_NODE: "1" }, envMode: "internal" },
    };
  }
  return { command: input.command, args: input.args, envOptions: { env, envMode: "internal" } };
}

function applyRuntimeSettingsToClaudeOptions(
  options: ClaudeOptions,
  context: ClaudeQueryContext,
): ClaudeOptions {
  const { runtimeSettings, launchEnv, builtEnv, onChildProcess } = context;
  return {
    ...options,
    spawnClaudeCodeProcess: (spawnOptions) => {
      const resolved = resolveClaudeSpawnCommand(spawnOptions, runtimeSettings);
      // When the SDK passes a default JS runtime ("node"/"bun"), replace it with
      // process.execPath — the actual node binary running the daemon. This avoids
      // PATH lookup failures in the managed runtime bundle.
      // When the SDK passes a native binary path (from pathToClaudeCodeExecutable)
      // or the user overrides the command via runtime settings, use that directly.
      const isDefaultRuntime = resolved.command === "node" || resolved.command === "bun";
      // MCP configuration reaches Claude Code through a private file, never argv.
      const privateMcpConfig = moveInlineMcpConfigToPrivateFiles(resolved.args);
      const launch = builtEnv
        ? builtLaunch({
            spawnOptions,
            builtEnv,
            isDefaultRuntime,
            command: resolved.command,
            args: privateMcpConfig.args,
          })
        : inheritedLaunch({
            spawnOptions,
            runtimeSettings,
            launchEnv,
            isDefaultRuntime,
            command: resolved.command,
            args: privateMcpConfig.args,
          });
      let child: ChildProcess;
      try {
        child = spawnProcess(launch.command, launch.args, {
          cwd: spawnOptions.cwd,
          ...launch.envOptions,
          signal: spawnOptions.signal,
          stdio: ["pipe", "pipe", "pipe"],
          // The command is always a resolved binary path; spawning without a
          // shell keeps quoted arguments intact on Windows.
          shell: false,
        });
      } catch (error) {
        privateMcpConfig.cleanup();
        throw error;
      }
      child.once("exit", privateMcpConfig.cleanup);
      child.once("error", privateMcpConfig.cleanup);
      onChildProcess?.(child);
      if (typeof options.stderr === "function") {
        child.stderr?.on("data", (chunk: Buffer | string) => {
          options.stderr?.(chunk.toString());
        });
      }
      if (!isChildProcessWithStreams(child)) {
        throw new Error("Claude process was spawned without stdio streams");
      }
      return child;
    },
  };
}

export function claudeQuery(input: ClaudeQueryInput, context: ClaudeQueryContext = {}): Query {
  const launchQuery = context.queryFactory ?? query;
  return launchQuery({
    ...input,
    options: applyRuntimeSettingsToClaudeOptions(input.options, context),
  });
}
