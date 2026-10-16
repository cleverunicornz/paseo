import { type AssistantMessage as OpenCodeAssistantMessage, type Event as OpenCodeEvent, type FilePartInput as OpenCodeFilePartInput, type Message as OpenCodeMessage, type OpencodeClient, type Part as OpenCodePart, type TextPartInput as OpenCodeTextPartInput } from "@opencode-ai/sdk/v2/client";
import type { Logger } from "pino";
import { type AgentCapabilityFlags, type AgentClient, type AgentCreateSessionOptions, type AgentFeature, type AgentLaunchContext, type AgentMode, type AgentModelDefinition, type AgentPermissionRequest, type AgentPermissionResponse, type AgentPersistenceHandle, type AgentPromptInput, type AgentRunOptions, type AgentRunResult, type AgentRuntimeInfo, type AgentSession, type AgentSessionConfig, type AgentSlashCommand, type AgentStreamEvent, type AgentTimelineItem, type AgentUsage, type FetchCatalogOptions, type ProviderRefreshContext, type ImportableProviderSession, type ImportProviderSessionContext, type ImportProviderSessionInput, type ListImportableSessionsOptions, type ResolveAgentCreateConfigInput, type ResolveAgentCreateConfigResult, type ProviderCatalog, type SteerActiveTurnOptions, type SteerResult, type ToolCallTimelineItem } from "../agent-sdk-types.js";
import { isDefaultAgentCreateConfigUnattended } from "../create-agent-mode.js";
import { type ProviderRuntimeSettings } from "../provider-launch-config.js";
import { type OpenCodeServerManagerLike } from "./opencode/server-manager.js";
import type { OpenCodeBridge } from "./opencode/bridge.js";
import { type OpenCodeEventSource } from "./opencode/event-consumer.js";
import { resolveOpenCodeHomeDir } from "./opencode/paths.js";
import { type OpenCodeSubagentPresentationState } from "./opencode/subagent-presentation.js";
import type { ManagedProcessRegistry } from "../../managed-processes/managed-processes.js";
import { type OpenCodeProviderOptions } from "./opencode/options.js";
declare function resolveOpenCodeCreateConfig(input: ResolveAgentCreateConfigInput): ResolveAgentCreateConfigResult;
declare function isOpenCodeCreateConfigUnattended(input: Parameters<typeof isDefaultAgentCreateConfigUnattended>[0]): boolean;
type OpenCodeAgentConfig = Omit<AgentSessionConfig, "providerOptions"> & {
    provider: "opencode";
    providerOptions: OpenCodeProviderOptions;
};
type OpenCodeMessageRole = "user" | "assistant";
interface OpenCodeSessionMessage {
    info: OpenCodeMessage;
    parts: OpenCodePart[];
}
declare function isSelectableOpenCodeAgent(agent: {
    mode?: string;
    hidden?: boolean;
}): boolean;
declare function mapOpenCodeAgentToMode(agent: {
    name: string;
    description?: unknown;
    color?: unknown;
}): AgentMode;
declare function buildOpenCodeModelLookupKey(providerId: string, modelId: string): string;
declare function parseOpenCodeModelLookupKey(modelId: string | null | undefined): string | undefined;
declare function extractOpenCodeModelContextWindow(model: unknown): number | undefined;
declare function buildOpenCodeModelDefinition(provider: {
    id: string;
    name: string;
}, modelId: string, model: {
    name: string;
    family?: string;
    release_date?: string;
    attachment?: boolean;
    reasoning?: boolean;
    tool_call?: boolean;
    cost?: unknown;
    limit?: {
        context?: number;
        input?: number;
        output?: number;
    };
    variants?: Record<string, unknown>;
}): AgentModelDefinition;
declare function resolveOpenCodeSelectedModelContextWindow(providers: {
    connected?: string[];
    all?: Array<{
        id: string;
        models?: Record<string, unknown>;
    }>;
} | null | undefined, modelId: string | null | undefined): number | undefined;
declare function buildOpenCodeModelContextWindowLookup(providers: {
    connected?: string[];
    all?: Array<{
        id: string;
        source?: string;
        models?: Record<string, unknown>;
    }>;
} | null | undefined): Map<string, number>;
declare function resolveOpenCodeModelLookupKeyFromAssistantMessage(info: OpenCodeAssistantMessage): string | undefined;
declare function mergeOpenCodeStepFinishUsage(usage: AgentUsage, part: {
    cost?: unknown;
    tokens?: {
        input?: unknown;
        output?: unknown;
        reasoning?: unknown;
        total?: unknown;
        cache?: {
            read?: unknown;
            write?: unknown;
        };
    };
}, options?: {
    totalCostUsd?: number;
}): void;
declare function hasNormalizedOpenCodeUsage(usage: AgentUsage): boolean;
declare function buildOpenCodePromptParts(prompt: AgentPromptInput): Array<OpenCodeTextPartInput | OpenCodeFilePartInput>;
declare function buildOpenCodeSessionTimeline(messages: ReadonlyArray<OpenCodeSessionMessage>): AgentTimelineItem[];
export declare const __openCodeInternals: {
    buildOpenCodePromptParts: typeof buildOpenCodePromptParts;
    buildOpenCodeSessionTimeline: typeof buildOpenCodeSessionTimeline;
    buildOpenCodeModelContextWindowLookup: typeof buildOpenCodeModelContextWindowLookup;
    buildOpenCodeModelDefinition: typeof buildOpenCodeModelDefinition;
    buildOpenCodeModelLookupKey: typeof buildOpenCodeModelLookupKey;
    extractOpenCodeModelContextWindow: typeof extractOpenCodeModelContextWindow;
    hasNormalizedOpenCodeUsage: typeof hasNormalizedOpenCodeUsage;
    mergeOpenCodeStepFinishUsage: typeof mergeOpenCodeStepFinishUsage;
    parseOpenCodeModelLookupKey: typeof parseOpenCodeModelLookupKey;
    resolveOpenCodeModelLookupKeyFromAssistantMessage: typeof resolveOpenCodeModelLookupKeyFromAssistantMessage;
    resolveOpenCodeSelectedModelContextWindow: typeof resolveOpenCodeSelectedModelContextWindow;
    isSelectableOpenCodeAgent: typeof isSelectableOpenCodeAgent;
    mapOpenCodeAgentToMode: typeof mapOpenCodeAgentToMode;
    resolveOpenCodeHomeDir: typeof resolveOpenCodeHomeDir;
    readonly OpenCodeAgentSession: typeof OpenCodeAgentSession;
};
interface OpenCodeAgentClientDeps {
    serverManager?: OpenCodeServerManagerLike;
    createClient?: OpenCodeClientFactory;
    resolveHomeDir?: () => string;
    managedProcesses?: ManagedProcessRegistry;
    bridge?: OpenCodeBridge;
}
type OpenCodeClientFactory = (options: {
    baseUrl: string;
    directory: string;
}) => OpencodeClient;
export declare class OpenCodeAgentClient implements AgentClient {
    readonly provider: "opencode";
    readonly capabilities: AgentCapabilityFlags;
    readonly resolveCreateConfig: typeof resolveOpenCodeCreateConfig;
    readonly isCreateConfigUnattended: typeof isOpenCodeCreateConfigUnattended;
    private readonly serverManager;
    private readonly createOpenCodeClient;
    private readonly resolveHomeDir;
    private readonly logger;
    private readonly runtimeSettings?;
    private readonly modelContextWindows;
    private readonly bridge?;
    constructor(logger: Logger, runtimeSettings?: ProviderRuntimeSettings, deps?: OpenCodeAgentClientDeps);
    createSession(config: AgentSessionConfig, launchContext?: AgentLaunchContext, options?: AgentCreateSessionOptions): Promise<AgentSession>;
    resumeSession(handle: AgentPersistenceHandle, overrides?: Partial<AgentSessionConfig>, launchContext?: AgentLaunchContext): Promise<AgentSession>;
    private applySessionPermissionRules;
    private connectServer;
    private toServerConnection;
    private acquireServer;
    private bindBridgeSession;
    fetchCatalog(options: FetchCatalogOptions, context?: ProviderRefreshContext): Promise<ProviderCatalog>;
    listCommands(config: AgentSessionConfig): Promise<AgentSlashCommand[]>;
    listFeatures(config: AgentSessionConfig): Promise<AgentFeature[]>;
    listImportableSessions(options?: ListImportableSessionsOptions): Promise<ImportableProviderSession[]>;
    importSession(input: ImportProviderSessionInput, context: ImportProviderSessionContext): Promise<import("../agent-sdk-types.js").ImportedProviderSession>;
    archiveNativeSession(handle: AgentPersistenceHandle): Promise<void>;
    unarchiveNativeSession(handle: AgentPersistenceHandle): Promise<void>;
    private setNativeSessionArchived;
    isAvailable(): Promise<boolean>;
    shutdown(): Promise<void>;
    getDiagnostic(): Promise<{
        diagnostic: string;
    }>;
    private fetchModelsFromClient;
    private fetchModesFromClient;
    private assertConfig;
    private populateModelContextWindowCache;
}
export interface OpenCodeEventTranslationState {
    sessionId: string;
    cwd?: string;
    messageRoles: Map<string, OpenCodeMessageRole>;
    pendingUserMessageText?: string | null;
    pendingClientMessageId?: string | null;
    pendingSteerSubmissions?: OpenCodePendingSteerSubmission[];
    emittedUserMessageIds?: Set<string>;
    accumulatedUsage: AgentUsage;
    sessionTotalCostUsd?: number;
    materializedParts: Map<string, {
        messageId: string;
        emittedText: string;
        closed: boolean;
    }>;
    emittedStructuredMessageIds: Set<string>;
    compactionSummaryMessageIds: Set<string>;
    emittedCompactionPartIds: Set<string>;
    hydratedMessageFingerprints?: Map<string, string>;
    hydratedPartFingerprints?: Map<string, string>;
    suppressAssistantMessagesUntilIdle?: {
        active: boolean;
    };
    partTypes: Map<string, string>;
    subAgentsByCallId?: Map<string, OpenCodeSubAgentActivityState>;
    subAgentCallIdByChildSessionId?: Map<string, string>;
    knownChildSessionIds?: Set<string>;
    subagentPresentationByChildId?: Map<string, OpenCodeSubagentPresentationState>;
    modelContextWindowsByModelKey?: ReadonlyMap<string, number>;
    onAssistantModelContextWindowResolved?: (contextWindowMaxTokens: number) => void;
    onMaterializationMismatch?: (diagnostic: {
        partId: string;
        messageId: string;
        kind: "text" | "reasoning";
    }) => void;
}
interface OpenCodePendingSteerSubmission {
    providerMessageId: string;
    text: string;
    clientMessageId: string | null;
}
interface OpenCodeSubAgentActivityState {
    toolCall: ToolCallTimelineItem;
    childSessionId?: string;
}
export declare function translateOpenCodeEvent(event: OpenCodeEvent, state: OpenCodeEventTranslationState): AgentStreamEvent[];
/** One OpenCode server generation a session talks to. */
interface OpenCodeServerConnection {
    environment: Record<string, string>;
    client: OpencodeClient;
    events: OpenCodeEventSource;
    url: string;
    release: () => Promise<void>;
}
declare class OpenCodeAgentSession implements AgentSession {
    private readonly harnessEnvironment;
    private readonly agentId?;
    private readonly externallyDriven;
    readonly provider: "opencode";
    readonly capabilities: AgentCapabilityFlags;
    private readonly config;
    private server;
    /** Connects to the server generation that is current now. */
    private readonly connectServer;
    private serverExited;
    private reconnection;
    private readonly sessionId;
    private readonly logger;
    private readonly modelContextWindowsByModelKey;
    private currentMode;
    private autoAcceptEnabled;
    private pendingPermissions;
    private abortController;
    private accumulatedUsage;
    private sessionTotalCostUsd;
    private mcpSetup;
    private messageRoles;
    private pendingUserMessageText;
    private pendingClientMessageId;
    private pendingSteerSubmissions;
    private emittedUserMessageIds;
    private materializedParts;
    private activeDispatchMessageId;
    private emittedStructuredMessageIds;
    private compactionSummaryMessageIds;
    private emittedCompactionPartIds;
    private suppressAssistantMessagesUntilIdle;
    private partTypes;
    private availableModesCache;
    private readonly subscribers;
    private nextTurnOrdinal;
    private turnState;
    /**
     * Settlement of every session-scoped abort issued so far. It outlives the stop
     * that issued it because a request still in flight can cancel a replacement
     * run, and a rejection means we never proved the runner stopped.
     */
    private abortSettlement;
    private externalStatusReconciliationStarted;
    private runnerStatusRevision;
    private readonly runningToolCalls;
    private subAgentsByCallId;
    private subAgentCallIdByChildSessionId;
    private knownChildSessionIds;
    private readonly subagentPresentationByChildId;
    private readonly childTranslationStates;
    private readonly childSessionCwds;
    private readonly childStatuses;
    private readonly pendingPermissionDirectories;
    private childHydrationPromise;
    private childHydrationCompleted;
    private readonly unrelatedSessionIds;
    private selectedModelContextWindowMaxTokens;
    private releaseBridge;
    private ingress;
    private gapRepairRevision;
    private recoveryAbortController;
    private unsubscribeEvents;
    private closed;
    private readonly persistSession;
    private deletedFromProvider;
    private readonly usageSessionKey;
    constructor(config: OpenCodeAgentConfig, client: OpencodeClient, sessionId: string, logger: Logger, harnessEnvironment: Record<string, string>, modelContextWindowsByModelKey?: ReadonlyMap<string, number>, events?: OpenCodeEventSource, releaseServer?: () => Promise<void>, persistSession?: boolean, agentId?: string | undefined, serverUrl?: string, externallyDriven?: boolean, releaseBridge?: () => void, connectServer?: () => Promise<OpenCodeServerConnection>);
    usageSession(): {
        provider: string;
        model: string | undefined;
        env: Record<string, string>;
        sessionKey: `${string}-${string}-${string}-${string}-${string}`;
    } | null;
    private get client();
    private get events();
    private subscribeServerEvents;
    /**
     * The OpenCode session outlives the server process that served it, and Paseo starts the
     * next server on a new port. Move to the current server before talking to OpenCode again,
     * so the session does not keep calling a port nothing listens on.
     */
    private reconnectIfServerExited;
    private reconnect;
    get id(): string | null;
    private get activeForegroundTurnId();
    get features(): AgentFeature[];
    getRuntimeInfo(): Promise<AgentRuntimeInfo>;
    setModel(modelId: string | null): Promise<void>;
    setThinkingOption(thinkingOptionId: string | null): Promise<void>;
    run(prompt: AgentPromptInput, options?: AgentRunOptions): Promise<AgentRunResult>;
    interrupt(): Promise<void>;
    steerActiveTurn(prompt: AgentPromptInput, options: SteerActiveTurnOptions): Promise<SteerResult>;
    private removePendingSteerSubmission;
    private clearPendingPermissionsForSteer;
    revertBoth(input: {
        messageId: string;
    }): Promise<void>;
    private abortSession;
    /**
     * Gate every runner-affecting operation on the previous stop. OpenCode runs one
     * runner per session and aborts it session-wide, so a replacement may start
     * only once the canceled run published its terminal and our own abort settled.
     * A failed abort never proved the runner stopped, so it fails closed until the
     * next Stop issues a fresh one.
     */
    private awaitRunnerQuiescence;
    private waitUntilProviderIdle;
    private observeProviderStopBoundary;
    private reconcileStopWithProviderStatus;
    private readProviderRunnerStatus;
    startTurn(prompt: AgentPromptInput, options?: AgentRunOptions): Promise<{
        turnId: string;
    }>;
    private awaitEventStreamReady;
    private rethrowRunnerWaitError;
    subscribe(callback: (event: AgentStreamEvent) => void): () => void;
    private startExternalStatusReconciliation;
    private reconcileExternalRunnerStatus;
    private startChildSessionHydration;
    private hydrateChildSessions;
    private discoverChildSessions;
    private readChildStatuses;
    private hydrateDiscoveredChild;
    private hydrateChildSessionTimeline;
    /**
     * After replaying a historical child, derive presentation facts from the last assistant
     * message (the session record's agent/model were already folded at detection) and publish
     * any missing title plus the updated subtitle once. Presentation-only: no `status`.
     */
    private emitHydratedChildPresentation;
    private recordProviderInternalEvent;
    private consumeEventSourceInput;
    private reconcileAfterGap;
    private refreshGapScope;
    private settleRecoveredGap;
    private scheduleGapRepair;
    private reconcileBlockingRequests;
    private isOwnedSessionId;
    private consumeOpenCodeStreamEvent;
    private discardEventWhileStopping;
    private emitBackgroundPermissionRequests;
    private observeRunnerStatusEvent;
    private shouldStartAutonomousTurn;
    private startAutonomousTurn;
    private finishForegroundTurn;
    private isStopping;
    private issueStop;
    private issueOwnedAbort;
    private acknowledgeCancellation;
    /**
     * Issues the session-scoped abort for one stop, retrying it once. The stop owns
     * every abort it needs: a detached retry would outlive its own boundary and
     * cancel whichever run happened to be current when it landed.
     */
    private runOwnedAbort;
    private finishStoppingTurn;
    private trackToolCall;
    private synthesizeInterruptedToolCalls;
    private notifySubscribers;
    private createTurnId;
    private traceOpenCode;
    streamHistory(): AsyncGenerator<AgentStreamEvent>;
    getAvailableModes(): Promise<AgentMode[]>;
    getCurrentMode(): Promise<string | null>;
    listCommands(): Promise<AgentSlashCommand[]>;
    setMode(modeId: string): Promise<void>;
    setFeature(featureId: string, value: unknown): Promise<void>;
    getPendingPermissions(): AgentPermissionRequest[];
    respondToPermission(requestId: string, response: AgentPermissionResponse): Promise<void>;
    describePersistence(): AgentPersistenceHandle | null;
    close(): Promise<void>;
    private deleteProviderSessionIfEphemeral;
    private parseSlashCommandInput;
    private resolveSlashCommandInvocation;
    private parseModel;
    private ensureMcpServersConfigured;
    private configureMcpServers;
    private registerMcpServer;
    private runMcpOperation;
    private createTranslationState;
    private getChildTranslationState;
    private appendProviderSubagentEvents;
    private translateProviderSubagentEvent;
    /**
     * Fold presentation facts (agent, model, variant, completed-message tokens) off a child
     * assistant `message.updated` frame and emit the missing title and/or changed subtitle.
     * Never carries `status`: a presentation upsert must not revert a finished child.
     */
    private appendChildAssistantPresentationUpsert;
    private translateEvent;
    private syncRuntimeModel;
    private tryAutoApproveToolPermission;
    private resolveSelectedModelContextWindowMaxTokens;
    private resolveConfiguredModelContextWindowMaxTokens;
}
export {};
//# sourceMappingURL=opencode-agent.d.ts.map