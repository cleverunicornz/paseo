import { createServer, type Server } from "node:http";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, test, vi } from "vitest";

import {
  PROTOCOL_VERSION,
  agent,
  client as acpClient,
  methods,
  type AgentApp,
  type ContentBlock,
  type SessionUpdate,
} from "@agentclientprotocol/sdk-v2/experimental/v2";
import { AcpServer } from "@agentclientprotocol/sdk-v2/experimental/server";
import { createNodeHttpHandler } from "@agentclientprotocol/sdk-v2/experimental/node";

import { createTestLogger } from "../../../test-utils/test-logger.js";
import {
  RemoteACPv2AgentClient,
  type OpenRemoteACPv2ConnectionResult,
  type RemoteACPv2ConnectionFactory,
  type RemoteACPv2ConnectionFactoryOptions,
} from "./remote-acp-v2-agent.js";

const PNG_PIXEL =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=";
const PROVIDER = "yeet-code";
const MODEL = "yeetz/codex-situated-max-v1";

interface FakeGatewayState {
  prompts: ContentBlock[][];
  sessions: Map<string, SessionUpdate[]>;
  nextSession: number;
  setConfigCount: number;
}

function modelConfig() {
  return [
    {
      type: "select" as const,
      configId: "model",
      name: "Model",
      category: "model",
      currentValue: MODEL,
      options: [{ value: MODEL, name: "Situated Max" }],
    },
  ];
}

function createFakeGateway(state: FakeGatewayState): AgentApp {
  return agent({ name: "fake-yeetz-gateway" })
    .onRequest(methods.agent.initialize, ({ params }) => ({
      protocolVersion: params.protocolVersion,
      info: { name: "fake-yeetz-gateway", title: "Fake Yeetz Gateway", version: "1.0.0" },
      capabilities: {
        session: { prompt: { image: {}, embeddedContext: {} } },
      },
    }))
    .onRequest(methods.agent.session.new, () => {
      const sessionId = `acp-test-${++state.nextSession}`;
      state.sessions.set(sessionId, []);
      return { sessionId, configOptions: modelConfig() };
    })
    .onRequest(methods.agent.session.list, () => ({
      sessions: Array.from(state.sessions.keys(), (sessionId) => ({
        sessionId,
        cwd: "/tmp/project",
        title: `Session ${sessionId}`,
        updatedAt: "2026-08-19T00:00:00Z",
      })),
    }))
    .onRequest(methods.agent.session.resume, async ({ params, client: remoteClient }) => {
      const history = state.sessions.get(params.sessionId);
      if (!history) throw new Error("session not found");
      if (params.replayFrom?.type === "start") {
        for (const update of history) {
          await remoteClient.notify(methods.client.session.update, {
            sessionId: params.sessionId,
            update,
          });
        }
      }
      return { configOptions: modelConfig() };
    })
    .onRequest(methods.agent.session.setConfigOption, () => {
      state.setConfigCount += 1;
      return {};
    })
    .onRequest(methods.agent.session.close, () => ({}))
    .onNotification(methods.agent.session.cancel, () => undefined)
    .onRequest(methods.agent.session.prompt, async ({ params, client: remoteClient }) => {
      state.prompts.push(params.prompt);
      const updates: SessionUpdate[] = [
        {
          sessionUpdate: "user_message",
          messageId: `user-${state.prompts.length}`,
          content: params.prompt,
        },
        { sessionUpdate: "state_update", state: "running" },
        {
          sessionUpdate: "agent_thought",
          messageId: `thought-${state.prompts.length}`,
          content: [{ type: "text", text: "Checked the execution contract." }],
        },
        {
          sessionUpdate: "tool_call_update",
          toolCallId: `tool-${state.prompts.length}`,
          name: "history_epochs",
          title: "Read historical epochs",
          kind: "read",
          status: "completed",
          rawInput: { limit: 2 },
          rawOutput: { epochs: 2 },
          content: [{ type: "content", content: { type: "text", text: "Found two epochs" } }],
        },
        {
          sessionUpdate: "agent_message",
          messageId: `agent-${state.prompts.length}`,
          content: [
            { type: "text", text: "YEET_CODE_REMOTE_OK" },
            { type: "image", data: PNG_PIXEL, mimeType: "image/png" },
            {
              type: "resource",
              resource: {
                uri: "memory://epoch.txt",
                mimeType: "text/plain",
                text: "retained context",
              },
            },
            {
              type: "resource",
              resource: {
                uri: "memory://proof.bin",
                mimeType: "application/octet-stream",
                blob: Buffer.from("proof").toString("base64"),
              },
            },
          ],
        },
        {
          sessionUpdate: "state_update",
          state: "idle",
          stopReason: "end_turn",
          usage: {
            totalTokens: 120,
            inputTokens: 100,
            outputTokens: 20,
            cachedReadTokens: 64,
          },
        },
      ];
      state.sessions.get(params.sessionId)?.push(...updates);
      for (const update of updates) {
        await remoteClient.notify(methods.client.session.update, {
          sessionId: params.sessionId,
          update,
        });
      }
      return {};
    });
}

