import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { hashDaemonPassword } from "./auth.js";
import { DaemonClient } from "./test-utils/daemon-client.js";
import { createTestPaseoDaemon, type TestPaseoDaemon } from "./test-utils/paseo-daemon.js";

const SHA = "0123456789abcdef0123456789abcdef01234567";

/**
 * A plugin whose stop-readiness parts answer whatever `answers.json` in its
 * directory says, and which records each beginStopping call.
 */
async function writeProviderPlugin(input: {
  directory: string;
  id: string;
  parts: Array<"timeline" | "wip" | "beginStopping">;
}): Promise<void> {
  const { directory, id, parts } = input;
  await writeFile(
    path.join(directory, "paseo-plugin.json"),
    JSON.stringify({ id, requirements: { paseo: ">=0.8.0" } }),
  );
  const answers = JSON.stringify(path.join(directory, "answers.json"));
  const events = JSON.stringify(path.join(directory, "events.log"));
  const methods = parts.map((part) =>
    part === "beginStopping"
      ? `beginStopping: (context) => appendFileSync(${events}, "begin " + context.stopping + "\\n"),`
      : `${part}: (context) => JSON.parse(readFileSync(${answers}, "utf8")).${part},`,
  );
  await writeFile(
    path.join(directory, "index.server.ts"),
    `
import { appendFileSync, readFileSync } from "node:fs";
export default function contribute(server) {
  server.registerStopReadiness({
    ${methods.join("\n    ")}
  });
  return () => {};
}
`,
  );
}

async function readEventsLog(directory: string): Promise<string> {
  try {
    return await readFile(path.join(directory, "events.log"), "utf8");
  } catch {
    return "";
  }
}

async function setAnswers(directory: string, answers: unknown): Promise<void> {
  await writeFile(path.join(directory, "answers.json"), JSON.stringify(answers));
}

async function getReadiness(daemon: TestPaseoDaemon, headers: Record<string, string> = {}) {
  const response = await fetch(`http://127.0.0.1:${daemon.port}/api/stop-readiness`, { headers });
  return { status: response.status, text: await response.text() };
}

describe("stop readiness", () => {
  let daemon: TestPaseoDaemon;
  let client: DaemonClient;
  const directories: string[] = [];

  async function pluginDirectory(): Promise<string> {
    const directory = await mkdtemp(path.join(tmpdir(), "paseo-stop-readiness-"));
    directories.push(directory);
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

  test("with no provider each part is not ready and says so", async () => {
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

  test("the answer carries each provider's parts and is ready only when both are", async () => {
    const directory = await pluginDirectory();
    await writeProviderPlugin({ directory, id: "harness", parts: ["timeline", "wip"] });
    const timeline = {
      ready: true,
      epoch: "epoch-1",
      emitted_through: 12,
      acknowledged_through: 12,
    };
    await setAnswers(directory, {
      timeline,
      wip: { ready: false, reason: "WIP commit not pushed yet" },
    });
    await client.patchDaemonConfig({ pluginsEnabled: true });
    await client.installDirectoryPlugin(directory);

    expect(JSON.parse((await getReadiness(daemon)).text)).toEqual({
      ready: false,
      timeline,
      wip: { ready: false, reason: "WIP commit not pushed yet" },
    });

    await setAnswers(directory, {
      timeline,
      wip: { ready: true, ref: "refs/heads/wip/agent-1", sha: SHA },
    });
    expect(JSON.parse((await getReadiness(daemon)).text)).toEqual({
      ready: true,
      timeline,
      wip: { ready: true, ref: "refs/heads/wip/agent-1", sha: SHA },
    });

    await setAnswers(directory, {
      timeline: { ...timeline, ready: false, acknowledged_through: 9, reason: "3 rows unsaved" },
      wip: { ready: true, ref: "refs/heads/wip/agent-1", sha: SHA },
    });
    expect(JSON.parse((await getReadiness(daemon)).text)).toMatchObject({
      ready: false,
      timeline: { ready: false, acknowledged_through: 9, reason: "3 rows unsaved" },
      wip: { ready: true },
    });
  });

  test("an answer that could carry a credential is refused, and reasons lose URL userinfo", async () => {
    const directory = await pluginDirectory();
    await writeProviderPlugin({ directory, id: "harness", parts: ["timeline", "wip"] });
    await setAnswers(directory, {
      timeline: {
        ready: false,
        epoch: "epoch-1",
        emitted_through: 3,
        acknowledged_through: 1,
        reason: "push to https://x-access:s3cr3t-token@git.example/repo failed",
      },
      wip: { ready: true, ref: "https://x-access:s3cr3t-token@git.example/repo", sha: SHA },
    });
    await client.patchDaemonConfig({ pluginsEnabled: true });
    await client.installDirectoryPlugin(directory);

    const { text } = await getReadiness(daemon);

    expect(text).not.toContain("s3cr3t-token");
    expect(JSON.parse(text)).toEqual({
      ready: false,
      timeline: {
        ready: false,
        epoch: "epoch-1",
        emitted_through: 3,
        acknowledged_through: 1,
        reason: "push to https://[redacted]@git.example/repo failed",
      },
      wip: { ready: false, reason: "invalid provider answer" },
    });
  });

  test("two plugins providing the same part make it not ready", async () => {
    const first = await pluginDirectory();
    const second = await pluginDirectory();
    await writeProviderPlugin({ directory: first, id: "harness-a", parts: ["wip"] });
    await writeProviderPlugin({ directory: second, id: "harness-b", parts: ["wip"] });
    await setAnswers(first, { wip: { ready: true, ref: "refs/heads/a", sha: SHA } });
    await setAnswers(second, { wip: { ready: true, ref: "refs/heads/b", sha: SHA } });
    await client.patchDaemonConfig({ pluginsEnabled: true });
    await client.installDirectoryPlugin(first);
    await client.installDirectoryPlugin(second);

    expect(JSON.parse((await getReadiness(daemon)).text).wip).toEqual({
      ready: false,
      reason: "multiple providers",
    });
  });

  test("begin-stopping refuses new turns and new agents and asks providers to start their stop work", async () => {
    const directory = await pluginDirectory();
    await writeProviderPlugin({ directory, id: "harness", parts: ["beginStopping"] });
    await client.patchDaemonConfig({ pluginsEnabled: true });
    await client.installDirectoryPlugin(directory);
    const agent = await client.createAgent({ provider: "codex", cwd: directory, title: "Stop" });

    const response = await fetch(`http://127.0.0.1:${daemon.port}/api/begin-stopping`, {
      method: "POST",
    });

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ stopping: true });
    await expect(client.sendMessage(agent.id, "one more thing")).rejects.toThrow(
      "Paseo is stopping and accepts no new turns",
    );
    await expect(
      client.createAgent({ provider: "codex", cwd: directory, title: "Another" }),
    ).rejects.toThrow("Paseo is stopping and accepts no new agents");
    await expect.poll(() => readEventsLog(directory)).toBe("begin true\n");
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
