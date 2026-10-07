import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Writable } from "node:stream";
import pino from "pino";
import { expect, test } from "vitest";
import { DaemonClient } from "../test-utils/daemon-client.js";
import { createTestPaseoDaemon, type TestPaseoDaemon } from "../test-utils/paseo-daemon.js";

interface LogLine {
  level: number;
  msg: string;
  [key: string]: unknown;
}

function captureLogger(lines: LogLine[]) {
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      for (const line of chunk.toString().split("\n")) {
        if (line.trim()) lines.push(JSON.parse(line) as LogLine);
      }
      callback();
    },
  });
  return pino({ level: "info" }, stream);
}

function seqsIn(ranges: ReadonlyArray<{ startSeq: number; endSeq: number }>): number[] {
  return ranges.flatMap((range) =>
    Array.from({ length: range.endSeq - range.startSeq + 1 }, (_, index) => range.startSeq + index),
  );
}

/** A recorder plugin whose handler is `handlerBody`; it logs to `events.log` in its directory. */
async function writeRecorderPlugin(directory: string, handlerBody: string): Promise<void> {
  await writeFile(
    path.join(directory, "paseo-plugin.json"),
    JSON.stringify({ id: "recorder", requirements: { paseo: ">=0.8.0" } }),
  );
  await writeFile(
    path.join(directory, "index.server.ts"),
    `
import { appendFileSync } from "node:fs";
const log = (line) => appendFileSync(${JSON.stringify(path.join(directory, "events.log"))}, line + "\\n");
export default function contribute(server) {
  server.on("agent.timeline_item", async (event) => {
    log("start " + event.seq);
${handlerBody}
    log("ack " + event.seq);
  });
  return () => log("cleanup");
}
`,
  );
}

async function runOneTurn(daemon: TestPaseoDaemon, directory: string) {
  const client = new DaemonClient({ url: `ws://127.0.0.1:${daemon.port}/ws`, appVersion: "0.8.0" });
  await client.connect();
  await client.fetchAgents({ subscribe: {} });
  await client.patchDaemonConfig({ pluginsEnabled: true });
  await client.installDirectoryPlugin(directory);
  const agent = await client.createAgent({ provider: "codex", cwd: directory, title: "Drain" });
  await client.sendMessage(agent.id, "hello");
  await client.waitForFinish(agent.id, 10_000);
  const timeline = await client.fetchAgentTimeline(agent.id, {
    projection: "canonical",
    direction: "tail",
    limit: 0,
  });
  const seqs = timeline.entries.flatMap((entry) => seqsIn(entry.sourceSeqRanges));
  expect(seqs.length).toBeGreaterThan(0);
  // Every row reached the plugin before shutdown starts.
  await expect
    .poll(async () => (await readEvents(directory)).filter((line) => line.startsWith("start")))
    .toHaveLength(seqs.length);
  await client.close();
  return { agentId: agent.id, epoch: timeline.epoch, seqs };
}

async function readEvents(directory: string): Promise<string[]> {
  const text = await readFile(path.join(directory, "events.log"), "utf8").catch(() => "");
  return text.split("\n").filter(Boolean);
}

async function removeDaemonFiles(daemon: TestPaseoDaemon): Promise<void> {
  await rm(path.dirname(daemon.paseoHome), { recursive: true, force: true });
  await rm(daemon.staticDir, { recursive: true, force: true });
}

test("shutdown waits for a slow timeline recorder and stops the plugin only afterwards", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "paseo-timeline-drain-"));
  await writeRecorderPlugin(
    directory,
    "    await new Promise((resolve) => setTimeout(resolve, 3000));",
  );
  const daemon = await createTestPaseoDaemon({
    daemonVersion: "0.8.0",
    sessionRuntime: { timelineDrainMs: 30_000, singleAgent: false, webBasePath: "/" },
  });
  try {
    const { seqs } = await runOneTurn(daemon, directory);

    const result = await daemon.daemon.stop();

    const events = await readEvents(directory);
    const cleanupIndex = events.indexOf("cleanup");
    expect(cleanupIndex).toBeGreaterThan(-1);
    const acked = events.slice(0, cleanupIndex).filter((line) => line.startsWith("ack "));
    expect(acked.map((line) => Number(line.slice(4))).sort((a, b) => a - b)).toEqual(
      [...seqs].sort((a, b) => a - b),
    );
    expect(result.timelineDrain).toEqual({ status: "drained" });
  } finally {
    await removeDaemonFiles(daemon);
    await rm(directory, { recursive: true, force: true });
  }
}, 60_000);

test("shutdown re-offers items whose recorder threw, and a recovered recorder drains clean", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "paseo-timeline-drain-"));
  // Each item's first delivery throws; every later one succeeds.
  await writeRecorderPlugin(
    directory,
    `    globalThis.tried ??= new Set();
    if (!globalThis.tried.has(event.seq)) {
      globalThis.tried.add(event.seq);
      log("throw " + event.seq);
      throw new Error("recorder down");
    }`,
  );
  const daemon = await createTestPaseoDaemon({
    daemonVersion: "0.8.0",
    sessionRuntime: { timelineDrainMs: 30_000, singleAgent: false, webBasePath: "/" },
  });
  try {
    const { seqs } = await runOneTurn(daemon, directory);
    await expect
      .poll(async () => (await readEvents(directory)).filter((line) => line.startsWith("throw")))
      .toHaveLength(seqs.length);

    const result = await daemon.daemon.stop();

    const events = await readEvents(directory);
    const acked = events
      .slice(0, events.indexOf("cleanup"))
      .filter((line) => line.startsWith("ack "))
      .map((line) => Number(line.slice(4)));
    expect(acked.sort((a, b) => a - b)).toEqual([...seqs].sort((a, b) => a - b));
    expect(result.timelineDrain).toEqual({ status: "drained" });
  } finally {
    await removeDaemonFiles(daemon);
    await rm(directory, { recursive: true, force: true });
  }
}, 60_000);

