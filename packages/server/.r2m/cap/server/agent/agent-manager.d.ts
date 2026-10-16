import type { PluginLifecycle } from "../plugins/lifecycle/index.js";
import { AGENT_LIFECYCLE_STATUSES, type AgentLifecycleStatus } from "@getpaseo/protocol/agent-lifecycle";
import type { Logger } from "pino";
import type { ToolPolicy } from "@getpaseo/protocol/agent-types";
import type { ProviderPaseoToolsPolicy } from "@getpaseo/protocol/provider-config";
import type { TerminalManager } from "../../terminal/terminal-manager.js";
import { type AgentCapabilityFlags, type AgentClient, type AgentResumeSessionOptions, type AgentFeature, type AgentSlashCommand, type AgentMode, type AgentPermissionRequest, type AgentPermissionResponse, type AgentPermissionResult, type AgentPersistenceHandle, type AgentProviderNotice, type AgentPromptInput, type AgentProvider, type AgentRunOptions, type AgentSteerOptions, type AgentRunResult, type AgentSession, type AgentSessionConfig, type SteerResult, type AgentStreamEvent, type AgentTimelineItem, type AgentUsage, type AgentRuntimeInfo, type ImportableProviderSession, type ListImportableSessionsOptions } from "./agent-sdk-types.js";
import type { StoredAgentRecord, AgentStorage } from "./agent-storage.js";
import type { AgentOwner } from "./agent-owner.js";
import type { AgentTimelineFetchOptions, AgentTimelineFetchResult, AgentTimelineRow, AgentTimelineStore } from "./agent-timeline-store-types.js";
import { type ForegroundTurnWaiter } from "./agent-run-state.js";
import { type RewindMode } from "./rewind/rewind.js";
import type { PaseoToolCatalogFactory } from "./tools/types.js";
import { type ProviderSubagentDescriptor, type ProviderSubagentStoreEvent } from "./provider-subagents/store.js";
export declare class AgentManagerShuttingDownError extends Error {
    constructor();
}
export declare class AgentRunCancellationError extends Error {
    constructor(agentId: string, action: "reload" | "replace" | "rewind" | "stop");
}
export type AgentRunCancellationResult = {
    status: "not_running";
} | {
    status: "settled";
} | {
    status: "refused";
};
export { AGENT_LIFECYCLE_STATUSES, type AgentLifecycleStatus };
export type { AgentTimelineCursor, AgentTimelineFetchDirection, AgentTimelineFetchOptions, AgentTimelineFetchResult, AgentTimelineRow, AgentTimelineWindow, } from "./agent-timeline-store-types.js";
export type AgentManagerEvent = {
    type: "agent_state";
    agent: ManagedAgent;
} | {
    type: "provider_subagent";
    event: ProviderSubagentStoreEvent;
} | {
    type: "timeline_replacement";
    agentId: string;
    epoch: string;
} | {
    type: "agent_stream";
    agentId: string;
    event: AgentStreamEvent;
    seq?: number;
    epoch?: string;
    timestamp?: string;
};
export type AgentSubscriber = (event: AgentManagerEvent) => void;
export interface SubscribeOptions {
    agentId?: string;
    replayState?: boolean;
}
interface HydrateTimelineOptions {
    force?: boolean;
    broadcast?: boolean | (() => boolean);
    broadcastTimeline?: boolean;
}
export type ImportablePersistedAgentQueryOptions = ListImportableSessionsOptions & {
    /**
     * When set, only providers in this set are scanned, in addition to the
     * built-in importable allowlist + enabled + non-derived rules.
     */
    providerFilter?: Set<string>;
};
export interface ManagedImportableProviderSession extends ImportableProviderSession {
    provider: AgentProvider;
}
export interface ImportableSessionProviderError {
    provider: AgentProvider;
    message: string;
}
export interface ManagedImportableSessionsResult {
    sessions: ManagedImportableProviderSession[];
    providerErrors: ImportableSessionProviderError[];
}
export type AgentAttentionCallback = (params: {
    agentId: string;
    provider: AgentProvider;
    reason: "finished" | "error" | "permission";
}) => void;
export type AgentArchivedCallback = (agentId: string) => Promise<void> | void;
export interface ProviderAvailability {
    provider: AgentProvider;
    available: boolean;
    error: string | null;
}
interface AgentManagerRescueTimeouts {
    reloadSessionCloseMs?: number;
    interruptSessionMs?: number;
}
interface ProviderEnabledFlag {
    enabled: boolean;
    derivedFromProviderId?: string | null;
    applyToolPolicy?: (config: AgentSessionConfig, toolPolicy: ToolPolicy | undefined) => AgentSessionConfig;
}
type ProviderEnabledMap = Partial<Record<AgentProvider, ProviderEnabledFlag>>;
type ProviderClientMap = Partial<Record<AgentProvider, AgentClient>>;
export interface CreateAgentOptions {
    labels?: Record<string, string>;
    initialPrompt?: string;
    env?: Record<string, string>;
    persistSession?: boolean;
    initialTitle?: string | null;
    workspaceId: string | undefined;
    owner?: AgentOwner;
}
export interface AgentManagerOptions {
    pluginLifecycle?: PluginLifecycle;
    clients?: ProviderClientMap;
    providerDefinitions?: ProviderEnabledMap;
    idFactory?: () => string;
    registry?: AgentStorage;
    onAgentAttention?: AgentAttentionCallback;
    onWorkspaceStateMayHaveChanged?: (params: {
        cwd: string;
    }) => void;
    durableTimelineStore?: AgentTimelineStore;
    terminalManager?: TerminalManager | null;
    mcpBaseUrl?: string;
    mcpAuthToken?: string;
    paseoToolsEnabled?: boolean;
    paseoToolCatalogFactory?: PaseoToolCatalogFactory;
    resolvePaseoToolPolicy?: (provider: AgentProvider) => ProviderPaseoToolsPolicy | undefined;
    appendSystemPrompt?: string;
    agentStreamCoalesceWindowMs?: number;
    rescueTimeouts?: AgentManagerRescueTimeouts;
    beforeSteerUnavailableFallback?: (input: {
        agentId: string;
        expectedTurnId: string;
    }) => Promise<void>;
    logger: Logger;
}
export type ActiveTurnSteerDispatchResult = {
    status: "inactive" | "steered";
} | {
    status: "replaced";
    iterator: AsyncGenerator<AgentStreamEvent>;
};
export interface WaitForAgentOptions {
    signal?: AbortSignal;
    waitForActive?: boolean;
}
export interface WaitForAgentResult {
    status: AgentLifecycleStatus;
    permission: AgentPermissionRequest | null;
    lastMessage: string | null;
}
export interface WaitForAgentStartOptions {
    signal?: AbortSignal;
}
export type AttentionState = {
    requiresAttention: false;
} | {
    requiresAttention: true;
    attentionReason: "finished" | "error" | "permission";
    attentionTimestamp: Date;
};
interface ManagedAgentBase {
    id: string;
    provider: AgentProvider;
    cwd: string;
    /**
     * Workspace this agent belongs to, stamped at creation. Independent of cwd:
     * cwd answers "where does it run", workspaceId answers "which workspace owns it".
     * Null/undefined for legacy agents created before ownership stamping.
     */
    workspaceId?: string;
    owner?: AgentOwner;
    capabilities: AgentCapabilityFlags;
    config: AgentSessionConfig;
    runtimeInfo?: AgentRuntimeInfo;
    createdAt: Date;
    updatedAt: Date;
    availableModes: AgentMode[];
    features?: AgentFeature[];
    currentModeId: string | null;
    pendingPermissions: Map<string, AgentPermissionRequest>;
    bufferedPermissionResolutions: Map<string, Extract<AgentStreamEvent, {
        type: "permission_resolved";
    }>>;
    inFlightPermissionResponses: Set<string>;
    pendingReplacement: boolean;
    persistence: AgentPersistenceHandle | null;
    historyPrimed: boolean;
    lastUserMessageAt: Date | null;
    activeTurnId: string | null;
    activeTurnStartedAt: Date | null;
    lastUsage?: AgentUsage;
    lastError?: string;
    attention: AttentionState;
    foregroundTurnWaiters: Set<ForegroundTurnWaiter>;
    finalizedForegroundTurnIds: Set<string>;
    unsubscribeSession: (() => void) | null;
    /**
     * Internal agents are hidden from listings and don't trigger notifications.
     */
    internal?: boolean;
    /**
     * User-defined labels for categorizing agents (e.g., { surface: "workspace" }).
     */
    labels: Record<string, string>;
}
type ManagedAgentWithSession = ManagedAgentBase & {
    session: AgentSession;
};
type ManagedAgentInitializing = ManagedAgentWithSession & {
    lifecycle: "initializing";
    activeForegroundTurnId: null;
};
type ManagedAgentIdle = ManagedAgentWithSession & {
    lifecycle: "idle";
    activeForegroundTurnId: null;
};
type ManagedAgentRunning = ManagedAgentWithSession & {
    lifecycle: "running";
    activeForegroundTurnId: string | null;
};
type ManagedAgentError = ManagedAgentWithSession & {
    lifecycle: "error";
    activeForegroundTurnId: null;
    lastError: string;
};
type ManagedAgentClosed = ManagedAgentBase & {
    lifecycle: "closed";
    session: null;
    activeForegroundTurnId: null;
};
export type ManagedAgent = ManagedAgentInitializing | ManagedAgentIdle | ManagedAgentRunning | ManagedAgentError | ManagedAgentClosed;
export interface AgentMetricsSnapshot {
    total: number;
    subscriptionCount: number;
    byLifecycle: Record<string, number>;
    withActiveForegroundTurn: number;
    timelineStats: {
        totalItems: number;
        maxItemsPerAgent: number;
    };
}
type AgentLabelPatch = Record<string, string | null>;
export declare class AgentManager {
    private readonly pluginLifecycle;
    private readonly clients;
    private readonly providerEnabled;
    private readonly providerDefinitions;
    private readonly agents;
    private readonly timelineStore;
    private readonly providerSubagents;
    private readonly agentsAwaitingInitialSnapshotPersist;
    private readonly sessionEventTails;
    private readonly steerEventBarriers;
    private readonly foregroundMutationTails;
    private readonly runs;
    private readonly subscribers;
    private readonly idFactory;
    private readonly registry?;
    private readonly durableTimelineStore?;
    private readonly previousStatuses;
    private readonly backgroundTasks;
    private readonly agentRegistrationTasks;
    private readonly inFlightAgentCloses;
    private readonly reloadedSessionCloses;
    private readonly lifecycleMutationTails;
    private readonly agentStreamCoalescer;
    private mcpBaseUrl;
    private readonly mcpAuthToken;
    private paseoToolsEnabled;
    private paseoToolCatalogFactory;
    private readonly paseoToolPolicies;
    private readonly resolvePaseoToolPolicy;
    private appendSystemPrompt;
    private onAgentAttention?;
    private onAgentArchived?;
    private onWorkspaceStateMayHaveChanged?;
    private logger;
    private readonly rescueTimeouts;
    private readonly beforeSteerUnavailableFallback?;
    private acceptingAgentRegistrations;
    constructor(options: AgentManagerOptions);
    private configurePaseoTools;
    registerClient(provider: AgentProvider, client: AgentClient): void;
    updateProviderRegistry(input: {
        providerDefinitions: ProviderEnabledMap;
        clients: ProviderClientMap;
        retiredProviders?: readonly AgentProvider[];
    }): void;
    getRegisteredProviderIds(): AgentProvider[];
    setAgentAttentionCallback(callback: AgentAttentionCallback): void;
    setAgentArchivedCallback(callback: AgentArchivedCallback): void;
    setMcpBaseUrl(url: string | null): void;
    prepareForShutdown(): void;
    setPaseoToolsEnabled(enabled: boolean): void;
    setPaseoToolCatalogFactory(factory: PaseoToolCatalogFactory | null): void;
    getPaseoToolPolicy(agentId: string): ProviderPaseoToolsPolicy | undefined;
    /**
     * Capability token the daemon's own MCP clients must present to the Agent MCP
     * endpoint when a daemon password is configured. Read by the per-client
     * session to authenticate its own MCP connection. Stays in the daemon — never
     * sent to remote clients.
     */
    getMcpAuthToken(): string | null;
    setAppendSystemPrompt(prompt: string | null | undefined): void;
    getMetricsSnapshot(): AgentMetricsSnapshot;
    private touchUpdatedAt;
    private nextStoredUpdatedAt;
    hasInFlightRun(agentId: string): boolean;
    subscribe(callback: AgentSubscriber, options?: SubscribeOptions): () => void;
    subscriptionCount(): number;
    listAgents(): ManagedAgent[];
    listImportableSessions(options?: ImportablePersistedAgentQueryOptions): Promise<ManagedImportableSessionsResult>;
    private isProviderImportable;
    listProviderAvailability(): Promise<ProviderAvailability[]>;
    getProviderAvailability(provider: AgentProvider): Promise<ProviderAvailability>;
    listDraftCommands(config: AgentSessionConfig): Promise<AgentSlashCommand[]>;
    listDraftFeatures(config: AgentSessionConfig): Promise<AgentFeature[]>;
    usageSession(id: string): import("./agent-sdk-types.js").AgentUsageSession | null;
    getAgent(id: string): ManagedAgent | null;
    waitForAgentClose(agentId: string): Promise<void>;
    getTimeline(id: string): AgentTimelineItem[];
    getTimelineRows(id: string): Promise<AgentTimelineRow[]>;
    fetchTimeline(id: string, options?: AgentTimelineFetchOptions): AgentTimelineFetchResult;
    listProviderSubagents(parentAgentId: string): ProviderSubagentDescriptor[];
    listProviderSubagentActivity(): ProviderSubagentDescriptor[];
    getProviderSubagent(parentAgentId: string, subagentId: string): ProviderSubagentDescriptor | null;
    fetchProviderSubagentTimeline(parentAgentId: string, subagentId: string, options?: AgentTimelineFetchOptions): AgentTimelineFetchResult;
    createAgent(config: AgentSessionConfig, agentId: string | undefined, options: CreateAgentOptions): Promise<ManagedAgent>;
    private createAgentInternal;
    private buildCreateSessionOptions;
    resumeAgentFromPersistence(handle: AgentPersistenceHandle, overrides?: Partial<AgentSessionConfig>, agentId?: string, options?: {
        createdAt?: Date;
        updatedAt?: Date;
        lastUserMessageAt?: Date | null;
        labels?: Record<string, string>;
        workspaceId?: string;
        owner?: AgentOwner;
        attention?: AttentionState;
    }, resumeOptions?: AgentResumeSessionOptions): Promise<ManagedAgent>;
    private resumeAgentFromPersistenceInternal;
    importProviderSession(input: {
        provider: AgentProvider;
        providerHandleId: string;
        cwd: string;
        workspaceId: string;
        labels?: Record<string, string>;
    }): Promise<ManagedAgent>;
    private importProviderSessionInternal;
    reloadAgentSession(agentId: string, overrides?: Partial<AgentSessionConfig>, options?: {
        rehydrateFromDisk?: boolean;
    }): Promise<ManagedAgent>;
    private reloadAgentSessionInternal;
    private closeReloadedSession;
    private waitWithTimeout;
    closeAgent(agentId: string): Promise<void>;
    private closeAgentRuntime;
    private cancelRunningProviderSubagents;
    archiveAgent(agentId: string): Promise<{
        archivedAt: string;
    }>;
    private archiveAgentUnlocked;
    private cascadeArchiveChildren;
    private markRecordArchived;
    private persistArchivedRecord;
    private fireAgentArchived;
    private dispatchStoredAgentState;
    setAgentMode(agentId: string, modeId: string): Promise<AgentProviderNotice | null>;
    setAgentModel(agentId: string, modelId: string | null): Promise<void>;
    setAgentThinkingOption(agentId: string, thinkingOptionId: string | null): Promise<AgentProviderNotice | null>;
    setAgentFeature(agentId: string, featureId: string, value: unknown): Promise<void>;
    setTitle(agentId: string, title: string): Promise<void>;
    setLabels(agentId: string, labels: Record<string, string>): Promise<void>;
    private writeLabels;
    private writeStoredMetadata;
    detachAgent(agentId: string): Promise<{
        record: StoredAgentRecord;
        live: boolean;
        previousParentAgentId: string | null;
    }>;
    private detachAgentUnlocked;
    notifyAgentState(agentId: string): void;
    clearAgentAttention(agentId: string): Promise<void>;
    markAgentUnread(agentId: string): Promise<void>;
    archiveSnapshot(agentId: string, archivedAt: string): Promise<StoredAgentRecord>;
    private archiveSnapshotUnlocked;
    unarchiveSnapshot(agentId: string, updates?: {
        workspaceId?: string;
        labels?: AgentLabelPatch;
    }): Promise<boolean>;
    private unarchiveSnapshotUnlocked;
    unarchiveSnapshotByHandle(handle: AgentPersistenceHandle): Promise<void>;
    updateAgentMetadata(agentId: string, updates: {
        title?: string;
        labels?: Record<string, string>;
    }): Promise<void>;
    private updateAgentMetadataUnlocked;
    private runLifecycleMutation;
    runAgent(agentId: string, prompt: AgentPromptInput, options?: AgentRunOptions): Promise<AgentRunResult>;
    /**
     * Try to run a prompt out-of-band — i.e. without allocating a foreground turn
     * and without canceling any active turn. Returns true when the session
     * accepted the prompt as a side-effect command (e.g. /goal pause). Events
     * emitted by the handler flow through dispatchStream so they persist and
     * broadcast like normal timeline events.
     */
    tryRunOutOfBand(agentId: string, prompt: AgentPromptInput, options?: AgentRunOptions): boolean;
    appendTimelineItem(agentId: string, item: AgentTimelineItem): Promise<{
        seq: number;
        epoch: string;
    }>;
    emitLiveTimelineItem(agentId: string, item: AgentTimelineItem): Promise<void>;
    private startPendingForegroundTurn;
    streamAgent(agentId: string, prompt: AgentPromptInput, options?: AgentRunOptions): AsyncGenerator<AgentStreamEvent>;
    private finalizeForegroundTurn;
    private openActiveTurn;
    private applyActiveTurnTerminal;
    replaceAgentRun(agentId: string, prompt: AgentPromptInput, options?: AgentRunOptions): Promise<AsyncGenerator<AgentStreamEvent>>;
    steerAgentRun(agentId: string, prompt: AgentPromptInput, options?: AgentSteerOptions): Promise<SteerResult>;
    steerOrReplaceActiveTurn(agentId: string, prompt: AgentPromptInput, options?: AgentSteerOptions): Promise<ActiveTurnSteerDispatchResult>;
    private assertSteerAdmissionOwnsTurn;
    private runSteerAdmission;
    private runForegroundMutation;
    private replaceAdmittedForegroundTurn;
    private recordAcceptedSteer;
    waitForAgentRunStart(agentId: string, options?: WaitForAgentStartOptions): Promise<void>;
    respondToPermission(agentId: string, requestId: string, response: AgentPermissionResponse): Promise<AgentPermissionResult | void>;
    cancelAgentRun(agentId: string): Promise<AgentRunCancellationResult>;
    private cancelAgentRunNow;
    private cancelAgentRunBefore;
    private interruptSession;
    getPendingPermissions(agentId: string): AgentPermissionRequest[];
    private peekPendingPermission;
    /**
     * Hydrates the runtime timeline from provider history. No-ops if already hydrated.
     */
    hydrateTimelineFromProvider(agentId: string, options?: HydrateTimelineOptions): Promise<void>;
    rewind(agentId: string, messageId: string, mode: RewindMode): Promise<void>;
    deleteAgentState(agentId: string): Promise<void>;
    deleteCommittedTimeline(agentId: string): Promise<void>;
    getLastAssistantMessage(agentId: string): Promise<string | null>;
    private getLastAssistantMessageFromTimeline;
    private getLastAssistantMessageSegmentFromTimeline;
    private getLastAssistantMessageFromStores;
    private getLastItemFromStores;
    waitForAgentEvent(agentId: string, options?: WaitForAgentOptions): Promise<WaitForAgentResult>;
    private registerSession;
    private assertAcceptingAgentRegistrations;
    private assertAgentRegistrationActive;
    private closeUnregisteredSession;
    private requireExternalMcpSupport;
    private initializeAgentTimelineForRegister;
    private buildManagedAgentForRegister;
    private loadCommittedTimelineSeed;
    private prepareAgentForClosure;
    private discardRetainedAgentState;
    private emitClosedAgent;
    private subscribeToSession;
    private enqueueSessionEvent;
    /**
     * Provider mutations may synchronously emit config events that are processed through the
     * asynchronous session queue. Apply those events before committing the mutation's explicit
     * manager state so call order remains authoritative.
     */
    private drainSessionEvents;
    private dispatchSessionEvent;
    private resolveInitialPersistedTitle;
    private persistSnapshot;
    private requireRegistry;
    /**
     * Provider-side mode switches (ACP current_mode_update, in-session
     * commands, permission-driven transitions) must land in config.modeId too —
     * reloadAgentSession and the persisted record derive the resumed session's
     * mode from it, so leaving it stale silently downgrades the mode on resume.
     */
    private applyObservedMode;
    private refreshSessionState;
    private refreshRuntimeInfo;
    private hydrateTimelineFromLegacyProviderHistory;
    private forceHydrateTimelineFromLegacyProviderHistory;
    private primeTimelineFromLegacyProviderHistory;
    private notifyForegroundTurnWaiters;
    private handleStreamEvent;
    private traceHandleStreamEventStart;
    private traceCoalescerBuffered;
    private traceHandleStreamEventEnd;
    private dispatchStreamEventByType;
    private onStreamThreadStarted;
    private refreshSessionPersistence;
    private onStreamTimelineEvent;
    private onStreamTurnCompleted;
    private onStreamTurnFailed;
    private onStreamTurnCanceled;
    private onStreamTurnStarted;
    private onStreamPermissionRequested;
    private onStreamPermissionResolved;
    private resolvePendingPermissionsForAgent;
    private recordAndDispatchTimelineItem;
    private recordSubmittedPrompt;
    private reconcileSubmittedPromptEcho;
    private appendSystemErrorTimelineMessage;
    private formatTurnFailedMessage;
    private recordTimeline;
    private emitState;
    private syncFeaturesFromSession;
    private checkAndSetAttention;
    private enqueueBackgroundPersist;
    private enqueueDurableTimelineAppend;
    private enqueueDurableTimelineBulkInsert;
    private enqueueDurableTimelineUpdate;
    private trackBackgroundTask;
    private trackAgentRegistrationOperation;
    /**
     * Flush any background persistence work (best-effort).
     */
    flush(): Promise<void>;
    /**
     * Flush persistence and agent registrations that crossed the synchronous
     * shutdown barrier. Those registrations own provider sessions until they
     * either install them or close them.
     */
    flushForShutdown(): Promise<void>;
    private flushTasks;
    private broadcastAgentAttention;
    private dispatchStream;
    private dispatch;
    private eventBelongsToInternalAgent;
    private normalizeConfig;
    private applyProviderConfiguration;
    private validateToolPolicyServers;
    private resolveDefaultModelId;
    private prepareSessionConfig;
    private applyDaemonAppendSystemPrompt;
    private buildLaunchContext;
    private resolveProviderLaunchConfig;
    private requireAvailableClient;
    private requireEnabledProvider;
    private getConfiguredProviderIds;
    private requireClient;
    private syncNativeArchiveState;
    private requireAgent;
    private requireSessionAgent;
    private requirePublicAgent;
}
export declare function commandMayHaveChangedExternalState(command: string): boolean;
//# sourceMappingURL=agent-manager.d.ts.map