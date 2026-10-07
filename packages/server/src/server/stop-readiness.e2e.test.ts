import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { hashDaemonPassword } from "./auth.js";
import { DaemonClient } from "./test-utils/daemon-client.js";
import { createTestPaseoDaemon, type TestPaseoDaemon } from "./test-utils/paseo-daemon.js";

const SHA = "0123456789abcdef0123456789abcdef01234567";

/**
 * A plugin whose `readiness` answers whatever `answers.json` in its directory
 * says, and which logs its `stop`/`drain` calls and its other hooks to
 * `events.log`. `extra` is spliced into its setup.
 */
async function writeProviderPlugin(input: {
  directory: string;
  id: string;
  extra?: string;
}): Promise<void> {
  const { directory, id, extra = "" } = input;
  await writeFile(
    path.join(directory, "paseo-plugin.json"),
    JSON.stringify({ id, requirements: { paseo: ">=0.8.0" } }),
  );
  const answers = JSON.stringify(path.join(directory, "answers.json"));
  const events = JSON.stringify(path.join(directory, "events.log"));
  await writeFile(
    path.join(directory, "index.server.ts"),
    `
import { appendFileSync, readFileSync } from "node:fs";
const log = (line) => appendFileSync(${events}, line + "\\n");
export default function contribute(server) {
  server.registerStopReadiness({
    readiness: () => JSON.parse(readFileSync(${answers}, "utf8")),
    stop: async ({ signal }) => {
      log("stop " + signal.aborted);
      return { ready: true, ref: "refs/heads/wip/agent", sha: "${SHA}" };
    },
    drain: async () => {
      log("drain");
    },
  });
  server.on("agent.turn_ended", (event) => log("turn_ended " + event.outcome.kind));
${extra}
  return () => {};
}
`,
  );
}

async function setAnswers(directory: string, answers: unknown): Promise<void> {
  await writeFile(path.join(directory, "answers.json"), JSON.stringify(answers));
}

