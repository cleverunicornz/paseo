import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DaemonConnectionError } from "@getpaseo/client/internal/daemon-client";
import {
  resolveExistingRunWorkspace,
  resolveRunCallerAgentId,
  runRunCommand,
  type AgentRunOptions,
} from "./run";

const daemonTarget = { kind: "endpoint" as const, host: "example.test:12345" };

// A test that sets `connected.client` runs against that fake daemon; the rest connect for real.
const connected = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("../../utils/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils/client.js")>();
  return {
    ...actual,
    connectToDaemon: vi.fn(async (...args: Parameters<typeof actual.connectToDaemon>) =>
      connected.client ? connected.client : actual.connectToDaemon(...args),
    ),
  };
});

// Answers fetchAgent the way a daemon does: an unknown id is an error.
function daemonWithAgents(...agentIds: string[]) {
  return {
    async fetchAgent({ agentId }: { agentId: string }) {
      if (!agentIds.includes(agentId)) {
        throw new Error(`Agent not found: ${agentId}`);
      }
      return { agent: { id: agentId } };
    },
  };
}

describe("managed agent caller context", () => {
  it("uses a trimmed PASEO_AGENT_ID when the target daemon runs that agent", async () => {
    await expect(
      resolveRunCallerAgentId(daemonWithAgents("parent-agent"), {
        PASEO_AGENT_ID: "  parent-agent  ",
      }),
    ).resolves.toBe("parent-agent");
  });

  it("runs without a caller when PASEO_AGENT_ID belongs to another daemon", async () => {
    await expect(
      resolveRunCallerAgentId(daemonWithAgents("other-agent"), {
        PASEO_AGENT_ID: "parent-agent",
      }),
    ).resolves.toBeUndefined();
  });

  it("fails instead of dropping the caller when the lookup loses its connection", async () => {
    const disconnectedDaemon = {
      async fetchAgent(): Promise<never> {
        throw new DaemonConnectionError("Connection lost before message could be sent");
      },
    };

    await expect(
      resolveRunCallerAgentId(disconnectedDaemon, { PASEO_AGENT_ID: "parent-agent" }),
    ).rejects.toBeInstanceOf(DaemonConnectionError);
  });

  it("omits blank caller ids", async () => {
    await expect(
      resolveRunCallerAgentId(daemonWithAgents(), { PASEO_AGENT_ID: "   " }),
    ).resolves.toBeUndefined();
  });
});

describe("existing run workspace resolution", () => {
  it("queries the daemon for an exact workspace id and uses its directory", async () => {
    const fetchWorkspaces = vi.fn().mockResolvedValue({
      entries: [{ id: "workspace-2", workspaceDirectory: "/workspace/two" }],
      pageInfo: { nextCursor: null },
    });

    await expect(resolveExistingRunWorkspace({ fetchWorkspaces }, "workspace-2")).resolves.toEqual({
      id: "workspace-2",
      cwd: "/workspace/two",
    });
    expect(fetchWorkspaces).toHaveBeenCalledWith({
      filter: { query: "workspace-2" },
      page: { limit: 200 },
    });
  });

  it("rejects a workspace id absent from daemon state", async () => {
    const fetchWorkspaces = vi.fn().mockResolvedValue({
      entries: [],
      pageInfo: { nextCursor: null },
    });

    await expect(resolveExistingRunWorkspace({ fetchWorkspaces }, "missing")).rejects.toMatchObject(
      {
        code: "WORKSPACE_NOT_FOUND",
        message: "Workspace not found: missing",
      },
    );
  });
});

