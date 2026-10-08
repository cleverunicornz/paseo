import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Writable } from "node:stream";
import pino from "pino";
import { expect, test } from "vitest";
import { DaemonClient } from "../test-utils/daemon-client.js";
import { createTestAgentClients } from "../test-utils/fake-agent-client.js";
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
          unacknowledgedSeqs: [...seqs].sort((a, b) => a - b),
          // Nothing was acknowledged, so nothing counts as delivered.
          deliveredThrough: Math.min(...seqs) - 1,
        },
      ],
      providerFailures: [],
      unclosedAgents: [],
    });
    const report = lines.find((line) => line.msg.startsWith("Timeline drain failed"));
    expect(report).toMatchObject({
      level: 50,
      pluginId: "recorder",
      agentId,
      epoch,
      highestUnacknowledgedSeq: Math.max(...seqs),
    });
    expect(report?.msg).toContain(
      `agent ${agentId} epoch ${epoch} seq ${[...seqs].sort((a, b) => a - b).join(", ")}`,
    );
    expect((await readEvents(directory)).filter((line) => line.startsWith("ack "))).toEqual([]);
  } finally {
    await removeDaemonFiles(daemon);
    await rm(directory, { recursive: true, force: true });
  }
}, 60_000);

const UNFINISHED_CLOSES = [
  {
    label: "rejects",
    closeSession: async () => {
      throw new Error("provider close rejected");
    },
    reason: "rejected",
  },
  {
    label: "never finishes",
    closeSession: () => new Promise<void>(() => {}),
    reason: "deadline",
  },
] as const;

for (const close of UNFINISHED_CLOSES) {
  test(`an agent whose close ${close.label} fails the drain, and what it emitted is still delivered`, async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "paseo-timeline-drain-"));
    await writeRecorderPlugin(directory, "");
    const lines: LogLine[] = [];
    const daemon = await createTestPaseoDaemon({
      daemonVersion: "0.8.0",
      logger: captureLogger(lines),
      agentClients: createTestAgentClients({ closeSession: close.closeSession }),
      sessionRuntime: { timelineDrainMs: 30_000, singleAgent: false, webBasePath: "/" },
    });
    try {
      const { agentId, seqs } = await runOneTurn(daemon, directory);

      const result = await daemon.daemon.stop();

      // The agent was never closed, so it could still add items: no clean drain.
      expect(daemon.daemon.agentManager.getAgent(agentId)).not.toBeNull();
      expect(result.timelineDrain).toEqual({
        status: "failed",
        deadlineMs: 30_000,
        failures: [],
        providerFailures: [],
        unclosedAgents: [{ agentId, reason: close.reason }],
      });
      const report = lines.find(
        (line) => line.msg.startsWith("Timeline drain failed") && line.agentId === agentId,
      );
      expect(report).toMatchObject({ level: 50, agentId, reason: close.reason });
      // Everything it emitted before the stop still reached the recorder before plugins stopped.
      const events = await readEvents(directory);
      const acked = events
        .slice(0, events.indexOf("cleanup"))
        .filter((line) => line.startsWith("ack "))
        .map((line) => Number(line.slice(4)));
      expect(acked.sort((a, b) => a - b)).toEqual([...seqs].sort((a, b) => a - b));
    } finally {
      await removeDaemonFiles(daemon);
      await rm(directory, { recursive: true, force: true });
    }
  }, 60_000);
}

/**
 * A recorder that acknowledges at once until shutdown starts its provider
 * drain. From then on each item waits for `release-ack` before acknowledging,
 * and the provider drain waits for `release-provider`.
 */
async function writeGatedRecorderPlugin(directory: string): Promise<void> {
  const file = (name: string) => JSON.stringify(path.join(directory, name));
  await writeFile(
    path.join(directory, "paseo-plugin.json"),
    JSON.stringify({ id: "recorder", requirements: { paseo: ">=0.8.0" } }),
  );
  await writeFile(
    path.join(directory, "index.server.ts"),
    `
import { appendFileSync, existsSync } from "node:fs";
const log = (line) => appendFileSync(${file("events.log")}, line + "\\n");
const timers = new Set();
const waitForFile = (name) =>
  new Promise((resolve) => {
    const timer = setInterval(() => {
      if (!existsSync(name)) return;
      clearInterval(timer);
      timers.delete(timer);
      resolve();
    }, 10);
    timers.add(timer);
  });
let draining = false;
export default function contribute(server) {
  server.on("agent.timeline_item", async (event) => {
    log("start " + event.seq);
    if (draining) await waitForFile(${file("release-ack")});
    log("ack " + event.seq);
  });
  server.registerStopReadiness({
    readiness: () => ({
      ready: false,
      timeline: { ready: false, epoch: null, emitted_through: null, acknowledged_through: null },
      wip: { ready: false },
    }),
    drain: async () => {
      draining = true;
      log("drain entered");
      await waitForFile(${file("release-provider")});
      log("drain returned");
    },
  });
  return () => {
    for (const timer of timers) clearInterval(timer);
    log("cleanup");
  };
}
`,
  );
}

/**
 * Leaves an agent live through shutdown (its close rejects) with a turn
 * waiting for permission, starts shutdown, and lets that turn finish once the
 * provider drain has begun, so the agent emits new items during the drain.
 * Returns once the recorder has started on every new item, with the provider
 * drain released and the new items still unacknowledged.
 */
