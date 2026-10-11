import { PluginHookHandlers } from "./lifecycle/index.js";
import { evaluateBundle } from "./bundle-evaluator.js";
import {
  PluginProcessRequestSchema,
  type PluginProcessMessage,
  type PluginProcessRequest,
  type PluginStopReadinessOperation,
} from "./plugin-process-protocol.js";
import type { UsageSourceRegistration } from "@getpaseo/plugin/server/usage";
import type { SettingsDefinition, PluginRpcContract } from "@getpaseo/plugin";
import type {
  PluginHandlerContext,
  PluginMcpApi,
  PluginMcpToolCall,
  PluginMcpToolResult,
  PluginServerContribution,
  PluginStopReadinessProvider,
} from "@getpaseo/plugin/server";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import type { ZodType } from "zod";
import {
  ProviderEventSchema,
  type ProviderConnection,
  type ProviderRegistration,
  ProviderStatusSchema,
} from "@getpaseo/plugin/server/provider";
import { createPaseoApi, type PaseoApi } from "@getpaseo/client";
import { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { createPluginDaemonTransportFactory } from "./daemon-transport.js";
import { createPluginClientId } from "./plugin-session-identity.js";

import { PluginSettingsStore } from "./settings/index.js";
import { readPluginProviderIcon } from "./provider-icon.js";
function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export interface PluginWorkerChannel {
  send(message: PluginProcessMessage, callback?: () => void): void;
  onMessage(handler: (message: PluginProcessRequest) => void): () => void;
  disconnect(): void;
}

export function createPluginWorker(options: {
  channel: PluginWorkerChannel;
  contribute: PluginServerContribution;
}): { shutdown(): Promise<void> } {
  const { channel, contribute } = options;
  let settingsStore: PluginSettingsStore | null = null;
  function registerSettings<Schema extends ZodType>(definition: SettingsDefinition<Schema>) {
    if (!settingsStore) throw new Error("Plugin settings storage is unavailable");
    const handlers = settingsStore.register(definition);
    register(handlers.read.contract, handlers.read.handle);
    register(handlers.write.contract, (input) =>
      handlers.write.handle(handlers.write.contract.input.parse(input)),
    );
    register(handlers.reset.contract, (input) =>
      handlers.reset.handle(handlers.reset.contract.input.parse(input)),
    );
    return handlers.settings;
  }

  type RpcHandler = (input: unknown, context: PluginHandlerContext) => unknown | Promise<unknown>;

  interface RegisteredRpc {
    contract: PluginRpcContract;
    handler: RpcHandler;
  }

  const hooks = new PluginHookHandlers(() => {
    send({ type: "hooks.changed", hooks: hooks.catalog() });
  });
  const handlers = new Map<string, RegisteredRpc>();
  const providers = new Map<string, ProviderRegistration>();
  const usageSources = new Map<string, UsageSourceRegistration>();
  const providerConnections = new Map<
    string,
    { connection: ProviderConnection; unsubscribe: () => void; closing?: Promise<void> }
  >();
  const pendingProviderConnections = new Map<string, { tombstoned: boolean }>();
  let stopReadinessProvider: PluginStopReadinessProvider | null = null;
  const activeStopOperations = new Map<string, AbortController>();
  let settingUp = false;
  let cleanup: (() => void | Promise<void>) | null = null;
  let daemonClient: DaemonClient | null = null;
  let paseo: PaseoApi | null = null;
  let stopping = false;
  function send(message: PluginProcessMessage): void {
    channel.send(message);
  }

  function sendAndWait(message: PluginProcessMessage): Promise<void> {
    return new Promise((resolve) => {
      channel.send(message, () => resolve());
    });
  }

  function jsonTransportValue<Value>(value: Value): Value {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) throw new Error("Provider value is not JSON-serializable");
    return JSON.parse(encoded) as Value;
  }

  function validateMethod(method: string): string {
    const normalized = method.trim();
    if (!/^[a-z][a-z0-9._-]*$/.test(normalized)) {
      throw new Error(`Invalid plugin RPC method: ${method}`);
    }
    if (handlers.has(normalized)) {
      throw new Error(`Duplicate plugin RPC method: ${normalized}`);
    }
    return normalized;
  }

  function register(contract: PluginRpcContract, handler: RpcHandler): void {
    if (typeof handler !== "function") {
      throw new Error(`Plugin RPC ${contract.name} must provide a handler`);
    }
    const method = validateMethod(contract.name);
    handlers.set(method, { contract: { ...contract, name: method }, handler });
  }

  function registerProvider(provider: ProviderRegistration): void {
    const id = provider.id.trim();
    if (!/^[a-z][a-z0-9._-]*$/.test(id)) {
      throw new Error(`Invalid plugin provider ID: ${provider.id}`);
    }
    if (!provider.label.trim()) throw new Error(`Plugin provider ${id} requires a label`);
    if (typeof provider.connect !== "function") {
      throw new Error(`Plugin provider ${id} must implement connect()`);
    }
    if (
      provider.getCatalogCacheKey !== undefined &&
      typeof provider.getCatalogCacheKey !== "function"
    ) {
      throw new Error(`Invalid catalogue key callback for plugin provider ${id}`);
    }
    if (provider.status !== undefined && typeof provider.status !== "function")
      throw new Error(`Invalid status callback for plugin provider ${id}`);
    if (
      provider.command !== undefined &&
      (provider.command.length === 0 ||
        provider.command.some((part) => typeof part !== "string" || !part.trim()))
    )
      throw new Error(`Invalid command for plugin provider ${id}`);
    if (providers.has(id)) throw new Error(`Duplicate plugin provider ID: ${id}`);
    providers.set(id, { ...provider, id });
  }

  function registerUsageSource(source: UsageSourceRegistration): void {
    const id = source.id.trim();
    if (
      !/^[a-z][a-z0-9._-]*$/.test(id) ||
      !source.label.trim() ||
      typeof source.fetch !== "function" ||
      typeof source.discover !== "function" ||
      !source.input ||
      typeof source.input.parseAsync !== "function"
    ) {
      throw new Error(`Invalid usage source: ${source.id}`);
    }
    if (usageSources.has(id)) throw new Error(`Duplicate usage source: ${id}`);
    usageSources.set(id, { ...source, id });
  }

  function registerStopReadiness(provider: PluginStopReadinessProvider): void {
    if (!settingUp) throw new Error("registerStopReadiness must be called during plugin setup");
    if (stopReadinessProvider) throw new Error("A stop-readiness provider is already registered");
    if (provider === null || typeof provider !== "object") {
      throw new Error("Invalid stop-readiness provider");
    }
    if (typeof provider.readiness !== "function") {
      throw new Error("Stop-readiness provider readiness must be a function");
    }
    for (const operation of ["stop", "drain"] as const) {
      if (provider[operation] !== undefined && typeof provider[operation] !== "function") {
        throw new Error(`Stop-readiness provider ${operation} must be a function`);
      }
    }
    stopReadinessProvider = provider;
  }

  function stopReadinessCapabilities() {
    return {
      readiness: typeof stopReadinessProvider?.readiness === "function",
      stop: typeof stopReadinessProvider?.stop === "function",
      drain: typeof stopReadinessProvider?.drain === "function",
    };
  }

  async function runStopReadinessOperation(
    operation: PluginStopReadinessOperation,
    signal: AbortSignal,
  ): Promise<unknown> {
    const provider = stopReadinessProvider;
    if (!provider) throw new Error("Plugin does not provide stop readiness");
    if (operation === "readiness") return jsonTransportValue(await provider.readiness());
    if (operation === "stop") {
      if (!provider.stop) throw new Error("Plugin does not provide stop");
      return jsonTransportValue(await provider.stop({ signal }));
    }
    if (!provider.drain) throw new Error("Plugin does not provide drain");
    await provider.drain({ signal });
    return null;
  }

  function handleStopReadinessMessage(
    message: Extract<PluginProcessRequest, { type: "stop_readiness" | "stop_readiness.cancel" }>,
  ): void {
    if (message.type === "stop_readiness.cancel") {
      activeStopOperations.get(message.requestId)?.abort();
      return;
    }
    const controller = new AbortController();
    activeStopOperations.set(message.requestId, controller);
    void runStopReadinessOperation(message.operation, controller.signal)
      .then(
        (output) => send({ type: "result", requestId: message.requestId, output }),
        (error) =>
          send({ type: "error", requestId: message.requestId, error: describeError(error) }),
      )
      .finally(() => activeStopOperations.delete(message.requestId));
  }

  const pendingMcpCalls = new Map<
    string,
    { resolve: (result: unknown) => void; reject: (error: Error) => void }
  >();

  // The daemon makes the call with the agent's identity; this process only ever
  // sees the backend's result.
  const mcp: PluginMcpApi = {
    callTool(call: PluginMcpToolCall): Promise<PluginMcpToolResult> {
      if (stopping) return Promise.reject(new Error("Plugin is stopping"));
      const callId = randomUUID();
      return new Promise<unknown>((resolve, reject) => {
        pendingMcpCalls.set(callId, { resolve, reject });
        send({
          type: "mcp.call_tool",
          callId,
          backend: call.backend,
          tool: call.tool,
          arguments: jsonTransportValue(call.arguments ?? {}),
          onBehalfOf: call.onBehalfOf,
          timeoutMs: call.timeoutMs ?? 60_000,
        });
      }) as Promise<PluginMcpToolResult>;
    },
  };

  function settleMcpCall(
    message: Extract<PluginProcessRequest, { type: "mcp.call_tool.result" }>,
  ): void {
    const pending = pendingMcpCalls.get(message.callId);
    if (!pending) return;
    pendingMcpCalls.delete(message.callId);
    if (message.ok) pending.resolve(message.result);
    else pending.reject(new Error(message.error));
  }

  function providerMetadata(provider: ProviderRegistration) {
    return {
      id: provider.id,
      label: provider.label,
      description: provider.description,
      iconPath: provider.icon,
      hasCatalogCacheKey: provider.getCatalogCacheKey !== undefined,
      hasStatus: provider.status !== undefined,
      command: provider.command,
    };
  }

  async function connectProvider(
    message: Extract<PluginProcessRequest, { type: "provider.connect" }>,
  ): Promise<void> {
    if (stopping) throw new Error("Plugin is stopping");
    const provider = providers.get(message.providerId);
    if (!provider) throw new Error(`Unknown plugin provider: ${message.providerId}`);
    if (
      providerConnections.has(message.connectionId) ||
      pendingProviderConnections.has(message.connectionId)
    ) {
      throw new Error(`Duplicate provider connection: ${message.connectionId}`);
    }
    const pending = { tombstoned: false };
    pendingProviderConnections.set(message.connectionId, pending);
    let connection: ProviderConnection;
    try {
      connection = await provider.connect(message.request);
    } catch (error) {
      pendingProviderConnections.delete(message.connectionId);
      if (pending.tombstoned || stopping) return;
      throw error;
    }
    pendingProviderConnections.delete(message.connectionId);
    if (pending.tombstoned || stopping) {
      await connection.close().catch(() => undefined);
      return;
    }
    let unsubscribe = () => {};
    unsubscribe = connection.onEvent((event) => {
      try {
        send({
          type: "provider.event",
          connectionId: message.connectionId,
          event: ProviderEventSchema.parse(jsonTransportValue(event)),
        });
      } catch (error) {
        providerConnections.delete(message.connectionId);
        unsubscribe();
        void connection.close().catch(() => undefined);
        send({
          type: "provider.closed",
          connectionId: message.connectionId,
          error: describeError(error),
        });
      }
    });
    providerConnections.set(message.connectionId, { connection, unsubscribe });
    send({
      type: "provider.connected",
      connectionId: message.connectionId,
      version: connection.version,
      capabilities: connection.capabilities,
    });
  }

  async function sendProviderInput(
    message: Extract<PluginProcessRequest, { type: "provider.send" }>,
  ): Promise<void> {
    if (stopping) throw new Error("Plugin is stopping");
    const current = providerConnections.get(message.connectionId);
    if (!current) throw new Error(`Unknown provider connection: ${message.connectionId}`);
    if (current.closing) throw new Error("Provider connection is closing");
    await current.connection.send(message.input);
    send({
      type: "provider.accepted",
      connectionId: message.connectionId,
      acceptanceId: message.acceptanceId,
    });
  }

  // The connection stays registered until its close has reported, so shutdown
  // waits for a close already in flight instead of disconnecting underneath it.
  async function closeProviderConnection(connectionId: string): Promise<void> {
    const current = providerConnections.get(connectionId);
    if (!current) return;
    if (current.closing) return current.closing;
    const closing = (async () => {
      current.unsubscribe();
      try {
        await current.connection.close();
        send({ type: "provider.closed", connectionId });
      } catch (error) {
        send({ type: "provider.closed", connectionId, error: describeError(error) });
      } finally {
        providerConnections.delete(connectionId);
      }
    })();
    current.closing = closing;
    return closing;
  }

  const transportFactory = createPluginDaemonTransportFactory({
    send,
    onMessage(handler) {
      return channel.onMessage(handler);
    },
  });

  async function initialize(message: Extract<PluginProcessRequest, { type: "initialize" }>) {
    daemonClient = new DaemonClient({
      url: `ipc://plugin/${encodeURIComponent(message.pluginId)}`,
      clientId: createPluginClientId(message.pluginId),
      clientType: "cli",
      appVersion: message.appVersion,
      // The runtime re-attaches a session when the daemon drops this socket.
      reconnect: { enabled: true },
      transportFactory,
    });
    paseo = createPaseoApi(daemonClient);
    await daemonClient.connect();
    settingsStore = message.settingsDirectory
      ? new PluginSettingsStore(message.settingsDirectory, (settingsId) =>
          send({ type: "settings.changed", settingsId }),
        )
      : null;
    settingUp = true;
    let contributedCleanup: unknown;
    try {
      contributedCleanup = contribute({
        handle: (contract, handler) =>
          register(contract, (input, context) => handler(contract.input.parse(input), context)),
        registerProvider,
        registerUsageSource,
        registerStopReadiness,
        mcp,
        registerSettings,
        on: hooks.on,
        before: hooks.before,
      });
    } finally {
      settingUp = false;
    }
    if (typeof contributedCleanup !== "function") {
      throw new Error("Plugin contribution must return a cleanup function");
    }
    cleanup = contributedCleanup as () => void | Promise<void>;
    const usageSourceMetadata = await Promise.all(
      [...usageSources.values()]
        .sort((a, b) => a.id.localeCompare(b.id))
        .map(async (source) => ({
          id: source.id,
          label: source.label,
          icon: source.icon
            ? await readPluginProviderIcon(message.pluginDirectory, source.icon)
            : undefined,
        })),
    );
    send({
      type: "ready",
      methods: [...handlers.keys()].sort(),
      hooks: hooks.catalog(),
      stopReadiness: stopReadinessCapabilities(),
      providers: [...providers.values()]
        .sort((left, right) => left.id.localeCompare(right.id))
        .map(providerMetadata),
      usageSources: usageSourceMetadata,
    });
  }

  async function shutdown(): Promise<void> {
    if (stopping) return;
    stopping = true;
    const releaseApi = paseo
      ?.dispose()
      .catch((error) => console.error("Plugin API cleanup failed", error));
    hooks.close();
    for (const controller of activeStopOperations.values()) controller.abort();
    for (const pending of pendingMcpCalls.values()) pending.reject(new Error("Plugin is stopping"));
    pendingMcpCalls.clear();
    for (const pending of pendingProviderConnections.values()) pending.tombstoned = true;
    const currentCleanup = cleanup;
    cleanup = null;
    try {
      await currentCleanup?.();
    } catch (error) {
      console.error("Plugin cleanup failed", error);
    }
    await Promise.all([...providerConnections.keys()].map(closeProviderConnection));
    await releaseApi;
    await daemonClient?.close().catch(() => undefined);
    await sendAndWait({ type: "paseo_close" });
    daemonClient = null;
    paseo = null;
    channel.disconnect();
  }

  function handleUsageRequest(
    message: Extract<PluginProcessRequest, { type: "usage.fetch" | "usage.discover" }>,
  ): void {
    void (async () => {
      const source = usageSources.get(message.sourceId);
      if (!source) throw new Error(`Unknown usage source: ${message.sourceId}`);
      if (message.type === "usage.discover")
        return jsonTransportValue(await source.discover(message.scope));
      const input = await source.input.parseAsync(message.input);
      return jsonTransportValue(await source.fetch(input));
    })().then(
      (output) => send({ type: "result", requestId: message.requestId, output }),
      (error) => send({ type: "error", requestId: message.requestId, error: describeError(error) }),
    );
  }

  function rejectWhileStopping(message: PluginProcessRequest): void {
    if (
      message.type === "provider.status" ||
      message.type === "provider.catalog_key" ||
      message.type === "stop_readiness" ||
      message.type === "usage.fetch" ||
      message.type === "usage.discover"
    ) {
      send({ type: "error", requestId: message.requestId, error: "Plugin is stopping" });
    } else if (message.type === "provider.connect") {
      send({
        type: "provider.connect_failed",
        connectionId: message.connectionId,
        error: "Plugin is stopping",
      });
    } else if (message.type === "provider.send") {
      send({
        type: "provider.rejected",
        connectionId: message.connectionId,
        acceptanceId: message.acceptanceId,
        error: "Plugin is stopping",
      });
    } else if (message.type === "provider.close") {
      send({ type: "provider.closed", connectionId: message.connectionId });
    }
  }

  function rejectInvalidRequest(rawMessage: unknown, error: { message: string }): void {
    const value = rawMessage as { connectionId?: unknown; acceptanceId?: unknown } | null;
    if (value && typeof value.connectionId === "string" && typeof value.acceptanceId === "string") {
      send({
        type: "provider.rejected",
        connectionId: value.connectionId,
        acceptanceId: value.acceptanceId,
        error: `Invalid provider input: ${error.message}`,
      });
      void closeProviderConnection(value.connectionId);
      return;
    }
    send({ type: "fatal", error: `Invalid plugin process request: ${error.message}` });
    void shutdown();
  }

  /**
   * Gateway call answers, and stop-readiness requests (refused while stopping).
   * Returns whether the message was one of them.
   */
  function handleSessionRuntimeMessage(
    message: PluginProcessRequest,
  ): message is Extract<
    PluginProcessRequest,
    { type: "mcp.call_tool.result" | "stop_readiness" | "stop_readiness.cancel" }
  > {
    if (message.type === "mcp.call_tool.result") {
      settleMcpCall(message);
      return true;
    }
    if (message.type !== "stop_readiness" && message.type !== "stop_readiness.cancel") return false;
    if (stopping) rejectWhileStopping(message);
    else handleStopReadinessMessage(message);
    return true;
  }

  function handleMessage(rawMessage: unknown): void {
    const parsed = PluginProcessRequestSchema.safeParse(rawMessage);
    if (!parsed.success) {
      rejectInvalidRequest(rawMessage, parsed.error);
      return;
    }
    const message = parsed.data;
    if (message.type === "initialize") {
      void initialize(message).catch(async (error) => {
        send({ type: "fatal", error: describeError(error) });
        await paseo
          ?.dispose()
          .catch((failure) => console.error("Plugin API cleanup failed", failure));
        await daemonClient?.close().catch(() => undefined);
      });
      return;
    }
    if (message.type === "shutdown") {
      void shutdown();
      return;
    }
    if (handleSessionRuntimeMessage(message)) return;
    if (stopping) {
      rejectWhileStopping(message);
      return;
    }
    if (message.type === "provider.status") {
      void (async () => {
        const provider = providers.get(message.providerId);
        if (!provider || !provider.status)
          throw new Error(`Provider has no status capability: ${message.providerId}`);
        const output = ProviderStatusSchema.parse(await provider.status(message.request));
        send({ type: "result", requestId: message.requestId, output });
      })().catch((error) =>
        send({ type: "error", requestId: message.requestId, error: describeError(error) }),
      );
      return;
    }
    if (message.type === "provider.catalog_key") {
      void (async () => {
        const provider = providers.get(message.providerId);
        if (!provider) throw new Error(`Unknown provider: ${message.providerId}`);
        const output = await provider.getCatalogCacheKey?.(message.options);
        if (output !== undefined && typeof output !== "string")
          throw new Error("Invalid catalogue key");
        send({ type: "result", requestId: message.requestId, output });
      })().catch((error) =>
        send({ type: "error", requestId: message.requestId, error: describeError(error) }),
      );
      return;
    }
    if (message.type === "usage.fetch" || message.type === "usage.discover") {
      handleUsageRequest(message);
      return;
    }
    if (message.type === "provider.connect") {
      void connectProvider(message).catch((error) => {
        if (stopping) return;
        send({
          type: "provider.connect_failed",
          connectionId: message.connectionId,
          error: describeError(error),
        });
      });
      return;
    }
    if (message.type === "provider.send") {
      void sendProviderInput(message).catch((error) => {
        if (stopping) return;
        send({
          type: "provider.rejected",
          connectionId: message.connectionId,
          acceptanceId: message.acceptanceId,
          error: describeError(error),
        });
      });
      return;
    }
    if (message.type === "provider.close") {
      void closeProviderConnection(message.connectionId);
      return;
    }
    if (message.type === "paseo_frame" || message.type === "paseo_close") return;
    if (isHookMessage(message)) {
      handleHookMessage(message);
      return;
    }
    const registered = handlers.get(message.method);
    if (!registered) {
      send({
        type: "error",
        requestId: message.requestId,
        error: `Unknown RPC method: ${message.method}`,
      });
      return;
    }
    void registered.contract.input
      .parseAsync(message.input)
      .then((input) => {
        if (!paseo) throw new Error("Plugin Paseo API is unavailable");
        return registered.handler(input, { paseo });
      })
      .then((output) => registered.contract.output.parseAsync(output))
      .then(
        (output) => send({ type: "result", requestId: message.requestId, output }),
        (error) =>
          send({ type: "error", requestId: message.requestId, error: describeError(error) }),
      );
  }
  channel.onMessage(handleMessage);

  function handleHookMessage(
    message: Extract<PluginProcessRequest, { type: "hook" | "hook.cancel" }>,
  ): void {
    if (message.type === "hook.cancel") {
      hooks.cancel(message.requestId);
      return;
    }
    if (message.type === "hook") {
      if (!paseo) {
        send({
          type: "error",
          requestId: message.requestId,
          error: "Plugin Paseo API is unavailable",
        });
        return;
      }
      void hooks.invoke(message.requestId, message.kind, message.name, message.input, paseo).then(
        (output) => {
          return send({ type: "result", requestId: message.requestId, output });
        },
        (error) => {
          return send({ type: "error", requestId: message.requestId, error: describeError(error) });
        },
      );
      return;
    }
  }

  function isHookMessage(
    message: PluginProcessRequest,
  ): message is Extract<PluginProcessRequest, { type: "hook" | "hook.cancel" }> {
    return message.type === "hook" || message.type === "hook.cancel";
  }
  return { shutdown };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let worker: ReturnType<typeof createPluginWorker> | null = null;
  const handlers = new Set<(message: PluginProcessRequest) => void>();
  const channel: PluginWorkerChannel = {
    send(message, callback) {
      if (callback) process.send?.(message, () => callback());
      else process.send?.(message);
    },
    onMessage(handler) {
      handlers.add(handler);
      return () => {
        handlers.delete(handler);
      };
    },
    disconnect() {
      process.disconnect();
    },
  };
  process.on("message", (raw) => {
    const parsed = PluginProcessRequestSchema.safeParse(raw);
    if (!worker && parsed.success && parsed.data.type === "initialize") {
      try {
        worker = createPluginWorker({ channel, contribute: evaluateBundle(parsed.data.bundle) });
      } catch (error) {
        channel.send({ type: "fatal", error: describeError(error) });
        return;
      }
    }
    if (worker) for (const handler of handlers) handler(raw as PluginProcessRequest);
  });
}