// validateRunOptions runs before the CLI ever connects to a daemon, so these
// invalid combinations reject without one running.
describe("runRunCommand option validation", () => {
  const originalWorkspaceId = process.env.PASEO_WORKSPACE_ID;

  beforeEach(() => {
    delete process.env.PASEO_WORKSPACE_ID;
  });

  afterEach(() => {
    if (originalWorkspaceId === undefined) {
      delete process.env.PASEO_WORKSPACE_ID;
    } else {
      process.env.PASEO_WORKSPACE_ID = originalWorkspaceId;
    }
  });

  async function expectInvalidOptions(
    options: Omit<AgentRunOptions, "daemonTarget">,
    messageMatch: RegExp,
  ) {
    await expect(
      runRunCommand("do something", { ...options, daemonTarget }, {} as never),
    ).rejects.toMatchObject({
      code: "INVALID_OPTIONS",
      message: expect.stringMatching(messageMatch),
    });
  }

  it("rejects --new-workspace combined with --workspace", async () => {
    await expectInvalidOptions(
      { newWorkspace: "worktree", workspace: "ws-1" },
      /--new-workspace and --workspace cannot be combined/,
    );
  });

  it("allows explicit worktree workspace creation through validation", async () => {
    // Explicit workspace creation with no --workspace
    // must clear validation. It still fails later (provider resolution), which
    // is enough to prove the new guard did not reject it.
    await expect(
      runRunCommand(
        "do something",
        { newWorkspace: "worktree", provider: undefined, daemonTarget },
        {} as never,
      ),
    ).rejects.not.toMatchObject({ code: "INVALID_OPTIONS" });
  });

  it("rejects unknown new workspace kinds", async () => {
    await expectInvalidOptions({ newWorkspace: "container" }, /Unsupported new workspace kind/);
  });

  it("rejects two workspace creation flags", async () => {
    await expectInvalidOptions(
      { newWorkspace: "local", worktree: "legacy-slug" },
      /--new-workspace and --worktree cannot be combined/,
    );
  });

  it("rejects an unknown worktree creation mode before connecting", async () => {
    await expectInvalidOptions(
      { newWorkspace: "worktree", worktreeMode: "container" },
      /Unsupported worktree mode/,
    );
  });
});

describe("a run whose agent the daemon refuses", () => {
  const refusal =
    "This session's member is claude/claude-opus-5-5. This agent would run claude/claude-sonnet-5-5. A different model needs a new session.";
  const originalWorkspaceId = process.env.PASEO_WORKSPACE_ID;
  const originalAgentId = process.env.PASEO_AGENT_ID;

  beforeEach(() => {
    delete process.env.PASEO_WORKSPACE_ID;
    delete process.env.PASEO_AGENT_ID;
  });

  afterEach(() => {
    connected.client = null;
    for (const [name, value] of [
      ["PASEO_WORKSPACE_ID", originalWorkspaceId],
      ["PASEO_AGENT_ID", originalAgentId],
    ] as const) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  /** A daemon holding `existing` workspaces whose session refuses every agent. */
  function refusingDaemon(existing: string[] = []) {
    const active = new Set(existing);
    let created = 0;
    const daemon = {
      active,
      fetchWorkspaces: vi.fn(async () => ({
        entries: [...active].map((id) => ({ id, workspaceDirectory: "/work/repo" })),
        pageInfo: { nextCursor: null },
      })),
      createWorkspace: vi.fn(async () => {
        const id = `wks_created_${++created}`;
        active.add(id);
        return {
          workspace: { id, name: "repo", workspaceDirectory: "/work/repo" },
          setupTerminalId: null,
          error: null,
          requestId: "request",
        };
      }),
      createAgent: vi.fn(async () => {
        throw new Error(refusal);
      }),
      archiveWorkspace: vi.fn(async (workspaceId: string) => {
        active.delete(workspaceId);
        return { requestId: "request", workspaceId, archivedAt: "now", error: null };
      }),
      close: vi.fn(async () => undefined),
    };
    connected.client = daemon;
    return daemon;
  }

  const run = (options: Partial<AgentRunOptions> = {}) =>
    runRunCommand(
      "reply OK",
      {
        provider: "claude/claude-sonnet-5-5",
        cwd: "/work/repo",
        background: true,
        daemonTarget,
        ...options,
      },
      {} as never,
    );

  it("leaves no workspace behind when it created one for the refused agent", async () => {
    const daemon = refusingDaemon(["wks_existing"]);

    await expect(run()).rejects.toThrow(refusal);

    expect(daemon.createWorkspace).toHaveBeenCalledTimes(1);
    expect(daemon.archiveWorkspace).toHaveBeenCalledWith("wks_created_1");
    expect([...daemon.active]).toEqual(["wks_existing"]);
  });

  it("keeps a workspace it did not create", async () => {
    const daemon = refusingDaemon(["wks_existing"]);

    await expect(run({ workspace: "wks_existing" })).rejects.toThrow(refusal);

    expect(daemon.createWorkspace).not.toHaveBeenCalled();
    expect(daemon.archiveWorkspace).not.toHaveBeenCalled();
    expect([...daemon.active]).toEqual(["wks_existing"]);
  });
});