async function emitDuringDrain(daemon: TestPaseoDaemon, directory: string) {
  const { agentId, epoch } = await runOneTurn(daemon, directory);
  const client = new DaemonClient({ url: `ws://127.0.0.1:${daemon.port}/ws`, appVersion: "0.8.0" });
  await client.connect();
  await client.fetchAgents({ subscribe: {} });
  await client.sendMessage(agentId, "Use your shell tool to run `sleep 30`.");
  const session = daemon.daemon.agentManager.getAgent(agentId)?.session;
  if (!session) throw new Error("agent is not live");
  await expect.poll(() => session.getPendingPermissions().length).toBe(1);
  const waiting = await client.fetchAgentTimeline(agentId, {
    projection: "canonical",
    direction: "tail",
    limit: 0,
  });
  const seqsBeforeStop = waiting.entries.flatMap((entry) => seqsIn(entry.sourceSeqRanges));
  await expect
    .poll(async () => (await readEvents(directory)).filter((line) => line.startsWith("ack ")))
    .toHaveLength(seqsBeforeStop.length);
  await client.close();
  const [permission] = session.getPendingPermissions();
  let turnCompleted!: () => void;
  const completed = new Promise<void>((resolve) => {
    turnCompleted = resolve;
  });
  const unsubscribe = session.subscribe((event) => {
    if (event.type === "turn_completed") turnCompleted();
  });

  let returned = false;
  const stopping = daemon.daemon.stop().then((result) => {
    returned = true;
    return result;
  });
  await expect.poll(async () => (await readEvents(directory)).includes("drain entered")).toBe(true);
  try {
    await session.respondToPermission(permission.id, { behavior: "allow" });
    await completed;
    await daemon.daemon.agentManager.flush();
  } finally {
    unsubscribe();
  }
  const readiness = (await (
    await fetch(`http://127.0.0.1:${daemon.port}/api/stop-readiness`)
  ).json()) as { timeline: { emitted_through: number } };
  const lastBeforeStop = Math.max(...seqsBeforeStop);
  const lateSeqs = Array.from(
    { length: readiness.timeline.emitted_through - lastBeforeStop },
    (_, index) => lastBeforeStop + 1 + index,
  );
  expect(lateSeqs.length).toBeGreaterThan(0);
  await expect
    .poll(async () => (await readEvents(directory)).filter((line) => line.startsWith("start ")))
    .toHaveLength(seqsBeforeStop.length + lateSeqs.length);
  await writeFile(path.join(directory, "release-provider"), "");
  await expect
    .poll(async () => (await readEvents(directory)).includes("drain returned"))
    .toBe(true);
  return {
    agentId,
    epoch,
    allSeqs: [...seqsBeforeStop, ...lateSeqs],
    lateSeqs,
    stopping,
    hasReturned: () => returned,
  };
}

function ackedBeforeCleanup(events: string[]): number[] {
  return events
    .slice(0, events.indexOf("cleanup"))
    .filter((line) => line.startsWith("ack "))
    .map((line) => Number(line.slice(4)))
    .sort((a, b) => a - b);
}

test("items a live agent emits during the provider drain are awaited until acknowledged before plugins stop", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "paseo-timeline-drain-"));
  await writeGatedRecorderPlugin(directory);
  const daemon = await createTestPaseoDaemon({
    daemonVersion: "0.8.0",
    agentClients: createTestAgentClients({ closeSession: UNFINISHED_CLOSES[0].closeSession }),
    sessionRuntime: { timelineDrainMs: 30_000, singleAgent: false, webBasePath: "/" },
  });
  try {
    const run = await emitDuringDrain(daemon, directory);
    // The provider drain is over but the new items are not acknowledged: shutdown keeps waiting.
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(run.hasReturned()).toBe(false);
    expect(await readEvents(directory)).not.toContain("cleanup");

    await writeFile(path.join(directory, "release-ack"), "");
    const result = await run.stopping;

    expect(ackedBeforeCleanup(await readEvents(directory))).toEqual(
      [...run.allSeqs].sort((a, b) => a - b),
    );
    expect(result.timelineDrain).toEqual({
      status: "failed",
      deadlineMs: 30_000,
      failures: [],
      providerFailures: [],
      unclosedAgents: [{ agentId: run.agentId, reason: "rejected" }],
    });
  } finally {
    await removeDaemonFiles(daemon);
    await rm(directory, { recursive: true, force: true });
  }
}, 60_000);

test("at the deadline, every item a live agent emitted during the drain and never acknowledged is listed", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "paseo-timeline-drain-"));
  await writeGatedRecorderPlugin(directory);
  const daemon = await createTestPaseoDaemon({
    daemonVersion: "0.8.0",
    agentClients: createTestAgentClients({ closeSession: UNFINISHED_CLOSES[0].closeSession }),
    sessionRuntime: { timelineDrainMs: 10_000, singleAgent: false, webBasePath: "/" },
  });
  try {
    const run = await emitDuringDrain(daemon, directory);

    const result = await run.stopping;

    expect(result.timelineDrain).toEqual({
      status: "failed",
      deadlineMs: 10_000,
      failures: [
        {
          pluginId: "recorder",
          agentId: run.agentId,
          epoch: run.epoch,
          highestUnacknowledgedSeq: Math.max(...run.lateSeqs),
          unacknowledged: run.lateSeqs.length,
          unacknowledgedSeqs: run.lateSeqs,
          deliveredThrough: Math.min(...run.lateSeqs) - 1,
        },
      ],
      providerFailures: [],
      unclosedAgents: [{ agentId: run.agentId, reason: "rejected" }],
    });
    expect(ackedBeforeCleanup(await readEvents(directory))).toEqual(
      run.allSeqs.filter((seq) => !run.lateSeqs.includes(seq)).sort((a, b) => a - b),
    );
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
      unclosedAgents: [],
    });
    expect(await readEvents(directory)).toEqual(["aborted", "cleanup"]);
  } finally {
    await removeDaemonFiles(daemon);
    await rm(directory, { recursive: true, force: true });
  }
}, 60_000);
