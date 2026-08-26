import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { homedir } from "node:os";

import {
  PROTOCOL_VERSION,
  client,
  methods,
  type ClientApp,
  type ClientConnection,
  type ClientContext,
  type ConfigOptionUpdate,
  type ContentBlock,
  type EmbeddedResource,
  type ImageContent,
  type InitializeResponse,
  type ListSessionsResponse,
  type NewSessionResponse,
  type ResourceLink,
  type ResumeSessionResponse,
  type SessionConfigOption,
  type SessionInfo,
  type SessionUpdate,
  type ToolCallContent,
  type ToolCallUpdate,
  type UpdateSessionNotification,
  type Usage,
} from "@agentclientprotocol/sdk-v2/experimental/v2";
import {
  createHttpStream,
  MemoryAcpCookieStore,
  type AcpCookieStore,
  type HttpStreamOptions,
} from "@agentclientprotocol/sdk-v2/experimental/http-client";
import type { Logger } from "pino";

import { resolveDaemonVersion } from "../../daemon-version.js";
import type {
  AgentCapabilityFlags,
  AgentClient,
  AgentCreateSessionOptions,
  AgentLaunchContext,
  AgentMode,
  AgentModelDefinition,
  AgentPermissionRequest,
  AgentPermissionResponse,
  AgentPersistenceHandle,
  AgentPromptInput,
  AgentProvider,
  AgentResumeSessionOptions,
  AgentRunOptions,
  AgentRunResult,
  AgentRuntimeInfo,
  AgentSession,
  AgentSessionConfig,
  AgentStreamEvent,
  AgentTimelineItem,
  FetchCatalogOptions,
  ImportableProviderSession,
  ImportedProviderSession,
  ImportProviderSessionContext,
  ImportProviderSessionInput,
  ListImportableSessionsOptions,
  ProviderCatalog,
  ProviderRefreshContext,
  ToolCallTimelineItem,
} from "../agent-sdk-types.js";
import { renderPromptAttachmentAsText } from "../prompt-attachments.js";
import { appendOrReplaceGrowingAssistantMessage, runProviderTurn } from "./provider-runner.js";
import {
  materializeProviderImage,
  renderProviderImageOutputAsAssistantMarkdown,
} from "./provider-image-output.js";

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const MODEL_CONFIG_ID = "model";
const TEXTUAL_MIME_TYPE = /^(?:text\/|application\/(?:json|xml|trig|yaml|x-yaml)$)/u;

export const DEFAULT_REMOTE_ACP_V2_CAPABILITIES: AgentCapabilityFlags = {
  supportsStreaming: true,
  supportsSessionPersistence: true,
  supportsSessionListing: true,
  supportsDynamicModes: false,
  supportsMcpServers: false,
  supportsReasoningStream: true,
  supportsToolInvocations: true,
};

export interface RemoteACPv2Endpoint {
  endpoint: string;
  bearerToken: string;
}

export interface RemoteACPv2ConnectionFactoryOptions extends RemoteACPv2Endpoint {
  provider: string;
  logger: Logger;
  onUpdate: (update: UpdateSessionNotification) => void;
  requestTimeoutMs?: number;
  fetch?: typeof globalThis.fetch;
  signal?: AbortSignal;
  cookieStore?: AcpCookieStore;
}

export interface OpenRemoteACPv2ConnectionResult {
  connection: ClientConnection;
  agent: ClientContext;
  initialize: InitializeResponse;
  close: () => void;
}

export type RemoteACPv2ConnectionFactory = (
  options: RemoteACPv2ConnectionFactoryOptions,
) => Promise<OpenRemoteACPv2ConnectionResult>;

export interface RemoteACPv2AgentClientOptions {
  provider: string;
  logger: Logger;
  endpoint: RemoteACPv2Endpoint;
  capabilities?: AgentCapabilityFlags;
  requestTimeoutMs?: number;
  connectionFactory?: RemoteACPv2ConnectionFactory;
  cookieStore?: AcpCookieStore;
}
interface MessageState {
  content: ContentBlock[];
}

interface RemoteToolState {
  toolCallId: string;
  name: string;
  title: string;
  kind?: string | null;
  status?: string | null;
  content: ToolCallContent[];
  rawInput?: unknown;
  rawOutput?: unknown;
}
type SelectConfigOption = Extract<SessionConfigOption, { type: "select" }>;
type TextContentBlock = Extract<ContentBlock, { type: "text" }>;
type AudioContentBlock = Extract<ContentBlock, { type: "audio" }>;
type ToolContentBlock = Extract<ToolCallContent, { type: "content" }>;
type ToolDiffBlock = Extract<ToolCallContent, { type: "diff" }>;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(
      () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    clearTimeout(timeout);
  });
}

