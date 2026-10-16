import { type ChildProcessWithoutNullStreams } from "node:child_process";
import type { ProcessTerminator } from "../../../utils/tree-kill.js";
import type { ReadableStream as NodeReadableStream, WritableStream as NodeWritableStream } from "node:stream/web";
import { ClientSideConnection, type Client as ACPClient, type ClientCapabilities as ACPClientCapabilities, type CreateTerminalRequest, type InitializeResponse, type KillTerminalRequest, type LoadSessionResponse, type NewSessionResponse, type ReadTextFileRequest, type RequestPermissionRequest, type RequestPermissionResponse, type ResumeSessionResponse, type SessionConfigOption, type SessionMode, type SessionModelState, type SessionNotification, type TerminalOutputRequest, type TerminalOutputResponse, type ToolCallContent, type ToolCallLocation, type ToolCallStatus, type ToolKind, type Usage, type WaitForTerminalExitRequest, type WriteTextFileRequest, type Stream as ACPStream } from "@agentclientprotocol/sdk";
import type { Logger } from "pino";
import { type AgentCapabilityFlags, type AgentClient, type AgentCreateConfigUnattendedInput, type AgentFeature, type AgentLaunchContext, type AgentMetadata, type AgentMode, type AgentModelDefinition, type AgentPermissionRequest, type AgentPermissionResponse, type AgentPersistenceHandle, type AgentPromptInput, type AgentResumePurpose, type AgentCreateSessionOptions, type AgentResumeSessionOptions, type AgentRunOptions, type AgentRunResult, type AgentRuntimeInfo, type AgentSession, type AgentSessionConfig, type AgentSlashCommand, type AgentStreamEvent, type AgentUsage, type FetchCatalogOptions, type ProviderRefreshContext, type ImportableProviderSession, type ImportProviderSessionContext, type ImportProviderSessionInput, type ListImportableSessionsOptions, type ProviderCatalog, type ResolveAgentCreateConfigInput, type ResolveAgentCreateConfigResult } from "../agent-sdk-types.js";
import { type ProviderRuntimeSettings } from "../provider-launch-config.js";
import { type DiagnosticEntry } from "./diagnostic-utils.js";
export declare function summarizeACPRequestError(error: unknown): {
    message: string;
    code?: string;
    diagnostic?: string;
};
export declare const DEFAULT_ACP_CAPABILITIES: AgentCapabilityFlags;
export type ACPClientCapabilityMeta = Record<string, unknown>;
export declare function buildACPClientCapabilities(meta?: ACPClientCapabilityMeta, override?: ACPClientCapabilities): ACPClientCapabilities;
export declare function createLoggedNdJsonStream(output: NodeWritableStream, input: NodeReadableStream, options: {
    logger: Logger;
    provider: string;
}): ACPStream;
export type ACPExtensionCommandsParser = (method: string, params: Record<string, unknown>) => AgentSlashCommand[] | null;
/**
 * Context handed to an {@link ACPCatalogModelResolver} during `fetchCatalog`. It exposes
 * the already-derived models plus the live probe session so a resolver can refine them
 * (e.g. switch through each model to read back per-model options) without re-implementing
 * the catalog plumbing.
 */
export interface ACPCatalogModelResolverContext {
    connection: Pick<ClientSideConnection, "setSessionConfigOption" | "extMethod">;
    sessionId: string;
    models: AgentModelDefinition[];
    configOptions: SessionConfigOption[] | null | undefined;
    runRequest: <T>(request: () => Promise<T>) => Promise<T>;
    transformConfigOptions: (configOptions: SessionConfigOption[]) => SessionConfigOption[];
    logger: Logger;
    provider: string;
}
/**
 * Providers own model discovery through this hook, including extension RPCs. Without a
 * resolver, the base client derives models from the initial session response. The client
 * owns the probe lifetime and refresh deadline; resolvers return the complete model list.
 */
