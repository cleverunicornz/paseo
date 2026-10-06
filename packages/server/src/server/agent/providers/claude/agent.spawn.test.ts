import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import type {
  Options,
  Query,
  SpawnOptions as ClaudeSpawnOptions,
} from "@anthropic-ai/claude-agent-sdk";
import { afterEach, describe, expect, test, vi } from "vitest";

import { createTestLogger } from "../../../../test-utils/test-logger.js";
import * as spawnUtils from "../../../../utils/spawn.js";
import { ClaudeAgentClient } from "./agent.js";
import type { ClaudeQueryInput } from "./query.js";
import {
  LOOPBACK_NO_PROXY,
  PASSTHROUGH,
  credentialInputs,
  expectedGatewayEnv,
  inheritOnDaemonProcess,
  paseoLaunchValues,
  settingsInputs,
} from "../../../test-utils/model-gateway-env-inputs.js";

function createQueryMock(events: unknown[]): Query {
  let index = 0;
  return {
    next: vi.fn(async () =>
      index < events.length
        ? { done: false, value: events[index++] }
        : { done: true, value: undefined },
    ),
    return: vi.fn(async () => ({ done: true, value: undefined })),
    interrupt: vi.fn(async () => undefined),
    close: vi.fn(() => undefined),
    setPermissionMode: vi.fn(async () => undefined),
    setModel: vi.fn(async () => undefined),
    supportedModels: vi.fn(async () => [{ value: "opus", displayName: "Opus" }]),
    supportedCommands: vi.fn(async () => []),
    rewindFiles: vi.fn(async () => ({ canRewind: true })),
    [Symbol.asyncIterator]() {
      return this;
    },
  } as Query;
}

function createChildProcessStub(): ChildProcess {
  const child = new EventEmitter() as ChildProcess;
  child.stderr = new EventEmitter() as ChildProcess["stderr"];
  return child;
}

describe("Claude spawn override", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("bypasses the shell when spawning Claude Code", async () => {
    let capturedOptions: Options | undefined;
    const queryFactory = vi.fn(({ options }: ClaudeQueryInput) => {
      capturedOptions = options;
      return createQueryMock([
        {
          type: "system",
          subtype: "init",
          session_id: "claude-spawn-shell-regression-session",
          permissionMode: "default",
          model: "opus",
        },
        {
          type: "assistant",
          message: { content: "done" },
        },
        {
          type: "result",
          subtype: "success",
          usage: {
            input_tokens: 1,
            cache_read_input_tokens: 0,
            output_tokens: 1,
          },
          total_cost_usd: 0,
        },
      ]);
    });
    const spawnSpy = vi.spyOn(spawnUtils, "spawnProcess").mockReturnValue(createChildProcessStub());
    const client = new ClaudeAgentClient({
      logger: createTestLogger(),
      queryFactory,
      resolveBinary: async () => "/test/claude/bin",
    });
    const session = await client.createSession({
      provider: "claude",
      cwd: process.cwd(),
    });

    try {
      await session.run("spawn shell regression");
      capturedOptions?.spawnClaudeCodeProcess?.({
        command: "node",
        args: ["claude.js", "--mcp-config", '{"mcpServers":{"paseo":{"type":"http"}}}'],
        cwd: process.cwd(),
        env: {},
        signal: new AbortController().signal,
      } satisfies ClaudeSpawnOptions);
    } finally {
      await session.close();
    }

    const claudeSpawnCall = spawnSpy.mock.calls.find(([, args]) => args[0] === "claude.js");
    expect(claudeSpawnCall).toBeDefined();
    const spawnOptions = claudeSpawnCall?.[2];
    expect(spawnOptions?.shell).toBe(false);
  });
  test("through the daemon's own Node, a gateway harness holds only base variables, pass-through, launch values, NO_PROXY and its gateway values", async () => {
    let capturedOptions: Options | undefined;
    const queryFactory = vi.fn(({ options }: ClaudeQueryInput) => {
      capturedOptions = options;
      return createQueryMock([
        { type: "system", subtype: "init", session_id: "s", permissionMode: "default" },
        {
          type: "result",
          subtype: "success",
          usage: { input_tokens: 1, cache_read_input_tokens: 0, output_tokens: 1 },
          total_cost_usd: 0,
        },
      ]);
    });
    const spawnSpy = vi.spyOn(spawnUtils, "spawnProcess").mockReturnValue(createChildProcessStub());
    const restore = inheritOnDaemonProcess();
    const gatewayUrl = "http://127.0.0.1:6767/mcp/backends/models";
    let expected: Record<string, string> = {};
    try {
      const client = new ClaudeAgentClient({
        logger: createTestLogger(),
        queryFactory,
        resolveBinary: async () => "/test/claude/bin",
        runtimeSettings: { env: settingsInputs() },
      });
      const session = await client.createSession(
        { provider: "claude", cwd: process.cwd() },
        {
          agentId: "agent-1",
          env: { ...credentialInputs("launch"), ...paseoLaunchValues("agent-1", process.cwd()) },
          modelGateway: { baseUrl: gatewayUrl, token: "t-1", envPassthrough: PASSTHROUGH },
        },
      );
      expected = expectedGatewayEnv({
        daemonEnv: process.env,
        launchValues: paseoLaunchValues("agent-1", process.cwd()),
        noProxy: LOOPBACK_NO_PROXY,
        gatewayValues: { ANTHROPIC_BASE_URL: gatewayUrl, ANTHROPIC_AUTH_TOKEN: "t-1" },
      });
      try {
        await session.run("gateway");
        // The SDK's environment for its child is the built one.
        expect(capturedOptions?.env).toEqual(expected);
        capturedOptions?.spawnClaudeCodeProcess?.({
          command: "node",
          args: ["claude.js"],
          cwd: process.cwd(),
          env: { ...capturedOptions?.env },
          signal: new AbortController().signal,
        } satisfies ClaudeSpawnOptions);
      } finally {
        await session.close();
      }
    } finally {
      restore();
    }

    const call = spawnSpy.mock.calls.find(([, args]) => args[0] === "claude.js");
    // Running the daemon's own executable as Node is the only addition.
    expect(call?.[2]?.env).toEqual({ ...expected, ELECTRON_RUN_AS_NODE: "1" });
  });
});