function normalizeAcpEndpoint(endpoint: string): string {
  const url = new URL(endpoint);
  if (url.protocol === "ws:") url.protocol = "http:";
  if (url.protocol === "wss:") url.protocol = "https:";
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Remote ACP endpoint must use http, https, ws, or wss");
  }
  if (url.pathname === "/" || url.pathname === "") {
    url.pathname = "/acp";
  }
  if (url.pathname !== "/acp") {
    throw new Error("Remote ACP endpoint path must be /acp");
  }
  url.search = "";
  url.hash = "";
  return url.toString();
}

export async function openRemoteACPv2Connection(
  options: RemoteACPv2ConnectionFactoryOptions,
): Promise<OpenRemoteACPv2ConnectionResult> {
  const endpoint = normalizeAcpEndpoint(options.endpoint);
  const app: ClientApp = client({ name: "paseo" }).onNotification(
    methods.client.session.update,
    ({ params }) => options.onUpdate(params),
  );
  const streamOptions: HttpStreamOptions = {
    headers: { Authorization: `Bearer ${options.bearerToken}` },
    cookieStore: options.cookieStore ?? new MemoryAcpCookieStore(),
    ...(options.fetch ? { fetch: options.fetch } : {}),
  };
  const connection = app.connect(createHttpStream(endpoint, streamOptions));
  try {
    const initialize = await withTimeout(
      connection.agent.request(
        methods.agent.initialize,
        {
          protocolVersion: PROTOCOL_VERSION,
          info: {
            name: "paseo",
            title: "Paseo",
            version: resolveDaemonVersion(),
          },
          capabilities: {},
        },
        { cancellationSignal: options.signal },
      ),
      options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
      `${options.provider} ACP initialize`,
    );
    if (initialize.protocolVersion !== PROTOCOL_VERSION) {
      throw new Error(
        `${options.provider} negotiated ACP protocol ${initialize.protocolVersion}; expected ${PROTOCOL_VERSION}`,
      );
    }
    return {
      connection,
      agent: connection.agent,
      initialize,
      close: () => connection.close(),
    };
  } catch (error) {
    connection.close(error);
    throw error;
  }
}

function asSelectConfigOption(option: SessionConfigOption): SelectConfigOption | null {
  return option.type === "select" ? (option as SelectConfigOption) : null;
}

function flattenSelectOptions(option: SessionConfigOption): Array<{
  value: string;
  name: string;
  description?: string | null;
}> {
  const select = asSelectConfigOption(option);
  if (!select) return [];
  return select.options.flatMap((entry) => ("options" in entry ? entry.options : [entry]));
}

function findModelOption(
  options: SessionConfigOption[] | null | undefined,
): SelectConfigOption | null {
  for (const candidate of options ?? []) {
    const select = asSelectConfigOption(candidate);
    if (select && (select.category === "model" || select.configId === MODEL_CONFIG_ID)) {
      return select;
    }
  }
  return null;
}

function modelDefinitions(
  provider: string,
  options: SessionConfigOption[] | null | undefined,
): AgentModelDefinition[] {
  const modelOption = findModelOption(options);
  if (!modelOption) return [];
  return flattenSelectOptions(modelOption).map((entry) => {
    const definition: AgentModelDefinition = {
      provider,
      id: entry.value,
      label: entry.name,
    };
    if (entry.description) definition.description = entry.description;
    if (entry.value === modelOption.currentValue) definition.isDefault = true;
    return definition;
  });
}

function currentModel(options: SessionConfigOption[] | null | undefined): string | null {
  return findModelOption(options)?.currentValue ?? null;
}

function mapUsage(usage: Usage | null | undefined): AgentRunResult["usage"] {
  if (!usage) return undefined;
  return {
    inputTokens: usage.inputTokens,
    cachedInputTokens: usage.cachedReadTokens ?? undefined,
    outputTokens: usage.outputTokens,
  };
}

function mapUsageUpdate(update: Extract<SessionUpdate, { sessionUpdate: "usage_update" }>) {
  return {
    contextWindowUsedTokens: update.used,
    contextWindowMaxTokens: update.size,
    ...(update.cost?.currency === "USD" ? { totalCostUsd: update.cost.amount } : {}),
  };
}

function renderResourceLink(content: ResourceLink & { type: "resource_link" }): string {
  const label = content.title ?? content.name;
  const description = content.description ? ` — ${content.description}` : "";
  return `[${label}](${content.uri})${description}`;
}