export type ACPCatalogModelResolver = (context: ACPCatalogModelResolverContext) => Promise<AgentModelDefinition[]>;
interface ACPAgentClientOptions {
    provider: string;
    logger: Logger;
    runtimeSettings?: ProviderRuntimeSettings;
    defaultCommand: [string, ...string[]];
    defaultModes?: AgentMode[];
    catalogModelResolver?: ACPCatalogModelResolver;
    modelTransformer?: (models: AgentModelDefinition[]) => AgentModelDefinition[];
    sessionResponseTransformer?: (response: SessionStateResponse) => SessionStateResponse;
    configOptionsTransformer?: (configOptions: SessionConfigOption[]) => SessionConfigOption[];
    configFeatureOptions?: ACPConfigFeatureOption[];
    clientCapabilities?: ACPClientCapabilities;
    clientCapabilityMeta?: ACPClientCapabilityMeta;
    modeIdTransformer?: (modeId: string) => string | null;
    toolSnapshotTransformer?: (snapshot: ACPToolSnapshot) => ACPToolSnapshot;
    providerModeWriter?: (context: ACPProviderModeWriterContext) => Promise<ACPProviderModeWriteResult>;
    beforeModeWriter?: (context: ACPProviderModeWriterContext) => Promise<ACPBeforeModeWriteResult>;
    thinkingOptionWriter?: (connection: ClientSideConnection, sessionId: string, thinkingOptionId: string) => Promise<void>;
    capabilities?: AgentCapabilityFlags;
    extensionCommandsParser?: ACPExtensionCommandsParser;
    waitForInitialCommands?: boolean;
    initialCommandsWaitTimeoutMs?: number;
    terminateProcess?: ProcessTerminator;
    now?: () => number;
}
interface ACPAgentSessionOptions {
    provider: string;
    logger: Logger;
    runtimeSettings?: ProviderRuntimeSettings;
    defaultCommand: [string, ...string[]];
    defaultModes: AgentMode[];
    modelTransformer?: (models: AgentModelDefinition[]) => AgentModelDefinition[];
    sessionResponseTransformer?: (response: SessionStateResponse) => SessionStateResponse;
    configOptionsTransformer?: (configOptions: SessionConfigOption[]) => SessionConfigOption[];
    configFeatureOptions?: ACPConfigFeatureOption[];
    clientCapabilities?: ACPClientCapabilities;
    clientCapabilityMeta?: ACPClientCapabilityMeta;
    modeIdTransformer?: (modeId: string) => string | null;
    toolSnapshotTransformer?: (snapshot: ACPToolSnapshot) => ACPToolSnapshot;
    providerModeWriter?: (context: ACPProviderModeWriterContext) => Promise<ACPProviderModeWriteResult>;
    beforeModeWriter?: (context: ACPProviderModeWriterContext) => Promise<ACPBeforeModeWriteResult>;
    thinkingOptionWriter?: (connection: ClientSideConnection, sessionId: string, thinkingOptionId: string) => Promise<void>;
    capabilities: AgentCapabilityFlags;
    extensionCommandsParser?: ACPExtensionCommandsParser;
    handle?: AgentPersistenceHandle;
    resumePurpose?: AgentResumePurpose;
    configuredModelIds?: readonly string[];
    agentId?: string;
    launchEnv?: Record<string, string>;
    waitForInitialCommands?: boolean;
    initialCommandsWaitTimeoutMs?: number;
    terminateProcess?: ProcessTerminator;
}
export interface SpawnedACPProcess {
    child: ChildProcessWithoutNullStreams;
    connection: ClientSideConnection;
    initialize: InitializeResponse;
    stderrChunks?: string[];
}
type UninitializedACPProcess = Omit<SpawnedACPProcess, "initialize"> & {
    initialize?: InitializeResponse;
};
interface ACPProcessTransport {
    child: ChildProcessWithoutNullStreams;
    connection: ClientSideConnection;
    stderrChunks: string[];
    spawnReady: Promise<void>;
    spawnError: Promise<never>;
}
export interface ACPToolSnapshot {
    toolCallId: string;
    title: string;
    kind?: ToolKind | null;
    status?: ToolCallStatus | null;
    content?: ToolCallContent[] | null;
    locations?: ToolCallLocation[] | null;
    rawInput?: unknown;
    rawOutput?: unknown;
}
export type SessionStateResponse = NewSessionResponse | LoadSessionResponse | ResumeSessionResponse;
interface TerminalExit {
    exitCode?: number | null;
    signal?: string | null;
}
export interface ConfigOptionSelector {
    id: string;
    label: string;
    description?: string;
    isDefault?: boolean;
    metadata?: AgentMetadata;
}
export interface ACPConfigFeatureOption {
    id: string;
    configId: string;
    category?: string;
    label: string;
    description?: string;
    tooltip?: string;
    icon?: string;
    emptyOptionLabel?: string;
}
export type SelectConfigOption = Extract<SessionConfigOption, {
    type: "select";
}>;
interface SelectConfigChoice {
    value: string;
    name: string;
    description?: string | null;
    group?: string;
}
type AvailableACPModel = NonNullable<SessionModelState["availableModels"]>[number];
interface ACPModeSelection {
    availableMode: AgentMode | null;
    configOption: SelectConfigOption | null;
    configChoice: SelectConfigChoice | null;
    hasAvailableModes: boolean;
}
interface ACPModelSelection {
    availableModel: AvailableACPModel | null;
    configOption: SelectConfigOption | null;
    configChoice: SelectConfigChoice | null;
    hasAvailableModels: boolean;
}
export interface ACPProviderModeWriterContext {
    connection: ClientSideConnection;
    sessionId: string;
    requestedModeId: string;
    currentModeId: string | null;
    selection: ACPModeSelection;
    configOptions: SessionConfigOption[];
    logger: Logger;
}
export interface ACPProviderModeWriteResult {
    handled: boolean;
    currentModeId?: string;
    configOptions?: SessionConfigOption[];
}
export interface ACPBeforeModeWriteResult {
    configOptions?: SessionConfigOption[];
}
export declare function mapACPUsage(usage: Usage | null | undefined): AgentUsage | undefined;
export declare function resolveACPModeSelection({ modeId, availableModes, configOptions, }: {
    modeId: string;
    availableModes: AgentMode[];
    configOptions: SessionConfigOption[] | null | undefined;
}): ACPModeSelection;
export declare function resolveACPModelSelection({ modelId, availableModels, configOptions, }: {
    modelId: string;
    availableModels: AvailableACPModel[] | null | undefined;
    configOptions: SessionConfigOption[] | null | undefined;
}): ACPModelSelection;
export declare function deriveModesFromACP(fallbackModes: AgentMode[], modeState?: {
    availableModes?: SessionMode[] | null;
    currentModeId?: string | null;
} | null, configOptions?: SessionConfigOption[] | null): {
    modes: AgentMode[];
    currentModeId: string | null;
};
export declare function deriveModelDefinitionsFromACP(provider: string, models: SessionModelState | null | undefined, configOptions?: SessionConfigOption[] | null): AgentModelDefinition[];
export declare function deriveFeaturesFromACP(configOptions: SessionConfigOption[] | null | undefined, featureOptions: ACPConfigFeatureOption[]): AgentFeature[];
declare function resolveACPCreateConfig(input: ResolveAgentCreateConfigInput): ResolveAgentCreateConfigResult;
declare function isACPCreateConfigUnattended(input: AgentCreateConfigUnattendedInput): boolean;
export declare class ACPAgentClient implements AgentClient {
    readonly provider: string;
    readonly capabilities: AgentCapabilityFlags;
    readonly resolveCreateConfig: typeof resolveACPCreateConfig;
    readonly isCreateConfigUnattended: typeof isACPCreateConfigUnattended;
    protected readonly logger: Logger;
    protected readonly runtimeSettings?: ProviderRuntimeSettings;
    protected readonly defaultCommand: [string, ...string[]];
    protected readonly defaultModes: AgentMode[];
    private readonly catalogModelResolver?;
    private readonly modelTransformer?;
    private readonly sessionResponseTransformer?;
    private readonly configOptionsTransformer?;
    private readonly configFeatureOptions;
    private readonly clientCapabilities?;
    private readonly clientCapabilityMeta?;
    private readonly modeIdTransformer?;
    private readonly toolSnapshotTransformer?;
    private readonly providerModeWriter?;
    private readonly beforeModeWriter?;
    private readonly thinkingOptionWriter?;
    private readonly waitForInitialCommands;
    private readonly initialCommandsWaitTimeoutMs;
    private readonly extensionCommandsParser?;
    private readonly importPromptCache;
    private readonly now;
    protected readonly terminateProcess: ProcessTerminator;
    constructor(options: ACPAgentClientOptions);
    createSession(config: AgentSessionConfig, launchContext?: AgentLaunchContext, options?: AgentCreateSessionOptions): Promise<AgentSession>;
    resumeSession(handle: AgentPersistenceHandle, overrides?: Partial<AgentSessionConfig>, launchContext?: AgentLaunchContext, options?: AgentResumeSessionOptions): Promise<AgentSession>;
    fetchCatalog(options: FetchCatalogOptions, context?: ProviderRefreshContext): Promise<ProviderCatalog>;
    listFeatures(config: AgentSessionConfig): Promise<AgentFeature[]>;
    listImportableSessions(options?: ListImportableSessionsOptions): Promise<ImportableProviderSession[]>;
    private describeImportableSession;
    private loadImportPromptPreviews;
    private closeLoadedSession;
    importSession(input: ImportProviderSessionInput, context: ImportProviderSessionContext): Promise<import("../agent-sdk-types.js").ImportedProviderSession>;
    isAvailable(): Promise<boolean>;
    protected spawnProcess(launchEnv?: Record<string, string>, options?: {
        initializeTimeoutMs?: number;
        providerOptions?: Record<string, unknown>;
        onSpawned?: (probe: UninitializedACPProcess) => void;
        client?: ACPClient;
    }): Promise<SpawnedACPProcess>;
    protected spawnTransport(launchEnv?: Record<string, string>, client?: ACPClient): Promise<ACPProcessTransport>;
    protected initializeTransport(transport: ACPProcessTransport, initializeTimeoutMs?: number, providerOptions?: Record<string, unknown>): Promise<InitializeResponse>;
    protected buildProbeClient(onSessionUpdate?: (params: SessionNotification) => void | Promise<void>): ACPClient;
    protected closeProbe(probe: UninitializedACPProcess, sessionId?: string | null): Promise<void>;
    protected runACPRequest<T>(request: () => Promise<T>): Promise<T>;
    protected buildACPProbeDiagnosticRows(options?: {
        cwd?: string;
        phaseTimeoutMs?: number;
    }): Promise<DiagnosticEntry[]>;
    protected resolveLaunchCommand(): Promise<{
        command: string;
        args: string[];
    }>;
    private assertProvider;
    protected transformSessionResponse(response: SessionStateResponse): SessionStateResponse;
}
export declare class ACPAgentSession implements AgentSession, ACPClient {
    readonly provider: string;
    readonly capabilities: AgentCapabilityFlags;
    private readonly logger;
    private readonly runtimeSettings?;
    private readonly defaultCommand;
    private readonly defaultModes;
    protected readonly modelTransformer?: (models: AgentModelDefinition[]) => AgentModelDefinition[];
    private readonly sessionResponseTransformer?;
    private readonly configOptionsTransformer?;
    private readonly configFeatureOptions;
    private readonly configuredModelIds;
    private readonly clientCapabilities?;
    private readonly clientCapabilityMeta?;
    private readonly modeIdTransformer?;
    private readonly toolSnapshotTransformer?;
    private readonly providerModeWriter?;
    private readonly beforeModeWriter?;
    private readonly thinkingOptionWriter?;
    private readonly agentId?;
    private readonly launchEnv?;
    private readonly subscribers;
    private readonly pendingPermissions;
    private pendingUserMessage;
    private submittedUserMessageTurnId;
    private readonly toolCalls;
    private readonly terminalEntries;
    private readonly persistedHistory;
    private readonly initialHandle?;
    private readonly resumePurpose;
    private readonly config;
    private child;
    private connection;
    private agentCapabilities;
    private sessionId;
    private readonly earlySessionUpdates;
    private currentMode;
    private availableModes;
    private currentModel;
    private availableModels;
    private thinkingOptionId;
    private currentTitle;
    private lastActivityAt;
    private configOptions;
    private cachedCommands;
    private commandsReadyDeferred;
    private commandsReadySettled;
    private waitForInitialCommands;
    private initialCommandsWaitTimeoutMs;
    private readonly extensionCommandsParser?;
    private currentTurnUsage;
    private activeForegroundTurnId;
    private fallbackAssistantMessageId;
    private closed;
    private historyPending;
    private replayingHistory;
    private bootstrapThreadEventPending;
    private readonly terminateProcess;
    constructor(config: AgentSessionConfig, options: ACPAgentSessionOptions);
    get id(): string | null;
    initializeNewSession(): Promise<void>;
    /**
     * IMPORTANT: Some ACP providers (e.g., Devin CLI) require all three params
     * (sessionId, cwd, mcpServers) to be present in session/load or
     * unstable_resumeSession — even when mcpServers is an empty array — and
     * return "Invalid params" if any are omitted. Never drop cwd or mcpServers
     * from these calls regardless of capabilities.
     */
    initializeResumedSession(): Promise<void>;
    private closeAfterInitializationFailure;
    run(prompt: AgentPromptInput, options?: AgentRunOptions): Promise<AgentRunResult>;
    startTurn(prompt: AgentPromptInput, options?: AgentRunOptions): Promise<{
        turnId: string;
    }>;
    subscribe(callback: (event: AgentStreamEvent) => void): () => void;
    streamHistory(): AsyncGenerator<AgentStreamEvent>;
    getRuntimeInfo(): Promise<AgentRuntimeInfo>;
    getAvailableModes(): Promise<AgentMode[]>;
    getCurrentMode(): Promise<string | null>;
    get features(): AgentFeature[];
    private ensureCommandsReadyDeferred;
    private settleCommandsReady;
    private waitForCommandsReady;
    listCommands(): Promise<AgentSlashCommand[]>;
    setMode(modeId: string): Promise<void>;
    private setModeWithSelection;
    private createProviderModeWriterContext;
    setModel(modelId: string | null): Promise<void>;
    private resolveModelSelection;
    private setModelWithSelection;
    setThinkingOption(thinkingOptionId: string | null): Promise<void>;
    setFeature(featureId: string, value: unknown): Promise<void>;
    private applyConfigOptionResponse;
    getPendingPermissions(): AgentPermissionRequest[];
    respondToPermission(requestId: string, response: AgentPermissionResponse): Promise<void>;
    describePersistence(): AgentPersistenceHandle | null;
    interrupt(): Promise<void>;
    close(): Promise<void>;
    requestPermission(params: RequestPermissionRequest): Promise<RequestPermissionResponse>;
    sessionUpdate(params: SessionNotification): Promise<void>;
    private deliverTranslatedEvents;
    extNotification(method: string, params: Record<string, unknown>): Promise<void>;
    private applyResolvedCommands;
    readTextFile(params: ReadTextFileRequest): Promise<{
        content: string;
    }>;
    writeTextFile(params: WriteTextFileRequest): Promise<Record<string, never>>;
    createTerminal(params: CreateTerminalRequest): Promise<{
        terminalId: string;
    }>;
    terminalOutput(params: TerminalOutputRequest): Promise<TerminalOutputResponse>;
    waitForTerminalExit(params: WaitForTerminalExitRequest): Promise<TerminalExit>;
    releaseTerminal(params: {
        sessionId: string;
        terminalId: string;
    }): Promise<void>;
    killTerminal(params: KillTerminalRequest): Promise<Record<string, never>>;
    private resolveProcessCwd;
    private spawnProcess;
    private runACPRequest;
    private acpMcpServers;
    private applySessionState;
    private transformConfigOptions;
    private transformModeId;
    private applyConfiguredOverrides;
    /**
     * A stored feature value is a preference carried over from whichever model the user
     * last configured, so the session it lands on may have no such option. Paseo's own
     * guard says so when the session's options are accurate. A model switch answers with
     * an empty response, leaving Paseo holding the previous model's options, and then the
     * provider is the one that rejects the write as invalid params. Outside those two
     * cases the write failed for a reason the user needs to see.
     */
    private isStaleFeatureValueError;
    private warnInvalidSelection;
    private modelSelectionUnavailableMessage;
    private isModelSelectionUnavailableError;
    private featureUnavailableMessage;
    private isFeatureUnavailableError;
    private translateSessionUpdate;
    private handleUserMessageChunk;
    private flushPendingUserMessage;
    private handleToolCallUpdate;
    private createMessageTimelineItem;
    private resolveAssistantMessageId;
    private handleCurrentModeUpdate;
    private handleConfigOptionUpdate;
    private handleSessionInfoUpdate;
    private handleUsageUpdate;
    private handlePromptResponse;
    private wrapTimeline;
    private pushEvent;
    private emitSubmittedUserMessage;
    private runtimeInfo;
    private finishTurn;
    private cancelPendingPermissions;
    private emitBootstrapThreadEvent;
    private synthesizeCanceledToolCalls;
    private collectDiagnostic;
    private getTerminalEntry;
}
export declare function findSelectConfigOption({ configOptions, category, id, }: {
    configOptions: SessionConfigOption[] | null | undefined;
    category: string;
    id?: string;
}): SelectConfigOption | null;
export declare function deriveSelectorOptions(configOptions: SessionConfigOption[] | null | undefined, category: string): ConfigOptionSelector[];
export {};
//# sourceMappingURL=acp-agent.d.ts.map