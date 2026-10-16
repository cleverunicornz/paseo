import type { Logger } from "pino";
import { type AgentCapabilityFlags, type AgentClient, type AgentFeature, type AgentLaunchContext, type AgentMode, type AgentModelDefinition, type AgentPermissionRequest, type AgentPermissionResponse, type AgentProviderNotice, type AgentPersistenceHandle, type AgentPromptInput, type AgentProvider, type AgentResumeSessionOptions, type AgentRunOptions, type AgentRunResult, type AgentRuntimeInfo, type AgentSession, type AgentSessionConfig, type AgentSlashCommand, type AgentStreamEvent, type FetchCatalogOptions, type ImportableProviderSession, type ImportProviderSessionContext, type ImportProviderSessionInput, type ListImportableSessionsOptions, type ProviderCatalog, type ProviderRefreshContext, type SteerActiveTurnOptions, type SteerResult } from "../../agent-sdk-types.js";
import { type ProviderRuntimeSettings } from "../../provider-launch-config.js";
export { formatOmpVersionSupport, resolveOmpDiagnosticPaths } from "./provider-config.js";
import { type OmpSubagentCardScheduler } from "./subagent-card-tracker.js";
import type { OmpRuntime, OmpRuntimeSession } from "./runtime.js";
import type { OmpSessionState } from "./rpc-types.js";
import { OmpHostToolRouter } from "./host-tools.js";
import { type OmpUsagePollScheduler } from "./usage-poller.js";
export interface OmpAgentClientOptions {
    logger: Logger;
    runtimeSettings?: ProviderRuntimeSettings;
    runtime?: OmpRuntime;
    subagentCardScheduler?: OmpSubagentCardScheduler;
    providerIdleScheduler?: OmpProviderIdleScheduler;
    noTurnScheduler?: OmpNoTurnScheduler;
    usagePollScheduler?: OmpUsagePollScheduler;
    providerIdleDeadlineMs?: number;
}
export interface OmpProviderIdleScheduler {
    waitForRetry(): Promise<void>;
}
export interface OmpNoTurnScheduler {
    waitForSettle(signal: AbortSignal): Promise<void>;
}
interface StartTurnResult {
    turnId: string;
}
interface OmpAgentSessionOptions {
    runtimeSession: OmpRuntimeSession;
    hostTools?: OmpHostToolRouter;
    restartRuntime: (sessionFile: string | null, modeId: string) => Promise<{
        runtimeSession: OmpRuntimeSession;
        hostTools?: OmpHostToolRouter;
    }>;
    config: AgentSessionConfig;
    initialState: OmpSessionState;
    currentModeId?: string | null;
    logger: Logger;
    subagentCardScheduler?: OmpSubagentCardScheduler;
    providerIdleScheduler?: OmpProviderIdleScheduler;
    noTurnScheduler?: OmpNoTurnScheduler;
    usagePollScheduler?: OmpUsagePollScheduler;
    providerIdleDeadlineMs?: number;
    /**
     * When false (resumed sessions), replayed session events are dropped until
     * the first prompt or agent_start so history is not re-emitted as live
     * timeline items.
     */
    live?: boolean;
}
export declare function transformOmpModels(models: AgentModelDefinition[]): AgentModelDefinition[];
export declare class OmpAgentSession implements AgentSession {
    readonly provider: AgentProvider;
    readonly capabilities: AgentCapabilityFlags;
    private readonly subscribers;
    private readonly activeToolCalls;
    private readonly pendingExtensionUiRequests;
    private readonly questionUi;
    private activeTurnId;
    private readonly pendingClientMessages;
    private activeAssistantMessageId;
    private activeTurnTerminalAssistantMessage;
    private activeTurnStarted;
    private activeTurnHasUserMessage;
    private activeNoTurnPromptText;
    private readonly pendingNoTurnOutputs;
    private activePromptRequestId;
    private activePromptAgentInvoked;
    private activePromptError;
    private readonly pendingPromptResults;
    private pendingNoTurnCompletionAbort;
    private lastKnownThinkingOptionId;
    private outOfBandCompactionEmit;
    private outOfBandCompactionStarted;
    private outOfBandCompactionCompleted;
    private commandCache;
    private readonly subagentIndex;
    private readonly subagentCardTracker;
    private lastTodoItem;
    private state;
    private currentModeId;
    private runtimeDead;
    private replacingRuntime;
    private unsubscribeRuntime;
    private readonly providerIdleScheduler;
    private readonly providerIdleDeadlineMs;
    private readonly noTurnScheduler;
    private readonly usagePoller;
    private closed;
    private live;
    private readonly emittedUserMessageIds;
    private readonly usageSessionKey;
    usageSession(): {
        provider: string;
        model: string | undefined;
        env: Record<string, string>;
        sessionKey: `${string}-${string}-${string}-${string}-${string}`;
    } | null;
    constructor(options: OmpAgentSessionOptions);
    private attachRuntime;
    private runtimeSession;
    private hostTools?;
    private readonly restartRuntime;
    private readonly config;
    private readonly logger;
    get id(): string | null;
    get features(): AgentFeature[];
    setFeature(featureId: string, value: unknown): Promise<void>;
    run(prompt: AgentPromptInput, options?: AgentRunOptions): Promise<AgentRunResult>;
    startTurn(prompt: AgentPromptInput, options?: AgentRunOptions): Promise<StartTurnResult>;
    steerActiveTurn(prompt: AgentPromptInput, options: SteerActiveTurnOptions): Promise<SteerResult>;
    private rememberClientMessage;
    private forgetClientMessage;
    private takeClientMessage;
    subscribe(callback: (event: AgentStreamEvent) => void): () => void;
    streamHistory(): AsyncGenerator<AgentStreamEvent>;
    getRuntimeInfo(): Promise<AgentRuntimeInfo>;
    private runtimeInfoFromState;
    getAvailableModes(): Promise<AgentMode[]>;
    getCurrentMode(): Promise<string | null>;
    setMode(modeId: string): Promise<void | AgentProviderNotice>;
    private replaceRuntime;
    getPendingPermissions(): AgentPermissionRequest[];
    respondToPermission(requestId: string, response: AgentPermissionResponse): Promise<void>;
    describePersistence(): AgentPersistenceHandle | null;
    interrupt(): Promise<void>;
    revertConversation(input: {
        messageId: string;
    }): Promise<void>;
    close(): Promise<void>;
    private clearOmpSessionState;
    private clearOmpTurnState;
    private terminalizeActiveWork;
    private resetActiveTurn;
    listCommands(): Promise<AgentSlashCommand[]>;
    tryHandleOutOfBand(prompt: AgentPromptInput): {
        run(ctx: {
            emit: (event: AgentStreamEvent) => void;
        }): Promise<void>;
    } | null;
    setModel(modelId: string | null): Promise<void>;
    setThinkingOption(thinkingOptionId: string | null): Promise<void>;
    private emit;
    private currentTurnIdForEvent;
    private scheduleNoTurnPromptCompletion;
    private cancelNoTurnPromptCompletion;
    private completeNoTurnPrompt;
    private clearNoTurnBuffers;
    private emitBufferedNoTurnOutputs;
    private bufferNoTurnOutput;
    private parseSlashCommandInput;
    private executeCompactCommand;
    private executeAutoCompactCommand;
    private executeHandoffCommand;
    private handleExtensionUiRequest;
    private mapExtensionUiSideEffect;
    private handleCommandOutput;
    private handleExtraRuntimeEvent;
    private emitActiveToolCall;
    private emitTodoItem;
    private handleRuntimeEvent;
    private handleProcessExit;
    private handleSessionEvent;
    private handleToolExecutionEnd;
    private emitCompactionTimeline;
    private handleMessageUpdate;
    private handleMessageStart;
    private handleMessageEnd;
    private emitSkillPromptEcho;
    private emitToolCallEvent;
    private mapToolDetail;
    private completeTurn;
    private completeTurnAfterProviderIdle;
    private refreshState;
    private refreshAfterTurn;
}
export declare class OmpAgentClient implements AgentClient {
    readonly provider: AgentProvider;
    readonly capabilities: AgentCapabilityFlags;
    private readonly logger;
    private readonly runtimeSettings?;
    private readonly subagentCardScheduler?;
    private readonly providerIdleScheduler?;
    private readonly noTurnScheduler?;
    private readonly usagePollScheduler?;
    private readonly providerIdleDeadlineMs?;
    private readonly runtime?;
    constructor(options: OmpAgentClientOptions);
    private configureNativePaseoTools;
    private restoreFastMode;
    createSession(config: AgentSessionConfig, launchContext?: AgentLaunchContext): Promise<AgentSession>;
    resumeSession(handle: AgentPersistenceHandle, overrides?: Partial<AgentSessionConfig>, launchContext?: AgentLaunchContext, options?: AgentResumeSessionOptions): Promise<AgentSession>;
    private applyResumeModel;
    private buildRestartRuntime;
    fetchCatalog(options: FetchCatalogOptions, context?: ProviderRefreshContext): Promise<ProviderCatalog>;
    listFeatures(_config: AgentSessionConfig): Promise<AgentFeature[]>;
    listImportableSessions(options?: ListImportableSessionsOptions): Promise<ImportableProviderSession[]>;
    importSession(input: ImportProviderSessionInput, context: ImportProviderSessionContext): Promise<import("../../agent-sdk-types.js").ImportedProviderSession>;
    isAvailable(): Promise<boolean>;
    getDiagnostic(): Promise<{
        diagnostic: string;
    }>;
    private resolveLaunchMode;
    private resolveRuntime;
    private resolveOmpLaunch;
}
//# sourceMappingURL=agent.d.ts.map