async function readEventsLog(directory: string): Promise<string[]> {
  try {
    return (await readFile(path.join(directory, "events.log"), "utf8")).split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

async function stopWorkEvents(directory: string): Promise<string[]> {
  return (await readEventsLog(directory)).filter((line) => !line.startsWith("turn"));
}

async function getReadiness(daemon: TestPaseoDaemon, headers: Record<string, string> = {}) {
  const response = await fetch(`http://127.0.0.1:${daemon.port}/api/stop-readiness`, { headers });
  return { status: response.status, text: await response.text() };
}

const READY_TIMELINE = {
  ready: true,
  epoch: "epoch-1",
  emitted_through: 12,
  acknowledged_through: 12,
};
const READY_WIP = { ready: true, ref: "refs/heads/wip/agent-1", sha: SHA };

describe("stop readiness", () => {
  let daemon: TestPaseoDaemon;
  let client: DaemonClient;
  const directories: string[] = [];

  async function installProvider(id: string, extra?: string): Promise<string> {
    const directory = await mkdtemp(path.join(tmpdir(), "paseo-stop-readiness-"));
    directories.push(directory);
    await writeProviderPlugin({ directory, id, extra });
    await setAnswers(directory, { ready: true, timeline: READY_TIMELINE, wip: READY_WIP });
    await client.patchDaemonConfig({ pluginsEnabled: true });
    await client.installDirectoryPlugin(directory);
    return directory;
  }

  beforeEach(async () => {
    daemon = await createTestPaseoDaemon({ daemonVersion: "0.8.0" });
    client = new DaemonClient({ url: `ws://127.0.0.1:${daemon.port}/ws`, appVersion: "0.8.0" });
    await client.connect();
    await client.fetchAgents({ subscribe: {} });
  });

  afterEach(async () => {
    await client.close();
    await daemon.close();
    await Promise.all(
      directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
    );
  });

  test("with no provider nothing is ready and the answer says so", async () => {
    const { status, text } = await getReadiness(daemon);

    expect(status).toBe(200);
    expect(JSON.parse(text)).toEqual({
      ready: false,
      timeline: {
        ready: false,
        epoch: null,
        emitted_through: null,
        acknowledged_through: null,
        reason: "no provider",
      },
      wip: { ready: false, reason: "no provider" },
    });
  });

  test("the answer is the provider's, and ready only when both parts are", async () => {
    const directory = await installProvider("harness");

    expect(JSON.parse((await getReadiness(daemon)).text)).toEqual({
      ready: true,
      timeline: READY_TIMELINE,
      wip: READY_WIP,
    });

    // A provider that claims ready with a part not ready does not make the answer ready.
    await setAnswers(directory, {
      ready: true,
      timeline: READY_TIMELINE,
      wip: { ready: false, reason: "WIP commit not pushed yet" },
    });
    expect(JSON.parse((await getReadiness(daemon)).text)).toEqual({
      ready: false,
      timeline: READY_TIMELINE,
      wip: { ready: false, reason: "WIP commit not pushed yet" },
    });
  });

  test("an answer that could carry a credential is refused, and reasons lose URL userinfo", async () => {
    const directory = await installProvider("harness");
    await setAnswers(directory, {
      ready: false,
      timeline: READY_TIMELINE,
      wip: { ready: true, ref: "https://x-access:s3cr3t-token@git.example/repo", sha: SHA },
    });

    const refused = await getReadiness(daemon);

    expect(refused.text).not.toContain("s3cr3t-token");
    expect(JSON.parse(refused.text)).toMatchObject({
      ready: false,
      timeline: { ready: false, reason: "invalid provider answer" },
      wip: { ready: false, reason: "invalid provider answer" },
    });

    await setAnswers(directory, {
      ready: false,
      timeline: READY_TIMELINE,
      wip: { ready: false, reason: "push to https://x-access:s3cr3t-token@git.example/r failed" },
    });
    const redacted = await getReadiness(daemon);
    expect(redacted.text).not.toContain("s3cr3t-token");
    expect(JSON.parse(redacted.text).wip).toEqual({
      ready: false,
      reason: "push to https://[redacted]@git.example/r failed",
    });
  });

  test("timeline items still in flight to the provider keep the timeline not ready", async () => {
    // The provider's recorder never answers a timeline item.
    const directory = await installProvider(
      "harness",
      `  server.on("agent.timeline_item", () => new Promise(() => {}));`,
    );
    const agent = await client.createAgent({ provider: "codex", cwd: directory, title: "Busy" });
    await client.sendMessage(agent.id, "hello");
    await client.waitForFinish(agent.id, 10_000);

    expect(JSON.parse((await getReadiness(daemon)).text)).toEqual({
      ready: false,
      timeline: {
        ...READY_TIMELINE,
        ready: false,
        reason: "timeline items in flight to the provider",
      },
      wip: READY_WIP,
    });
  });

  test("two plugins registering a provider make nothing ready", async () => {
    await installProvider("harness-a");
    await installProvider("harness-b");

    expect(JSON.parse((await getReadiness(daemon)).text)).toMatchObject({
      ready: false,
      timeline: { ready: false, reason: "multiple providers" },
      wip: { ready: false, reason: "multiple providers" },
    });
  });

  test("begin-stopping stops the running turn, then calls stop and drain, and refuses new work", async () => {
    const directory = await installProvider("harness");
    const agent = await client.createAgent({ provider: "codex", cwd: directory, title: "Stop" });
    // The shell call waits for a permission answer, so the turn stays running.
    await client.sendMessage(agent.id, "Use your shell tool to run `sleep 30`.");
    await client.waitForAgentUpsert(agent.id, (snapshot) => snapshot.status === "running", 10_000);

    const response = await fetch(`http://127.0.0.1:${daemon.port}/api/begin-stopping`, {
      method: "POST",
    });

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ stopping: true });
    await expect
      .poll(() => stopWorkEvents(directory))
      .toEqual(expect.arrayContaining(["stop false", "drain"]));
    const events = await readEventsLog(directory);
    expect(events.indexOf("turn_ended canceled")).toBeGreaterThan(-1);
    expect(events.indexOf("turn_ended canceled")).toBeLessThan(events.indexOf("stop false"));
    await expect(client.sendMessage(agent.id, "one more thing")).rejects.toThrow(
      "Paseo is stopping and accepts no new turns",
    );
    await expect(
      client.createAgent({ provider: "codex", cwd: directory, title: "Another" }),
    ).rejects.toThrow("Paseo is stopping and accepts no new agents");
  });
});

test("the stop endpoints sit behind the daemon password like the rest of /api", async () => {
  const daemon = await createTestPaseoDaemon({
    daemonVersion: "0.8.0",
    auth: { password: hashDaemonPassword("secret") },
  });
  try {
    expect((await getReadiness(daemon)).status).toBe(401);
    const begin = await fetch(`http://127.0.0.1:${daemon.port}/api/begin-stopping`, {
      method: "POST",
    });
    expect(begin.status).toBe(401);

    const authorized = await getReadiness(daemon, { Authorization: "Bearer secret" });
    expect(authorized.status).toBe(200);
    expect(JSON.parse(authorized.text)).toMatchObject({ ready: false });
  } finally {
    await daemon.close();
  }
});
