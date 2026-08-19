import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { AGENT_PROVIDER_DEFINITIONS } from "@getpaseo/protocol/provider-manifest";
import { describe, expect, test } from "vitest";

import { DaemonClient } from "../../test-utils/daemon-client.js";
import { createTestPaseoDaemon } from "../../test-utils/paseo-daemon.js";
import { YEET_CODE_GATEWAY_TOKEN_ENV, YEET_CODE_GATEWAY_URL_ENV } from "./yeet-code-agent.js";

const RUN_LIVE = process.env.RUN_YEET_CODE_LIVE_E2E === "1";

describe.skipIf(!RUN_LIVE)("Yeet Code provider through an isolated Paseo daemon", () => {
  test("discovers, runs rich content, and resumes after a Paseo daemon restart", async () => {
    const url = process.env[YEET_CODE_GATEWAY_URL_ENV];
    const token = process.env[YEET_CODE_GATEWAY_TOKEN_ENV];
    if (!url || !token) {
      throw new Error(
        `${YEET_CODE_GATEWAY_URL_ENV} and ${YEET_CODE_GATEWAY_TOKEN_ENV} are required`,
      );
    }
    const providerOverrides = Object.fromEntries(
      AGENT_PROVIDER_DEFINITIONS.map((definition) => [definition.id, { enabled: false }]),
    );
    providerOverrides["yeet-code"] = {
      enabled: true,
      params: { url },
      env: { [YEET_CODE_GATEWAY_TOKEN_ENV]: token },
    };
    const paseoHomeRoot = mkdtempSync(path.join(os.tmpdir(), "paseo-yeet-code-home-"));
    const staticDir = path.join(paseoHomeRoot, "static");
    const cwd = path.join(paseoHomeRoot, "project");
    mkdirSync(staticDir, { recursive: true });
    mkdirSync(cwd, { recursive: true });
    const resourcePath = path.join(cwd, "context.txt");
    writeFileSync(resourcePath, "PASEO_EMBEDDED_RESOURCE_OK\n", { mode: 0o600 });
    const daemonOptions = {
      agentClients: {},
      providerOverrides,
      mcpEnabled: false,
      paseoHomeRoot,
      staticDir,
      cleanup: false,
    } as const;
    let daemon = await createTestPaseoDaemon(daemonOptions);
    let client = new DaemonClient({
      url: `ws://127.0.0.1:${daemon.port}/ws`,
      appVersion: "0.5.0",
    });
    try {
      await client.connect();
      await client.fetchAgents({ subscribe: { subscriptionId: "yeet-code-e2e" } });
      await client.refreshProvidersSnapshot({
        cwd,
        providers: ["yeet-code"],
      });
      const provider = (await client.getProvidersSnapshot({ cwd })).entries.find(
        (entry) => entry.provider === "yeet-code",
      );
      expect(provider).toMatchObject({
        provider: "yeet-code",
        status: "ready",
        enabled: true,
      });
      const model =
        provider?.models?.find((candidate) => candidate.isDefault) ?? provider?.models?.[0];
      expect(model).toBeDefined();

      const agent = await client.createAgent({
        provider: "yeet-code",
        cwd,
        model: model!.id,
        title: "Yeet Code live integration",
        initialPrompt:
          "Read the supplied embedded resource, then reply with exactly PASEO_YEET_CODE_DAEMON_OK.",
        attachments: [
          {
            type: "uploaded_file",
            id: "gateway-resource",
            fileName: "context.txt",
            mimeType: "text/plain",
            size: 28,
            path: resourcePath,
          },
        ],
      });
      await client.waitForAgentUpsert(agent.id, (snapshot) => snapshot.status === "idle", 180_000);
      const firstTimeline = await client.fetchAgentTimeline(agent.id, {
        direction: "tail",
        limit: 0,
        projection: "canonical",
      });
      expect(
        firstTimeline.entries
          .filter((entry) => entry.item.type === "assistant_message")
          .map((entry) => entry.item.text)
          .join(""),
      ).toContain("PASEO_YEET_CODE_DAEMON_OK");

      await client.close();
      await daemon.close();
      daemon = await createTestPaseoDaemon(daemonOptions);
      client = new DaemonClient({
        url: `ws://127.0.0.1:${daemon.port}/ws`,
        appVersion: "0.5.0",
      });
      await client.connect();
      await client.fetchAgents({ subscribe: { subscriptionId: "yeet-code-e2e-restart" } });
      await client.sendAgentMessage(
        agent.id,
        "Continue this same Gateway session and reply with exactly PASEO_YEET_CODE_RESUME_OK.",
      );
      await client.waitForAgentUpsert(agent.id, (snapshot) => snapshot.status === "idle", 180_000);
      const resumedTimeline = await client.fetchAgentTimeline(agent.id, {
        direction: "tail",
        limit: 0,
        projection: "canonical",
      });
      const assistantText = resumedTimeline.entries
        .filter((entry) => entry.item.type === "assistant_message")
        .map((entry) => entry.item.text)
        .join("");
      expect(assistantText).toContain("PASEO_YEET_CODE_DAEMON_OK");
      expect(assistantText).toContain("PASEO_YEET_CODE_RESUME_OK");
    } finally {
      await client.close().catch(() => undefined);
      await daemon.close();
      rmSync(paseoHomeRoot, { recursive: true, force: true });
    }
  }, 300_000);
});
