import type { ChildProcess } from "node:child_process";

import {
  findExecutable,
  probeExecutable,
} from "../../executable-resolution/executable-resolution.js";
import {
  execCommand,
  spawnProcess,
  type ExecCommandOptions,
  type SpawnEnvOptions,
  type SpawnProcessOptions,
} from "../../utils/spawn.js";
import type { HarnessSpawnEnv } from "./model-gateway-env.js";
import {
  checkProviderLaunchAvailable,
  type ProviderLaunchAvailability,
  type ProviderLaunchDefault,
  type ResolvedProviderLaunch,
} from "./provider-launch-config.js";
import {
  buildBinaryDiagnosticRows,
  buildCommandResolutionDiagnosticRows,
  resolveBinaryVersion,
  type BinaryDiagnosticRowsOptions,
  type CommandResolutionDiagnosticRowsOptions,
  type DiagnosticEntry,
} from "./providers/diagnostic-utils.js";

/**
 * The only way a harness module (Claude Code, Codex) starts a process from its
 * harness binary. Each helper takes the process's `HarnessSpawnEnv`, which only
 * `resolveHarnessSpawnEnv` produces, so every harness process gets its
 * provider's harness environment. `harness-spawn-sites.test.ts` keeps harness
 * modules on these helpers.
 */

type WithoutEnv<T> = Omit<T, keyof SpawnEnvOptions>;

export function spawnHarnessProcess(
  command: string,
  args: string[],
  env: HarnessSpawnEnv,
  options: WithoutEnv<SpawnProcessOptions> = {},
): ChildProcess {
  return spawnProcess(command, args, { ...options, ...env });
}

export function execHarnessCommand(
  command: string,
  args: string[],
  env: HarnessSpawnEnv,
  options: WithoutEnv<ExecCommandOptions> = {},
): Promise<{ stdout: string; stderr: string }> {
  return execCommand(command, args, { ...options, ...env });
}

export function probeHarnessExecutable(
  executablePath: string,
  env: HarnessSpawnEnv,
): Promise<boolean> {
  return probeExecutable(executablePath, undefined, env);
}

export function findHarnessExecutable(name: string, env: HarnessSpawnEnv): Promise<string | null> {
  return findExecutable(name, undefined, env);
}

/** `defaultBinary.resolvePath`, when set, probes with the same `env`. */
export function checkHarnessLaunchAvailable(
  launch: ResolvedProviderLaunch,
  env: HarnessSpawnEnv,
  defaultBinary?: ProviderLaunchDefault,
): Promise<ProviderLaunchAvailability> {
  return checkProviderLaunchAvailable(launch, defaultBinary, env);
}

export function resolveHarnessBinaryVersion(
  binaryPath: string,
  env: HarnessSpawnEnv,
  signal?: AbortSignal,
): Promise<string> {
  return resolveBinaryVersion(binaryPath, signal, env);
}

export function buildHarnessBinaryDiagnosticRows(
  launch: ResolvedProviderLaunch,
  availability: ProviderLaunchAvailability,
  env: HarnessSpawnEnv,
  options: Omit<BinaryDiagnosticRowsOptions, "versionEnv"> = {},
): Promise<DiagnosticEntry[]> {
  return buildBinaryDiagnosticRows(launch, availability, { ...options, versionEnv: env });
}

/** The `which` and `$SHELL -lc 'type -a …'` lookups of the harness binary run with `env`. */
export function buildHarnessCommandResolutionDiagnosticRows(
  launch: ResolvedProviderLaunch,
  env: HarnessSpawnEnv,
  options: Omit<CommandResolutionDiagnosticRowsOptions, "probeEnv">,
): Promise<DiagnosticEntry[]> {
  return buildCommandResolutionDiagnosticRows(launch, { ...options, probeEnv: env });
}
