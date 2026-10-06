import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import type {
  PluginBeforeRequests,
  PluginLifecycleEvents,
  PluginTimelineItemEvent,
} from "@getpaseo/plugin/server";
import { PARENT_AGENT_ID_LABEL } from "@getpaseo/protocol/agent-labels";

import { createTestLogger } from "../../test-utils/test-logger.js";
import type { PluginLifecycle } from "../plugins/lifecycle/index.js";
import { AgentManager, type AgentManagerEvent } from "./agent-manager.js";
import { AGENT_STREAM_COALESCE_DEFAULT_WINDOW_MS } from "./agent-stream-coalescer.js";
import type {
  AgentCapabilityFlags,
  AgentClient,
  AgentPersistenceHandle,
  AgentProvider,
  AgentRunResult,
  AgentSession,
  AgentSessionConfig,
  AgentStreamEvent,
  AgentTimelineItem,
  ProviderCatalog,
} from "./agent-sdk-types.js";

/**
 * The `agent.timeline_item` plugin event: one event per recorded timeline row,
 * after coalescing, in seq order, carrying the agent's identity, and never in
 * the agent's way.
 */

const CAPABILITIES: AgentCapabilityFlags = {
  supportsStreaming: true,
  supportsSessionPersistence: false,
  supportsDynamicModes: false,
  supportsMcpServers: false,
  supportsReasoningStream: true,
  supportsToolInvocations: true,
};

class ScriptedSession implements AgentSession {
  readonly capabilities = CAPABILITIES;
  private readonly subscribers = new Set<(event: AgentStreamEvent) => void>();

  constructor(
    readonly provider: AgentProvider,
    readonly id: string,
    private readonly config: AgentSessionConfig,
  ) {}

  push(event: AgentStreamEvent): void {
    for (const callback of this.subscribers) callback(event);
  }

  async run(): Promise<AgentRunResult> {
    return { sessionId: this.id, finalText: "", timeline: [] };
  }
  async startTurn(): Promise<{ turnId: string }> {
    return { turnId: "turn-1" };
  }
  subscribe(callback: (event: AgentStreamEvent) => void): () => void {
    this.subscribers.add(callback);
    return () => this.subscribers.delete(callback);
  }
  async *streamHistory(): AsyncGenerator<AgentStreamEvent> {}
  async getRuntimeInfo() {
    return {
      provider: this.provider,
      sessionId: this.id,
      model: this.config.model ?? null,
      modeId: null,
    };
  }
  async getAvailableModes() {
    return [];
  }
  async getCurrentMode() {
    return null;
  }
  async setMode(): Promise<void> {}
  getPendingPermissions() {
    return [];
  }
  async respondToPermission(): Promise<void> {}
  describePersistence(): AgentPersistenceHandle {
    return { provider: this.provider, sessionId: this.id };
  }
  async interrupt(): Promise<void> {}
  async close(): Promise<void> {}
}

class ScriptedClient implements AgentClient {
  readonly capabilities = CAPABILITIES;
  session: ScriptedSession | null = null;

  constructor(readonly provider: AgentProvider) {}

  async createSession(config: AgentSessionConfig): Promise<AgentSession> {
    this.session = new ScriptedSession(this.provider, `${this.provider}-native-session`, config);
    return this.session;
  }
  async resumeSession(): Promise<AgentSession> {
    throw new Error("not used");
  }
  async fetchCatalog(): Promise<ProviderCatalog> {
    return {
      models: [{ provider: this.provider, id: "fixture-model", label: "Fixture", isDefault: true }],
      modes: [],
    };
  }
  async isAvailable(): Promise<boolean> {
    return true;
  }
}

class RecordingLifecycle implements PluginLifecycle {
  readonly timelineItems: PluginTimelineItemEvent[] = [];
  readonly names: string[] = [];
  throwOnTimelineItem = false;

  emit<Name extends keyof PluginLifecycleEvents>(
    name: Name,
    event: PluginLifecycleEvents[Name],
  ): void {
    this.names.push(name);
    if (name === "agent.timeline_item") {
      this.timelineItems.push(structuredClone(event as PluginTimelineItemEvent));
      if (this.throwOnTimelineItem) {
        throw new Error("plugin delivery failed");
      }
    }
  }

  async before<Name extends keyof PluginBeforeRequests>(
    _name: Name,
    request: PluginBeforeRequests[Name],
  ): Promise<PluginBeforeRequests[Name]> {
    return request;
  }
}

function timeline(provider: AgentProvider, item: AgentTimelineItem): AgentStreamEvent {
  return { type: "timeline", provider, turnId: "turn-1", item };
}

