import os from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import pino from "pino";

import { resolveTestCodexBinary } from "../test-utils/codex-binary.js";
import { CodexExecutor, buildExecutorEnv } from "./codex-executor.js";

const codexPath = resolveTestCodexBinary();

interface CommandExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitFor(condition: () => boolean, timeoutMs = 10_000): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) throw new Error("timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

describe.skipIf(!codexPath)("Codex executor (real app server, no model)", () => {
  let root: string;
  let current: CodexExecutor | null = null;

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "paseo-executor-"));
  });

  afterEach(async () => {
    await current?.close();
    current = null;
    await rm(root, { recursive: true, force: true });
  });

  function createExecutor(env: Record<string, string> = buildExecutorEnv({ envPassthrough: [] })) {
    current = new CodexExecutor({
      codexPath: codexPath!,
      codexHome: path.join(root, "codex-home"),
      env,
      logger: pino({ level: "silent" }),
    });
    return current;
  }

  test("starts on the first call, with its own CODEX_HOME", async () => {
    const executor = createExecutor();
    expect(executor.pid).toBeNull();

    const result = await executor.request<CommandExecResult>("command/exec", {
      command: ["sh", "-c", 'printf %s "$CODEX_HOME"'],
      cwd: root,
      sandboxPolicy: { type: "dangerFullAccess" },
    });

    expect(executor.pid).toEqual(expect.any(Number));
    expect(result).toEqual({
      exitCode: 0,
      stdout: path.join(root, "codex-home"),
      stderr: "",
    });
    expect(executor.codexHome).toBe(path.join(root, "codex-home"));
  });

  test("is started again by the next call after it dies", async () => {
    const executor = createExecutor();
    await executor.request("fs/getMetadata", { path: root });
    const firstPid = executor.pid!;

    process.kill(firstPid, "SIGKILL");
    await waitFor(() => !isAlive(firstPid) && executor.pid === null);

    const result = await executor.request<CommandExecResult>("command/exec", {
      command: ["true"],
      cwd: root,
      sandboxPolicy: { type: "dangerFullAccess" },
    });
    expect(result.exitCode).toBe(0);
    expect(executor.pid).toEqual(expect.any(Number));
    expect(executor.pid).not.toBe(firstPid);
  });

  test("its commands get the allowlisted environment, not the daemon's", async () => {
    process.env.PASEO_EXECUTOR_TEST_SENTINEL = "daemon-only";
    process.env.PASEO_EXECUTOR_TEST_PASSED = "passed";
    try {
      const executor = createExecutor(
        buildExecutorEnv({ envPassthrough: ["PASEO_EXECUTOR_TEST_PASSED"] }),
      );
      const result = await executor.request<CommandExecResult>("command/exec", {
        command: [
          "sh",
          "-c",
          'printf "%s|%s" "$PASEO_EXECUTOR_TEST_SENTINEL" "$PASEO_EXECUTOR_TEST_PASSED"',
        ],
        cwd: root,
        sandboxPolicy: { type: "dangerFullAccess" },
      });
      expect(result.stdout).toBe("|passed");
    } finally {
      delete process.env.PASEO_EXECUTOR_TEST_SENTINEL;
      delete process.env.PASEO_EXECUTOR_TEST_PASSED;
    }
  });

  test("close stops the app server", async () => {
    const executor = createExecutor();
    await executor.request("fs/getMetadata", { path: root });
    const pid = executor.pid!;
    await executor.close();
    await waitFor(() => !isAlive(pid));
    expect(executor.pid).toBeNull();
    await expect(executor.request("fs/getMetadata", { path: root })).rejects.toThrow(/closed/);
  });
});
