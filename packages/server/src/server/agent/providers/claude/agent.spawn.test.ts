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

/** Model-provider credential and endpoint variables a harness could inherit. */
const MODEL_PROVIDER_VARIABLES = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_BASE_URL",
  "CLAUDE_CODE_OAUTH_TOKEN",
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "CODEX_API_KEY",
];

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
  test("a node-launched Claude Code with a model gateway carries only its own gateway values", async () => {
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
    const saved = Object.fromEntries(
      MODEL_PROVIDER_VARIABLES.map((name) => [name, process.env[name]]),
    );
    for (const name of MODEL_PROVIDER_VARIABLES) {
      process.env[name] = `daemon-${name.toLowerCase()}`;
    }
    const client = new ClaudeAgentClient({
      logger: createTestLogger(),
      queryFactory,
      resolveBinary: async () => "/test/claude/bin",
      runtimeSettings: {
        env: Object.fromEntries(
          MODEL_PROVIDER_VARIABLES.map((name) => [name, `settings-${name.toLowerCase()}`]),
        ),
      },
    });
    try {
      const session = await client.createSession(
        { provider: "claude", cwd: process.cwd() },
        {
          agentId: "agent-1",
          env: {},
          modelGateway: { baseUrl: "http://127.0.0.1:6767/mcp/backends/models", token: "t-1" },
        },
      );
      try {
        await session.run("gateway");
        expect(capturedOptions?.env?.ANTHROPIC_API_KEY).toBeUndefined();
        expect(capturedOptions?.env?.OPENAI_API_KEY).toBeUndefined();
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
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }

    const call = spawnSpy.mock.calls.find(([, args]) => args[0] === "claude.js");
    const env = call?.[2]?.env as Record<string, string | undefined> | undefined;
    const modelEnv = Object.fromEntries(
      MODEL_PROVIDER_VARIABLES.flatMap((name) =>
        env?.[name] === undefined ? [] : [[name, env[name]]],
      ),
    );
    expect(modelEnv).toEqual({
      ANTHROPIC_BASE_URL: "http://127.0.0.1:6767/mcp/backends/models",
      ANTHROPIC_AUTH_TOKEN: "t-1",
    });
  });
});