function shellCall(
  status: "running" | "completed",
  output: string,
): Extract<AgentTimelineItem, { type: "tool_call" }> {
  return {
    type: "tool_call",
    callId: "call-1",
    name: "shell",
    status,
    error: null,
    detail: {
      type: "shell",
      command: "ls",
      output,
      exitCode: status === "completed" ? 0 : null,
    },
  };
}

/**
 * Provider-shaped turns: Claude streams text deltas, thinking and a Bash tool
 * call; Codex streams reasoning, a command execution and an agent message.
 * Both produce bursts that the coalescer merges before rows are recorded.
 */
const FIXTURES: Record<"claude" | "codex", AgentStreamEvent[]> = {
  claude: [
    { type: "turn_started", provider: "claude", turnId: "turn-1" },
    timeline("claude", { type: "user_message", text: "list files", messageId: "u-1" }),
    timeline("claude", { type: "reasoning", text: "I should " }),
    timeline("claude", { type: "reasoning", text: "run ls." }),
    timeline("claude", shellCall("running", "")),
    timeline("claude", shellCall("running", "a.txt\n")),
    timeline("claude", shellCall("completed", "a.txt\nb.txt\n")),
    timeline("claude", { type: "assistant_message", text: "There are " }),
    timeline("claude", { type: "assistant_message", text: "two " }),
    timeline("claude", { type: "assistant_message", text: "files." }),
    { type: "turn_completed", provider: "claude", turnId: "turn-1" },
  ],
  codex: [
    { type: "turn_started", provider: "codex", turnId: "turn-1" },
    timeline("codex", { type: "user_message", text: "list files", messageId: "u-1" }),
    timeline("codex", { type: "reasoning", text: "**Listing**" }),
    timeline("codex", shellCall("running", "")),
    timeline("codex", shellCall("completed", "a.txt\nb.txt\n")),
    timeline("codex", { type: "assistant_message", text: "Two" }),
    timeline("codex", { type: "assistant_message", text: " files" }),
    timeline("codex", { type: "assistant_message", text: ": a.txt, b.txt." }),
    { type: "turn_completed", provider: "codex", turnId: "turn-1" },
  ],
};

const AGENT_ID = "00000000-0000-4000-8000-0000000000a1";
const PARENT_ID = "00000000-0000-4000-8000-0000000000a0";

function seqsUpTo(maxSeq: number): number[] {
  return Array.from({ length: maxSeq }, (_, index) => index + 1);
}

function seqsIn(ranges: ReadonlyArray<{ startSeq: number; endSeq: number }>): number[] {
  return ranges.flatMap((range) =>
    Array.from({ length: range.endSeq - range.startSeq + 1 }, (_, index) => range.startSeq + index),
  );
}

async function drain(): Promise<void> {
  for (let i = 0; i < 1_000; i++) await Promise.resolve();
}

async function startAgent(provider: AgentProvider, lifecycle: RecordingLifecycle) {
  const workdir = mkdtempSync(join(tmpdir(), "agent-timeline-hook-"));
  const client = new ScriptedClient(provider);
  const manager = new AgentManager({
    clients: { [provider]: client },
    logger: createTestLogger(),
    pluginLifecycle: lifecycle,
  });
  const events: AgentManagerEvent[] = [];
  manager.subscribe((event) => events.push(event), { replayState: false });
  await manager.createAgent({ provider, cwd: workdir, model: "fixture-model" }, AGENT_ID, {
    workspaceId: "workspace-1",
    labels: { [PARENT_AGENT_ID_LABEL]: PARENT_ID, team: "platform" },
  });
  return {
    manager,
    session: client.session!,
    events,
    workdir,
    cleanup: () => rmSync(workdir, { recursive: true, force: true }),
  };
}

function timelineStreamEvents(events: AgentManagerEvent[]) {
  return events.flatMap((event) =>
    event.type === "agent_stream" && event.event.type === "timeline" ? [event] : [],
  );
}

afterEach(() => {
  vi.useRealTimers();
});