function directConnectionFactory(agentApp: AgentApp): RemoteACPv2ConnectionFactory {
  return async (options: RemoteACPv2ConnectionFactoryOptions) => {
    const app = acpClient({ name: "paseo-test" }).onNotification(
      methods.client.session.update,
      ({ params }) => options.onUpdate(params),
    );
    const connection = app.connect(agentApp);
    const initialize = await connection.agent.request(methods.agent.initialize, {
      protocolVersion: PROTOCOL_VERSION,
      info: { name: "paseo-test", version: "1.0.0" },
      capabilities: {},
    });
    return {
      connection,
      agent: connection.agent,
      initialize,
      close: () => connection.close(),
    };
  };
}

async function listen(server: Server): Promise<number> {
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
  await promise;
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("test server has no TCP address");
  return address.port;
}

async function closeServer(server: Server): Promise<void> {
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  server.close((error) => (error ? reject(error) : resolve()));
  await promise;
}

describe("RemoteACPv2AgentClient", () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    await Promise.allSettled(cleanups.splice(0).map((cleanup) => cleanup()));
  });

  test("discovers models and preserves rich prompts, tools, usage, and replay", async () => {
    const state: FakeGatewayState = {
      prompts: [],
      sessions: new Map(),
      nextSession: 0,
      setConfigCount: 0,
    };
    const gateway = createFakeGateway(state);
    const remote = new RemoteACPv2AgentClient({
      provider: PROVIDER,
      logger: createTestLogger(),
      endpoint: { endpoint: "http://gateway.test/acp", bearerToken: "test-token" },
      connectionFactory: directConnectionFactory(gateway),
    });

    const catalog = await remote.fetchCatalog({
      scope: "workspace",
      cwd: "/tmp/project",
      force: true,
    });
    expect(catalog.models).toEqual([
      expect.objectContaining({ id: MODEL, label: "Situated Max", isDefault: true }),
    ]);

    const temp = await mkdtemp(join(tmpdir(), "paseo-remote-acp-v2-"));
    const textPath = join(temp, "notes.txt");
    await writeFile(textPath, "attached context");
    const session = await remote.createSession({
      provider: PROVIDER,
      cwd: "/tmp/project",
      model: MODEL,
    });
    const result = await session.run([
      { type: "text", text: "Inspect this" },
      { type: "image", data: PNG_PIXEL, mimeType: "image/png" },
      {
        type: "uploaded_file",
        id: "upload-1",
        fileName: "notes.txt",
        mimeType: "text/plain",
        size: 16,
        path: textPath,
      },
    ]);

    expect(state.prompts[0]).toEqual([
      { type: "text", text: "Inspect this" },
      { type: "image", data: PNG_PIXEL, mimeType: "image/png" },
      {
        type: "resource",
        resource: {
          text: "attached context",
          uri: pathToFileURL(textPath).href,
          mimeType: "text/plain",
        },
      },
    ]);
    expect(result.finalText).toContain("YEET_CODE_REMOTE_OK");
    expect(result.finalText).toContain("![");
    expect(result.finalText).toContain("retained context");
    expect(result.finalText).toContain("embedded resource");
    expect(result.usage).toMatchObject({
      inputTokens: 100,
      cachedInputTokens: 64,
      outputTokens: 20,
    });
    expect(result.timeline).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "reasoning", text: "Checked the execution contract." }),
        expect.objectContaining({ type: "tool_call", name: "history_epochs", status: "completed" }),
      ]),
    );

    const persistence = session.describePersistence();
    expect(persistence?.nativeHandle).toMatch(/^acp-test-/u);
    await session.close();

    const imported = await remote.importSession(
      { providerHandleId: persistence!.nativeHandle!, cwd: "/tmp/project" },
      {
        config: { provider: PROVIDER, cwd: "/tmp/project" },
        storedConfig: { provider: PROVIDER, cwd: "/tmp/project" },
      },
    );
    expect(imported.timeline).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          item: expect.objectContaining({
            type: "user_message",
            text: expect.stringContaining("attached context"),
          }),
        }),
        expect.objectContaining({
          item: expect.objectContaining({ type: "assistant_message" }),
        }),
      ]),
    );
    expect(
      imported.timeline.find((entry) => entry.item.type === "user_message")?.item,
    ).toMatchObject({ text: expect.stringContaining("![") });
    await imported.session.close();
    expect(state.setConfigCount).toBe(1);
  });
  test("reconnects and resumes the durable ACP session after transport loss", async () => {
    const state: FakeGatewayState = {
      prompts: [],
      sessions: new Map(),
      nextSession: 0,
      setConfigCount: 0,
    };
    const gateway = createFakeGateway(state);
    const baseFactory = directConnectionFactory(gateway);
    const connections: OpenRemoteACPv2ConnectionResult[] = [];
    const connectionFactory: RemoteACPv2ConnectionFactory = async (options) => {
      const connection = await baseFactory(options);
      connections.push(connection);
      return connection;
    };
    const remote = new RemoteACPv2AgentClient({
      provider: PROVIDER,
      logger: createTestLogger(),
      endpoint: { endpoint: "http://gateway.test/acp", bearerToken: "test-token" },
      connectionFactory,
    });
    const session = await remote.createSession({ provider: PROVIDER, cwd: "/tmp/project" });
    await session.run("first turn");
    connections.at(-1)?.close();
    await vi.waitFor(() => expect(connections).toHaveLength(2));
    const result = await session.run("second turn");
    expect(result.finalText).toContain("YEET_CODE_REMOTE_OK");
    expect(state.prompts).toHaveLength(2);
    expect(session.describePersistence()?.sessionId).toBe("acp-test-1");
    await session.close();
  });

  test("uses the standard HTTP transport and sends bearer auth on every request", async () => {
    const state: FakeGatewayState = {
      prompts: [],
      sessions: new Map(),
      nextSession: 0,
      setConfigCount: 0,
    };
    const acpServer = new AcpServer({ agent: createFakeGateway(state) });
    const handler = createNodeHttpHandler(acpServer);
    const seenAuth: string[] = [];
    const server = createServer((request, response) => {
      seenAuth.push(request.headers.authorization ?? "");
      if (request.headers.authorization !== "Bearer gateway-secret") {
        response.writeHead(401).end("unauthorized");
        return;
      }
      handler(request, response);
    });
    const port = await listen(server);
    cleanups.push(async () => {
      await acpServer.close();
      await closeServer(server);
    });

    const remote = new RemoteACPv2AgentClient({
      provider: PROVIDER,
      logger: createTestLogger(),
      endpoint: {
        endpoint: `http://127.0.0.1:${port}`,
        bearerToken: "gateway-secret",
      },
    });
    expect(await remote.isAvailable()).toBe(true);
    const catalog = await remote.fetchCatalog({ scope: "global", force: true });
    expect(catalog.models.map((model) => model.id)).toEqual([MODEL]);
    expect(seenAuth.length).toBeGreaterThan(1);
    expect(new Set(seenAuth)).toEqual(new Set(["Bearer gateway-secret"]));

    const unauthorized = new RemoteACPv2AgentClient({
      provider: PROVIDER,
      logger: createTestLogger(),
      endpoint: { endpoint: `http://127.0.0.1:${port}/acp`, bearerToken: "wrong" },
      requestTimeoutMs: 1_000,
    });
    expect(await unauthorized.isAvailable()).toBe(false);
  });
});
