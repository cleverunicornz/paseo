import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { DaemonClient } from "./test-utils/daemon-client.js";
import { createTestPaseoDaemon, type TestPaseoDaemon } from "./test-utils/paseo-daemon.js";

describe("single-agent mode", () => {
  let daemon: TestPaseoDaemon;
  let client: DaemonClient;
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(path.join(tmpdir(), "paseo-single-agent-"));
    daemon = await createTestPaseoDaemon({
      sessionRuntime: { timelineDrainMs: 5_000, singleAgent: true, webBasePath: "/" },
    });
    client = new DaemonClient({ url: `ws://127.0.0.1:${daemon.port}/ws` });
    await client.connect();
    await client.fetchAgents({ subscribe: {} });
  });

  afterEach(async () => {
    await client.close();
    await daemon.close();
    await rm(cwd, { recursive: true, force: true });
  });

  test("advertises the mode and no fork capability", () => {
    const features = client.getLastServerInfoMessage()?.features;
    expect(features?.singleAgent).toBe(true);
    expect(features?.agentForkContext).toBe(false);
  });

  test("refuses a second agent and a fork, and still reloads the one agent", async () => {
    const agent = await client.createAgent({ provider: "codex", cwd, title: "The one" });

    await expect(client.createAgent({ provider: "codex", cwd, title: "Second" })).rejects.toThrow(
      `This Paseo runs one agent at a time and agent ${agent.id} is live`,
    );
    await expect(client.buildAgentForkContext(agent.id)).rejects.toThrow(
      "This Paseo runs one agent at a time; forking an agent is unavailable",
    );

    const refreshed = await client.refreshAgent(agent.id);
    expect(refreshed.agentId).toBe(agent.id);
    await client.sendMessage(agent.id, "still here");
    expect((await client.waitForFinish(agent.id, 10_000)).status).toBe("idle");
    expect((await client.fetchAgents()).entries.map((entry) => entry.agent.id)).toEqual([agent.id]);
  });

  test("archiving the one agent makes room for the next", async () => {
    const first = await client.createAgent({ provider: "codex", cwd, title: "First" });
    await client.archiveAgent(first.id);

    const next = await client.createAgent({ provider: "codex", cwd, title: "Next" });

    expect(next.id).not.toBe(first.id);
  });
});

test("without single-agent mode a daemon runs several agents and offers forks", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "paseo-several-agents-"));
  const daemon = await createTestPaseoDaemon();
  const client = new DaemonClient({ url: `ws://127.0.0.1:${daemon.port}/ws` });
  try {
    await client.connect();
    const features = client.getLastServerInfoMessage()?.features;
    expect(features?.singleAgent).toBeUndefined();
    expect(features?.agentForkContext).toBe(true);
    await client.createAgent({ provider: "codex", cwd, title: "One" });
    await client.createAgent({ provider: "codex", cwd, title: "Two" });
  } finally {
    await client.close();
    await daemon.close();
    await rm(cwd, { recursive: true, force: true });
  }
});