describe("agent.timeline_item", () => {
  test.each(["claude", "codex"] as const)(
    "fires once per recorded %s timeline row, in order, after coalescing",
    async (provider) => {
      vi.useFakeTimers();
      const lifecycle = new RecordingLifecycle();
      const harness = await startAgent(provider, lifecycle);
      try {
        for (const event of FIXTURES[provider]) {
          harness.session.push(event);
          await vi.advanceTimersByTimeAsync(1);
        }
        await vi.advanceTimersByTimeAsync(AGENT_STREAM_COALESCE_DEFAULT_WINDOW_MS * 4);
        await drain();

        const streamed = timelineStreamEvents(harness.events);
        const fired = lifecycle.timelineItems;
        const fetched = harness.manager.fetchTimeline(AGENT_ID, { limit: 0 });

        // Every recorded row once: seqs 1..maxSeq with no gap or repeat.
        expect(fired.map((event) => event.seq)).toEqual(seqsUpTo(fetched.window.maxSeq));
        // Coalescing merged bursts first: fewer rows than provider timeline events.
        const providerItems = FIXTURES[provider].filter((event) => event.type === "timeline");
        expect(fired.length).toBeLessThan(providerItems.length);
        // The plugin sees what the daemon's own clients see, row for row.
        expect(
          fired.map((event) => [event.seq, event.epoch, event.timestamp, event.item, event.turnId]),
        ).toEqual(
          streamed.map((event) => [
            event.seq,
            event.epoch,
            event.timestamp,
            event.event.type === "timeline" ? event.event.item : null,
            "turn-1",
          ]),
        );
        expect(fired.every((event) => event.epoch === fetched.epoch)).toBe(true);
        // The timeline a consumer catches up from holds exactly these rows.
        const covered = fetched.rows.flatMap((row) => seqsIn(row.sourceSeqRanges));
        expect([...new Set(covered)].sort((a, b) => a - b)).toEqual(
          fired.map((event) => event.seq),
        );

        // Nothing more arrives once the stream is idle.
        await vi.advanceTimersByTimeAsync(1_000);
        expect(lifecycle.timelineItems).toHaveLength(fired.length);
      } finally {
        harness.cleanup();
      }
    },
  );

  test("carries the agent's identity", async () => {
    const lifecycle = new RecordingLifecycle();
    const harness = await startAgent("claude", lifecycle);
    try {
      harness.session.push(timeline("claude", { type: "assistant_message", text: "hello" }));
      harness.session.push({ type: "turn_completed", provider: "claude", turnId: "turn-1" });
      await drain();

      const [first] = lifecycle.timelineItems;
      expect(first).toBeDefined();
      expect(first!.agent).toEqual({
        id: AGENT_ID,
        provider: "claude",
        sessionId: "claude-native-session",
        parentAgentId: PARENT_ID,
        labels: { [PARENT_AGENT_ID_LABEL]: PARENT_ID, team: "platform" },
        workspaceId: "workspace-1",
        cwd: harness.workdir,
        model: "fixture-model",
        title: null,
      });
    } finally {
      harness.cleanup();
    }
  });

  test("a failing plugin delivery never stops the agent's stream", async () => {
    const lifecycle = new RecordingLifecycle();
    lifecycle.throwOnTimelineItem = true;
    const harness = await startAgent("codex", lifecycle);
    try {
      for (const event of FIXTURES.codex) {
        harness.session.push(event);
      }
      await new Promise((resolve) =>
        setTimeout(resolve, AGENT_STREAM_COALESCE_DEFAULT_WINDOW_MS * 4),
      );
      await drain();

      const { window } = harness.manager.fetchTimeline(AGENT_ID, { limit: 0 });
      const allSeqs = seqsUpTo(window.maxSeq);
      expect(allSeqs.length).toBeGreaterThan(0);
      expect(timelineStreamEvents(harness.events).map((event) => event.seq)).toEqual(allSeqs);
      expect(lifecycle.timelineItems.map((event) => event.seq)).toEqual(allSeqs);
      // Later lifecycle events still go out.
      expect(lifecycle.names).toContain("agent.turn_ended");
      expect(harness.manager.getAgent(AGENT_ID)?.lifecycle).toBe("idle");
    } finally {
      harness.cleanup();
    }
  });

  test("leaves agent.turn_ended's payload unchanged", async () => {
    const lifecycle = new RecordingLifecycle();
    const turnEnded: unknown[] = [];
    const emit = lifecycle.emit.bind(lifecycle);
    lifecycle.emit = (name, event) => {
      if (name === "agent.turn_ended") turnEnded.push(event);
      emit(name, event);
    };
    const harness = await startAgent("claude", lifecycle);
    try {
      harness.session.push({ type: "turn_started", provider: "claude", turnId: "turn-1" });
      harness.session.push(timeline("claude", { type: "assistant_message", text: "done" }));
      harness.session.push({ type: "turn_completed", provider: "claude", turnId: "turn-1" });
      await drain();

      expect(turnEnded).toHaveLength(1);
      expect(Object.keys(turnEnded[0] as object).sort()).toEqual([
        "agent",
        "outcome",
        "timeline",
        "turnId",
      ]);
      expect(Object.keys((turnEnded[0] as { agent: object }).agent).sort()).toEqual([
        "cwd",
        "id",
        "parentAgentId",
        "provider",
        "title",
        "workspaceId",
      ]);
    } finally {
      harness.cleanup();
    }
  });
});