function contentBlockText(content: ContentBlock): string {
  switch (content.type) {
    case "text":
      return (content as TextContentBlock).text;
    case "image": {
      const image = content as ImageContent & { type: "image" };
      const rendered = renderProviderImageOutputAsAssistantMarkdown(
        {
          data: image.data,
          mimeType: image.mimeType,
        },
        { materialize: materializeProviderImage },
      );
      return rendered?.type === "assistant_message" ? rendered.text : "[image]";
    }
    case "resource_link":
      return renderResourceLink(content as ResourceLink & { type: "resource_link" });
    case "resource": {
      const embedded = content as EmbeddedResource & { type: "resource" };
      if ("text" in embedded.resource) {
        return `\n\n[${embedded.resource.uri}]\n${embedded.resource.text}`;
      }
      const materialized = materializeProviderImage({
        data: embedded.resource.blob,
        mimeType: embedded.resource.mimeType ?? "application/octet-stream",
      });
      return `[embedded resource: ${embedded.resource.uri} (${embedded.resource.mimeType ?? "binary"}, ${Buffer.from(embedded.resource.blob, "base64").byteLength} bytes)](${pathToFileURL(materialized.path).href})`;
    }
    case "audio": {
      const audio = content as AudioContentBlock;
      return `[audio: ${audio.mimeType}]`;
    }
    default:
      return "";
  }
}

function renderContent(content: readonly ContentBlock[]): string {
  return content.map(contentBlockText).filter(Boolean).join("\n");
}

async function promptBlocks(prompt: AgentPromptInput): Promise<ContentBlock[]> {
  if (typeof prompt === "string") return [{ type: "text", text: prompt }];
  const output: ContentBlock[] = [];
  for (const block of prompt) {
    if (block.type === "text") {
      output.push({ type: "text", text: block.text });
      continue;
    }
    if (block.type === "image") {
      output.push({ type: "image", data: block.data, mimeType: block.mimeType });
      continue;
    }
    if (block.type === "uploaded_file") {
      const bytes = await readFile(block.path);
      const uri = pathToFileURL(block.path).href;
      if (block.mimeType.startsWith("image/")) {
        output.push({
          type: "image",
          data: bytes.toString("base64"),
          mimeType: block.mimeType,
          uri,
        });
      } else if (TEXTUAL_MIME_TYPE.test(block.mimeType)) {
        output.push({
          type: "resource",
          resource: { text: bytes.toString("utf8"), uri, mimeType: block.mimeType },
        });
      } else {
        output.push({
          type: "resource",
          resource: { blob: bytes.toString("base64"), uri, mimeType: block.mimeType },
        });
      }
      continue;
    }
    output.push({ type: "text", text: renderPromptAttachmentAsText(block) });
  }
  return output;
}

function submittedPromptText(prompt: AgentPromptInput): string {
  if (typeof prompt === "string") return prompt;
  return prompt
    .map((block) => {
      if (block.type === "text") return block.text;
      if (block.type === "image") return "[image]";
      if (block.type === "uploaded_file") return `[file: ${block.fileName}]`;
      return renderPromptAttachmentAsText(block);
    })
    .filter(Boolean)
    .join("\n");
}

function mapToolStatus(
  status: string | null | undefined,
): "running" | "completed" | "failed" | "canceled" {
  switch (status) {
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "cancelled":
      return "canceled";
    default:
      return "running";
  }
}