test("a recorder that never answers within the deadline fails the drain and reports what was never acknowledged", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "paseo-timeline-drain-"));
  await writeRecorderPlugin(directory, "    await new Promise(() => {});");
  const lines: LogLine[] = [];
  const daemon = await createTestPaseoDaemon({
    daemonVersion: "0.8.0",
    logger: captureLogger(lines),
    sessionRuntime: { timelineDrainMs: 1_500, singleAgent: false, webBasePath: "/" },
  });
  try {
    const { agentId, epoch, seqs } = await runOneTurn(daemon, directory);
    const startedAt = Date.now();

    const result = await daemon.daemon.stop();

    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(1_400);
    expect(result.timelineDrain).toEqual({
      status: "failed",
      deadlineMs: 1_500,
      failures: [
        {
          pluginId: "recorder",
          agentId,
          epoch,
          highestUnacknowledgedSeq: Math.max(...seqs),
          unacknowledged: seqs.length,
          // Nothing was acknowledged, so nothing counts as delivered.
          deliveredThrough: Math.min(...seqs) - 1,
        },
      ],
      providerFailures: [],
    });
    const report = lines.find((line) => line.msg.startsWith("Timeline drain failed"));
    expect(report).toMatchObject({
      level: 50,
      pluginId: "recorder",
      agentId,
      epoch,
      highestUnacknowledgedSeq: Math.max(...seqs),
    });
    expect(report?.msg).toContain(`agent ${agentId} epoch ${epoch}`);
    expect((await readEvents(directory)).filter((line) => line.startsWith("ack "))).toEqual([]);
  } finally {
    await removeDaemonFiles(daemon);
    await rm(directory, { recursive: true, force: true });
  }
}, 60_000);

/** A plugin whose stop-readiness provider drains with `drainBody`; it logs to `events.log`. */
async function writeDrainProviderPlugin(directory: string, drainBody: string): Promise<void> {
  await writeFile(
    path.join(directory, "paseo-plugin.json"),
    JSON.stringify({ id: "harness", requirements: { paseo: ">=0.8.0" } }),
  );
  await writeFile(
    path.join(directory, "index.server.ts"),
    `
import { appendFileSync } from "node:fs";
const log = (line) => appendFileSync(${JSON.stringify(path.join(directory, "events.log"))}, line + "\\n");
export default function contribute(server) {
  server.registerStopReadiness({
    readiness: () => ({ ready: false, timeline: { ready: false, epoch: null, emitted_through: null, acknowledged_through: null }, wip: { ready: false } }),
    drain: async ({ signal }) => {
${drainBody}
    },
  });
  return () => log("cleanup");
}
`,
  );
}

async function installPlugin(daemon: TestPaseoDaemon, directory: string): Promise<void> {
  const client = new DaemonClient({ url: `ws://127.0.0.1:${daemon.port}/ws`, appVersion: "0.8.0" });
  await client.connect();
  await client.patchDaemonConfig({ pluginsEnabled: true });
  await client.installDirectoryPlugin(directory);
  await client.close();
}

test("shutdown waits for the stop-readiness provider's drain before stopping plugins", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "paseo-provider-drain-"));
  await writeDrainProviderPlugin(
    directory,
    `      await new Promise((resolve) => setTimeout(resolve, 2000));
      log("drained " + signal.aborted);`,
  );
  const daemon = await createTestPaseoDaemon({
    daemonVersion: "0.8.0",
    sessionRuntime: { timelineDrainMs: 30_000, singleAgent: false, webBasePath: "/" },
  });
  try {
    await installPlugin(daemon, directory);

    const result = await daemon.daemon.stop();

    expect(await readEvents(directory)).toEqual(["drained false", "cleanup"]);
    expect(result.timelineDrain).toEqual({ status: "drained" });
  } finally {
    await removeDaemonFiles(daemon);
    await rm(directory, { recursive: true, force: true });
  }
}, 60_000);

test("a provider drain unfinished at the deadline is aborted and fails the drain", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "paseo-provider-drain-"));
  await writeDrainProviderPlugin(
    directory,
    `      await new Promise((_resolve, reject) => signal.addEventListener("abort", () => {
        log("aborted");
        reject(new Error("aborted"));
      }));`,
  );
  const daemon = await createTestPaseoDaemon({
    daemonVersion: "0.8.0",
    sessionRuntime: { timelineDrainMs: 1_000, singleAgent: false, webBasePath: "/" },
  });
  try {
    await installPlugin(daemon, directory);

    const result = await daemon.daemon.stop();

    expect(result.timelineDrain).toEqual({
      status: "failed",
      deadlineMs: 1_000,
      failures: [],
      providerFailures: [{ pluginId: "harness", reason: "deadline" }],
    });
    expect(await readEvents(directory)).toEqual(["aborted", "cleanup"]);
  } finally {
    await removeDaemonFiles(daemon);
    await rm(directory, { recursive: true, force: true });
  }
}, 60_000);
