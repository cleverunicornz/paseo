import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import { DaemonClient } from "../test-utils/daemon-client.js";
import { createTestPaseoDaemon } from "../test-utils/paseo-daemon.js";

const HANDLER_DELAY_MS = 8_000;

interface LoggedItem {
  hook: string;
  seq: number;
  epoch: string;
  type: string;
  agentId: string;
  provider: string;
  sessionId: string | null;
  labels: Record<string, string>;
}

function seqsIn(ranges: ReadonlyArray<{ startSeq: number; endSeq: number }>): number[] {
  return ranges.flatMap((range) =>
    Array.from({ length: range.endSeq - range.startSeq + 1 }, (_, index) => range.startSeq + index),
  );
}

async function loggedItems(client: DaemonClient): Promise<LoggedItem[]> {
  const logs = await client.getPluginLogs("timeline-hook");
  return logs
    .filter((entry) => entry.message.startsWith('{"hook":"agent.timeline_item"'))
    .map((entry) => JSON.parse(entry.message) as LoggedItem);
}

test.each(["claude", "codex"])(
  "a slow agent.timeline_item plugin sees every %s row in order without holding the agent back",
  async (provider) => {
    const directory = await mkdtemp(path.join(tmpdir(), "paseo-timeline-hook-"));
    const daemon = await createTestPaseoDaemon({ daemonVersion: "0.8.0" });
    const client = new DaemonClient({
      url: `ws://127.0.0.1:${daemon.port}/ws`,
      appVersion: "0.8.0",
    });
    try {
      await writeFile(
        path.join(directory, "paseo-plugin.json"),
        JSON.stringify({ id: "timeline-hook", requirements: { paseo: ">=0.8.0" } }),
      );
      await writeFile(
        path.join(directory, "index.server.ts"),
        `
export default function contribute(server) {
  server.on("agent.timeline_item", async (event) => {
    console.log(JSON.stringify({
      hook: "agent.timeline_item",
      seq: event.seq,
      epoch: event.epoch,
      type: event.item.type,
      agentId: event.agent.id,
      provider: event.agent.provider,
      sessionId: event.agent.sessionId,
      labels: event.agent.labels,
    }));
    await new Promise((resolve) => setTimeout(resolve, ${HANDLER_DELAY_MS}));
  });
  return () => {};
}
`,
      );
      await client.connect();
      await client.fetchAgents({ subscribe: {} });
      await client.patchDaemonConfig({ pluginsEnabled: true });
      await client.installDirectoryPlugin(directory);
      const agent = await client.createAgent({
        provider,
        cwd: directory,
        title: "Timeline hook",
        labels: { team: "platform" },
      });

      const startedAt = Date.now();
      await client.sendMessage(agent.id, "hello");
      const finished = await client.waitForFinish(agent.id, HANDLER_DELAY_MS);
      expect(finished.status).toBe("idle");
      expect(Date.now() - startedAt).toBeLessThan(HANDLER_DELAY_MS);

      const timeline = await client.fetchAgentTimeline(agent.id, {
        projection: "canonical",
        direction: "tail",
        limit: 0,
      });
      // Every recorded row, including chunks the timeline view merges.
      const rowSeqs = timeline.entries.flatMap((entry) => seqsIn(entry.sourceSeqRanges));
      expect(rowSeqs.length).toBeGreaterThan(0);

      await expect
        .poll(async () => (await loggedItems(client)).map((item) => item.seq), { timeout: 10_000 })
        .toEqual(rowSeqs);

      const logged = await loggedItems(client);
      for (const item of logged) {
        expect(item).toMatchObject({
          agentId: agent.id,
          provider,
          labels: { team: "platform" },
          epoch: logged[0]!.epoch,
        });
      }
      expect(logged[0]!.sessionId).toEqual(expect.any(String));
    } finally {
      await client.close();
      await daemon.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
  60_000,
);