function renderToolContent(content: readonly ToolCallContent[]): string {
  return content
    .map((item) => {
      if (item.type === "content") {
        return contentBlockText((item as ToolContentBlock).content);
      }
      if (item.type === "diff") return JSON.stringify(item as ToolDiffBlock);
      if (item.type === "terminal") return "[terminal output]";
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function mapToolState(state: RemoteToolState): ToolCallTimelineItem {
  const status = mapToolStatus(state.status);
  const text = renderToolContent(state.content);
  const base = {
    type: "tool_call" as const,
    callId: state.toolCallId,
    name: state.name,
    detail: {
      type: "unknown" as const,
      input: state.rawInput,
      output: state.rawOutput ?? text,
    },
    metadata: {
      title: state.title,
      ...(state.kind ? { kind: state.kind } : {}),
    },
  };
  if (status === "failed") {
    return {
      ...base,
      status,
      error: state.rawOutput ?? (text || "Tool call failed"),
    };
  }
  return {
    ...base,
    status,
    error: null,
  };
}

function firstString(values: Array<string | null | undefined>, fallback: string): string {
  return values.find((value): value is string => typeof value === "string") ?? fallback;
}

function patchOptional<T>(
  previous: T | null | undefined,
  next: T | null | undefined,
): T | null | undefined {
  return next === undefined ? previous : next;
}

function patchToolContent(
  previous: ToolCallContent[] | undefined,
  next: ToolCallContent[] | null | undefined,
): ToolCallContent[] {
  if (next === undefined) return previous ?? [];
  if (next === null) return [];
  return [...next];
}

function applyToolUpdate(
  previous: RemoteToolState | undefined,
  update: ToolCallUpdate,
): RemoteToolState {
  return {
    toolCallId: update.toolCallId,
    name: firstString([update.name, previous?.name, update.title, previous?.title], "tool"),
    title: firstString([update.title, previous?.title, update.name, previous?.name], "Tool"),
    kind: patchOptional(previous?.kind, update.kind),
    status: patchOptional(previous?.status, update.status),
    content: patchToolContent(previous?.content, update.content),
    rawInput: update.rawInput === undefined ? previous?.rawInput : update.rawInput,
    rawOutput: update.rawOutput === undefined ? previous?.rawOutput : update.rawOutput,
  };
}

class RemoteACPv2AgentSession implements AgentSession {
  readonly provider: AgentProvider;
  readonly capabilities: AgentCapabilityFlags;

  private readonly config: AgentSessionConfig;
  private readonly logger: Logger;
  private readonly endpoint: RemoteACPv2Endpoint;
  private readonly requestTimeoutMs: number;
  private readonly connectionFactory: RemoteACPv2ConnectionFactory;
  private readonly cookieStore: AcpCookieStore;
  private readonly subscribers = new Set<(event: AgentStreamEvent) => void>();
  private readonly messageStates = new Map<string, MessageState>();
  private readonly toolStates = new Map<string, RemoteToolState>();
  private readonly history: AgentStreamEvent[] = [];
  private connection: OpenRemoteACPv2ConnectionResult | null = null;
  private sessionId: string | null = null;
  private configOptions: SessionConfigOption[] = [];
  private activeTurnId: string | null = null;
  private currentUsage: AgentRunResult["usage"];
  private closed = false;
  private suppressForegroundUserEcho = false;
  private threadStarted = false;
  private reconnecting: Promise<void> | null = null;

  constructor(
    config: AgentSessionConfig,
    options: {
      provider: string;
      logger: Logger;
      endpoint: RemoteACPv2Endpoint;
      capabilities: AgentCapabilityFlags;
      requestTimeoutMs: number;
      connectionFactory: RemoteACPv2ConnectionFactory;
      cookieStore: AcpCookieStore;
    },
  ) {
    this.provider = options.provider;
    this.capabilities = options.capabilities;
    this.config = { ...config, provider: options.provider };
    this.logger = options.logger.child({ module: "remote-acp-v2", provider: options.provider });
    this.endpoint = options.endpoint;
    this.requestTimeoutMs = options.requestTimeoutMs;
    this.connectionFactory = options.connectionFactory;
    this.cookieStore = options.cookieStore;
  }

  get id(): string | null {
    return this.sessionId;
  }

  async initializeNewSession(): Promise<void> {
    const connection = await this.openConnection();
    const response = await this.request(
      connection.agent.request(methods.agent.session.new, {
        cwd: this.config.cwd,
        additionalDirectories: [],
        mcpServers: [],
      }),
      "session/new",
    );
    this.applySessionState(response);
    await this.applyConfiguredModel();
  }

  async initializeResumedSession(sessionId: string, replay: boolean): Promise<void> {
    this.sessionId = sessionId;
    const connection = await this.openConnection();
    const response = await this.request(
      connection.agent.request(methods.agent.session.resume, {
        sessionId,
        cwd: this.config.cwd,
        additionalDirectories: [],
        mcpServers: [],
        ...(replay ? { replayFrom: { type: "start" as const } } : {}),
      }),
      "session/resume",
    );
    this.applySessionState(response);
  }

  run(prompt: AgentPromptInput, options?: AgentRunOptions): Promise<AgentRunResult> {
    return runProviderTurn({
      prompt,
      runOptions: options,
      startTurn: (nextPrompt, nextOptions) => this.startTurn(nextPrompt, nextOptions),
      subscribe: (callback) => this.subscribe(callback),
      getSessionId: () => this.sessionId ?? "",
      reduceFinalText: appendOrReplaceGrowingAssistantMessage,
    });
  }

  async startTurn(
    prompt: AgentPromptInput,
    options?: AgentRunOptions,
  ): Promise<{ turnId: string }> {
    if (this.closed) throw new Error(`${this.provider} session is closed`);
    if (!this.sessionId) throw new Error(`${this.provider} session is not ready`);
    if (this.activeTurnId) throw new Error(`${this.provider} session already has an active turn`);
    const connection = await this.ensureConnection();
    const turnId = randomUUID();
    this.activeTurnId = turnId;
    this.currentUsage = undefined;
    this.suppressForegroundUserEcho = true;
    this.emitThreadStarted();
    this.emit({ type: "turn_started", provider: this.provider, turnId });
    this.emit({
      type: "timeline",
      provider: this.provider,
      turnId,
      item: {
        type: "user_message",
        text: submittedPromptText(prompt),
        ...(options?.clientMessageId
          ? { messageId: options.clientMessageId, clientMessageId: options.clientMessageId }
          : {}),
      },
    });
    try {
      const content = await promptBlocks(prompt);
      await this.request(
        connection.agent.request(methods.agent.session.prompt, {
          sessionId: this.sessionId,
          prompt: content,
        }),
        "session/prompt",
      );
    } catch (error) {
      const failedTurn = this.activeTurnId;
      this.activeTurnId = null;
      this.suppressForegroundUserEcho = false;
      this.emit({
        type: "turn_failed",
        provider: this.provider,
        turnId: failedTurn ?? turnId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
    return { turnId };
  }

  subscribe(callback: (event: AgentStreamEvent) => void): () => void {
    this.subscribers.add(callback);
    return () => this.subscribers.delete(callback);
  }

  async *streamHistory(): AsyncGenerator<AgentStreamEvent> {
    for (const event of this.history) yield event;
  }

  async getRuntimeInfo(): Promise<AgentRuntimeInfo> {
    return {
      provider: this.provider,
      sessionId: this.sessionId,
      model: currentModel(this.configOptions),
      thinkingOptionId: null,
      modeId: null,
    };
  }

  async getAvailableModes(): Promise<AgentMode[]> {
    return [];
  }

  async getCurrentMode(): Promise<string | null> {
    return null;
  }

  async setMode(modeId: string): Promise<void> {
    if (modeId) throw new Error(`${this.provider} does not expose session modes`);
  }

  getPendingPermissions(): AgentPermissionRequest[] {
    return [];
  }

  async respondToPermission(_requestId: string, _response: AgentPermissionResponse): Promise<void> {
    throw new Error(`${this.provider} has no pending permission request`);
  }

  describePersistence() {
    if (!this.sessionId) return null;
    return {
      provider: this.provider,
      sessionId: this.sessionId,
      nativeHandle: this.sessionId,
      metadata: {
        cwd: this.config.cwd,
        model: currentModel(this.configOptions),
      },
    };
  }

  async interrupt(): Promise<void> {
    if (!this.sessionId || !this.activeTurnId) return;
    const connection = await this.ensureConnection();
    await connection.agent.notify(methods.agent.session.cancel, {
      sessionId: this.sessionId,
    });
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    const sessionId = this.sessionId;
    const connection = this.connection;
    this.connection = null;
    this.activeTurnId = null;
    if (sessionId && connection) {
      try {
        await this.request(
          connection.agent.request(methods.agent.session.close, { sessionId }),
          "session/close",
        );
      } catch (error) {
        this.logger.debug({ err: error, sessionId }, "Remote ACP session close failed");
      }
      connection.close();
    }
    this.subscribers.clear();
  }

  async setModel(modelId: string | null): Promise<void> {
    if (!modelId || !this.sessionId) return;
    const connection = await this.ensureConnection();
    await this.request(
      connection.agent.request(methods.agent.session.setConfigOption, {
        sessionId: this.sessionId,
        configId: MODEL_CONFIG_ID,
        type: "id",
        value: modelId,
      }),
      "session/set_config_option",
    );
  }

  async setThinkingOption(thinkingOptionId: string | null): Promise<void> {
    if (thinkingOptionId) {
      throw new Error(`${this.provider} composed models own their reasoning configuration`);
    }
  }

  async listCommands() {
    return [];
  }

  private async openConnection(): Promise<OpenRemoteACPv2ConnectionResult> {
    const connection = await this.connectionFactory({
      ...this.endpoint,
      provider: this.provider,
      logger: this.logger,
      requestTimeoutMs: this.requestTimeoutMs,
      onUpdate: (notification) => this.handleUpdate(notification),
      cookieStore: this.cookieStore,
    });
    this.connection = connection;
    void connection.connection.closed.then(() => {
      if (this.connection !== connection) return undefined;
      this.connection = null;
      if (!this.closed) void this.recoverConnection();
      return undefined;
    });
    return connection;
  }

  private async ensureConnection(): Promise<OpenRemoteACPv2ConnectionResult> {
    if (this.connection) return this.connection;
    await this.recoverConnection();
    if (!this.connection) throw new Error(`${this.provider} connection is unavailable`);
    return this.connection;
  }

  private recoverConnection(): Promise<void> {
    if (this.reconnecting) return this.reconnecting;
    this.reconnecting = (async () => {
      if (!this.sessionId || this.closed) return;
      const sessionId = this.sessionId;
      try {
        const connection = await this.openConnection();
        const response = await this.request(
          connection.agent.request(methods.agent.session.resume, {
            sessionId,
            cwd: this.config.cwd,
            additionalDirectories: [],
            mcpServers: [],
            replayFrom: { type: "start" },
          }),
          "session/resume after reconnect",
        );
        this.applySessionState(response);
      } catch (error) {
        const failedConnection = this.connection;
        this.connection = null;
        failedConnection?.close();
        const turnId = this.activeTurnId;
        this.activeTurnId = null;
        this.suppressForegroundUserEcho = false;
        this.logger.warn({ err: error, sessionId }, "Remote ACP v2 reconnect failed");
        if (turnId) {
          this.emit({
            type: "turn_failed",
            provider: this.provider,
            turnId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    })().finally(() => {
      this.reconnecting = null;
    });
    return this.reconnecting;
  }

  private request<T>(promise: Promise<T>, label: string): Promise<T> {
    return withTimeout(promise, this.requestTimeoutMs, `${this.provider} ${label}`);
  }

  private applySessionState(response: NewSessionResponse | ResumeSessionResponse): void {
    if ("sessionId" in response) this.sessionId = response.sessionId;
    this.configOptions = [...(response.configOptions ?? [])];
  }

  private async applyConfiguredModel(): Promise<void> {
    if (this.config.model) await this.setModel(this.config.model);
  }

  private handleUpdate(notification: UpdateSessionNotification): void {
    if (notification.sessionId !== this.sessionId) return;
    const update = notification.update;
    if (this.handleMessageUpdate(update) || this.handleToolUpdate(update)) return;
    switch (update.sessionUpdate) {
      case "plan_update": {
        const plan = update as Extract<SessionUpdate, { sessionUpdate: "plan_update" }>;
        this.emitTimeline({
          type: "todo",
          items: [
            {
              id: "plan",
              text: JSON.stringify(plan.plan),
              status: "in_progress",
              completed: false,
            },
          ],
        });
        return;
      }
      case "config_option_update":
        this.handleConfigOptions(
          update as Extract<SessionUpdate, { sessionUpdate: "config_option_update" }>,
        );
        return;
      case "usage_update": {
        const usage = mapUsageUpdate(
          update as Extract<SessionUpdate, { sessionUpdate: "usage_update" }>,
        );
        this.emit({
          type: "usage_updated",
          provider: this.provider,
          usage,
          ...(this.activeTurnId ? { turnId: this.activeTurnId } : {}),
        });
        return;
      }
      case "session_info_update":
      case "available_commands_update":
      case "terminal_update":
      case "terminal_output_chunk":
      case "plan_removed":
        return;
      case "state_update":
        this.handleStateUpdate(update as Extract<SessionUpdate, { sessionUpdate: "state_update" }>);
        return;
      default:
        return;
    }
  }

  private handleMessageUpdate(update: SessionUpdate): boolean {
    switch (update.sessionUpdate) {
      case "user_message_chunk": {
        const chunk = update as Extract<SessionUpdate, { sessionUpdate: "user_message_chunk" }>;
        if (!this.suppressForegroundUserEcho) {
          this.patchMessage("user_message", chunk.messageId, [chunk.content], false);
        }
        return true;
      }
      case "user_message": {
        const message = update as Extract<SessionUpdate, { sessionUpdate: "user_message" }>;
        if (!this.suppressForegroundUserEcho) {
          this.patchMessage("user_message", message.messageId, message.content, true);
        }
        return true;
      }
      case "agent_message_chunk": {
        const chunk = update as Extract<SessionUpdate, { sessionUpdate: "agent_message_chunk" }>;
        this.patchMessage("assistant_message", chunk.messageId, [chunk.content], false);
        return true;
      }
      case "agent_message": {
        const message = update as Extract<SessionUpdate, { sessionUpdate: "agent_message" }>;
        this.patchMessage("assistant_message", message.messageId, message.content, true);
        return true;
      }
      case "agent_thought_chunk": {
        const chunk = update as Extract<SessionUpdate, { sessionUpdate: "agent_thought_chunk" }>;
        this.patchMessage("reasoning", chunk.messageId, [chunk.content], false);
        return true;
      }
      case "agent_thought": {
        const thought = update as Extract<SessionUpdate, { sessionUpdate: "agent_thought" }>;
        this.patchMessage("reasoning", thought.messageId, thought.content, true);
        return true;
      }
      default:
        return false;
    }
  }

  private handleToolUpdate(update: SessionUpdate): boolean {
    if (update.sessionUpdate === "tool_call_content_chunk") {
      const chunk = update as Extract<SessionUpdate, { sessionUpdate: "tool_call_content_chunk" }>;
      const previous = this.toolStates.get(chunk.toolCallId);
      if (!previous) return true;
      const next = { ...previous, content: [...previous.content, chunk.content] };
      this.toolStates.set(chunk.toolCallId, next);
      this.emitTimeline(mapToolState(next));
      return true;
    }
    if (update.sessionUpdate !== "tool_call_update") return false;
    const toolUpdate = update as Extract<SessionUpdate, { sessionUpdate: "tool_call_update" }>;
    const next = applyToolUpdate(this.toolStates.get(toolUpdate.toolCallId), toolUpdate);
    this.toolStates.set(toolUpdate.toolCallId, next);
    this.emitTimeline(mapToolState(next));
    return true;
  }

  private patchMessage(
    type: "user_message" | "assistant_message" | "reasoning",
    messageId: string,
    content: ContentBlock[] | null | undefined,
    replace: boolean,
  ): void {
    const previous = this.messageStates.get(messageId)?.content ?? [];
    let next: ContentBlock[];
    if (content === undefined) {
      next = previous;
    } else if (content === null) {
      next = [];
    } else if (replace) {
      next = [...content];
    } else {
      next = [...previous, ...content];
    }
    this.messageStates.set(messageId, { content: next });
    const text = renderContent(next);
    if (!text) return;
    this.emitTimeline(
      type === "reasoning" ? { type: "reasoning", text } : { type, text, messageId },
    );
  }

  private handleConfigOptions(update: ConfigOptionUpdate): void {
    this.configOptions = [...update.configOptions];
    this.emit({
      type: "model_changed",
      provider: this.provider,
      runtimeInfo: {
        provider: this.provider,
        sessionId: this.sessionId,
        model: currentModel(this.configOptions),
        thinkingOptionId: null,
        modeId: null,
      },
    });
  }

  private handleStateUpdate(
    update: Extract<SessionUpdate, { sessionUpdate: "state_update" }>,
  ): void {
    if (update.state !== "idle") return;
    const turnId = this.activeTurnId;
    if (!turnId) return;
    this.activeTurnId = null;
    this.suppressForegroundUserEcho = false;
    const idle = update as Extract<
      Extract<SessionUpdate, { sessionUpdate: "state_update" }>,
      { state: "idle" }
    >;
    this.currentUsage = mapUsage(idle.usage);
    if (idle.stopReason === "cancelled") {
      this.emit({
        type: "turn_canceled",
        provider: this.provider,
        turnId,
        reason: "Canceled",
      });
    } else if (idle.stopReason === "refusal") {
      this.emit({
        type: "turn_failed",
        provider: this.provider,
        turnId,
        error: "The gateway model refused the request",
      });
    } else {
      this.emit({
        type: "turn_completed",
        provider: this.provider,
        turnId,
        usage: this.currentUsage,
      });
    }
  }

  private emitThreadStarted(): void {
    if (this.threadStarted || !this.sessionId) return;
    this.threadStarted = true;
    this.emit({ type: "thread_started", provider: this.provider, sessionId: this.sessionId });
  }

  private emitTimeline(item: AgentTimelineItem): void {
    const event: AgentStreamEvent = {
      type: "timeline",
      provider: this.provider,
      item,
      ...(this.activeTurnId ? { turnId: this.activeTurnId } : {}),
    };
    this.history.push(event);
    this.emit(event);
  }

  private emit(event: AgentStreamEvent): void {
    for (const subscriber of this.subscribers) subscriber(event);
  }
}

export class RemoteACPv2AgentClient implements AgentClient {
  readonly provider: AgentProvider;
  readonly capabilities: AgentCapabilityFlags;
  private readonly cookieStore: AcpCookieStore;

  private readonly logger: Logger;
  private readonly endpoint: RemoteACPv2Endpoint;
  private readonly requestTimeoutMs: number;
  private readonly connectionFactory: RemoteACPv2ConnectionFactory;

  constructor(options: RemoteACPv2AgentClientOptions) {
    this.provider = options.provider;
    this.capabilities = options.capabilities ?? DEFAULT_REMOTE_ACP_V2_CAPABILITIES;
    this.logger = options.logger.child({ module: "remote-acp-v2", provider: options.provider });
    this.cookieStore = options.cookieStore ?? new MemoryAcpCookieStore();
    this.endpoint = {
      endpoint: normalizeAcpEndpoint(options.endpoint.endpoint),
      bearerToken: options.endpoint.bearerToken,
    };
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.connectionFactory = options.connectionFactory ?? openRemoteACPv2Connection;
  }

  async createSession(
    config: AgentSessionConfig,
    _launchContext?: AgentLaunchContext,
    _options?: AgentCreateSessionOptions,
  ): Promise<AgentSession> {
    this.assertProvider(config);
    const session = this.createSessionInstance(config);
    await session.initializeNewSession();
    return session;
  }

  async resumeSession(
    handle: AgentPersistenceHandle,
    overrides?: Partial<AgentSessionConfig>,
    _launchContext?: AgentLaunchContext,
    options?: AgentResumeSessionOptions,
  ): Promise<AgentSession> {
    if (handle.provider !== this.provider) {
      throw new Error(`Cannot resume ${handle.provider} handle with ${this.provider}`);
    }
    const metadata = handle.metadata ?? {};
    const cwd = overrides?.cwd ?? (typeof metadata.cwd === "string" ? metadata.cwd : null);
    if (!cwd) throw new Error(`${this.provider} resume requires the original working directory`);
    const config: AgentSessionConfig = {
      provider: this.provider,
      cwd,
      ...(typeof metadata.model === "string" ? { model: metadata.model } : {}),
      ...overrides,
    };
    const session = this.createSessionInstance(config);
    await session.initializeResumedSession(
      handle.nativeHandle ?? handle.sessionId,
      options?.purpose === "history",
    );
    return session;
  }

  async fetchCatalog(
    options: FetchCatalogOptions,
    context?: ProviderRefreshContext,
  ): Promise<ProviderCatalog> {
    context?.signal.throwIfAborted();
    const connection = await this.openConnection(() => undefined, context?.signal);
    const cwd = options.scope === "global" ? homedir() : options.cwd;
    let response: NewSessionResponse | null = null;
    try {
      response = await withTimeout(
        connection.agent.request(
          methods.agent.session.new,
          {
            cwd,
            additionalDirectories: [],
            mcpServers: [],
          },
          { cancellationSignal: context?.signal },
        ),
        this.requestTimeoutMs,
        `${this.provider} session/new`,
      );
      return {
        models: modelDefinitions(this.provider, response.configOptions),
        modes: [],
        defaultModeId: null,
      };
    } finally {
      if (response) {
        await connection.agent
          .request(methods.agent.session.close, { sessionId: response.sessionId })
          .catch(() => undefined);
      }
      connection.close();
    }
  }

  async listImportableSessions(
    options: ListImportableSessionsOptions = {},
  ): Promise<ImportableProviderSession[]> {
    const connection = await this.openConnection(() => undefined);
    try {
      const sessions: SessionInfo[] = [];
      let cursor: string | null | undefined;
      do {
        const response: ListSessionsResponse = await withTimeout(
          connection.agent.request(methods.agent.session.list, {
            ...(cursor ? { cursor } : {}),
            ...(options.cwd ? { cwd: options.cwd } : {}),
          }),
          this.requestTimeoutMs,
          `${this.provider} session/list`,
        );
        sessions.push(...response.sessions);
        cursor = response.nextCursor;
      } while (cursor && sessions.length < (options.limit ?? 100));
      return sessions.slice(0, options.limit ?? sessions.length).map((session) => ({
        providerHandleId: session.sessionId,
        cwd: session.cwd,
        title: session.title ?? null,
        firstPromptPreview: null,
        lastPromptPreview: null,
        lastActivityAt: session.updatedAt ? new Date(session.updatedAt) : new Date(0),
      }));
    } finally {
      connection.close();
    }
  }

  async importSession(
    input: ImportProviderSessionInput,
    context: ImportProviderSessionContext,
  ): Promise<ImportedProviderSession> {
    const config: AgentSessionConfig = {
      ...context.storedConfig,
      ...context.config,
      provider: this.provider,
      cwd: input.cwd,
    };
    const session = this.createSessionInstance(config);
    await session.initializeResumedSession(input.providerHandleId, true);
    const timeline: ImportedProviderSession["timeline"] = [];
    for await (const event of session.streamHistory()) {
      if (event.type === "timeline")
        timeline.push({ item: event.item, timestamp: event.timestamp });
    }
    return {
      session,
      config,
      persistence: session.describePersistence()!,
      timeline,
    };
  }

  async isAvailable(signal?: AbortSignal): Promise<boolean> {
    signal?.throwIfAborted();
    try {
      const connection = await this.openConnection(() => undefined, signal);
      connection.close();
      return true;
    } catch (error) {
      signal?.throwIfAborted();
      this.logger.debug({ err: error }, "Remote ACP v2 provider is unavailable");
      return false;
    }
  }

  async getDiagnostic(): Promise<{ diagnostic: string }> {
    try {
      const connection = await this.openConnection(() => undefined);
      const implementation = connection.initialize.info;
      connection.close();
      return {
        diagnostic: `Connected to ${implementation.title ?? implementation.name} ${implementation.version} at ${this.endpoint.endpoint}`,
      };
    } catch (error) {
      return {
        diagnostic: `Connection failed for ${this.endpoint.endpoint}: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  private createSessionInstance(config: AgentSessionConfig): RemoteACPv2AgentSession {
    return new RemoteACPv2AgentSession(config, {
      provider: this.provider,
      logger: this.logger,
      endpoint: this.endpoint,
      capabilities: this.capabilities,
      requestTimeoutMs: this.requestTimeoutMs,
      connectionFactory: this.connectionFactory,
      cookieStore: this.cookieStore,
    });
  }

  private openConnection(
    onUpdate: (update: UpdateSessionNotification) => void,
    signal?: AbortSignal,
  ): Promise<OpenRemoteACPv2ConnectionResult> {
    return this.connectionFactory({
      ...this.endpoint,
      provider: this.provider,
      logger: this.logger,
      onUpdate,
      requestTimeoutMs: this.requestTimeoutMs,
      signal,
      cookieStore: this.cookieStore,
    });
  }

  private assertProvider(config: AgentSessionConfig): void {
    if (config.provider !== this.provider) {
      throw new Error(`Expected provider ${this.provider}, received ${config.provider}`);
    }
    if (config.mcpServers && Object.keys(config.mcpServers).length > 0) {
      throw new Error(`${this.provider} does not accept caller-supplied MCP servers`);
    }
  }
}

export const __remoteACPv2Internals = {
  normalizeAcpEndpoint,
  modelDefinitions,
  renderContent,
  promptBlocks,
  applyToolUpdate,
};
