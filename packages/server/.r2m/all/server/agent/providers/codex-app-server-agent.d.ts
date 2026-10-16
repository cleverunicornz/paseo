import { type AgentCapabilityFlags, type AgentClient, type AgentCreateSessionOptions, type AgentFeature, type AgentLaunchContext, type AgentResumeSessionOptions, type AgentMode, type AgentPersistenceHandle, type AgentPermissionRequest, type AgentPermissionResponse, type AgentPermissionResult, type AgentProviderNotice, type AgentPromptContentBlock, type AgentPromptInput, type AgentRunOptions, type AgentRunResult, type AgentRuntimeInfo, type AgentSession, type AgentSessionConfig, type SteerActiveTurnOptions, type SteerResult, type AgentSlashCommand, type AgentStreamEvent, type AgentTimelineItem, type ToolCallTimelineItem, type AgentUsage, type FetchCatalogOptions, type ImportableProviderSession, type ImportProviderSessionContext, type ImportProviderSessionInput, type ListImportableSessionsOptions, type ProviderCatalog, type ProviderRefreshContext, type ResolveAgentDefaultModeInput } from "../agent-sdk-types.js";
import type { Logger } from "pino";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { Dirent } from "node:fs";
import { type ProviderRuntimeSettings } from "../provider-launch-config.js";
import { type CodexThreadForkParams, type CodexThreadForkResponse, type CodexThreadRollbackParams, type CodexThreadRollbackResponse, type CodexAppServerTraceContext } from "./codex/app-server-transport.js";
import type { WorkspaceGitService } from "../../workspace-git-service.js";
declare const CODEX_PROVIDER: "codex";
interface CodexAppServerClientLike {
    request(method: string, params?: unknown): Promise<unknown>;
    forkThread?(params: CodexThreadForkParams): Promise<CodexThreadForkResponse>;
    rollbackThread?(params: CodexThreadRollbackParams): Promise<CodexThreadRollbackResponse>;
    notify(method: string, params?: unknown): void;
    dispose(): Promise<void>;
}
interface CodexAppServerAgentDeps {
    environment?: Record<string, string>;
    workspaceGitService?: Pick<WorkspaceGitService, "resolveRepoRoot">;
    customProvider?: {
        id: string;
        label: string;
        extends: string;
    };
    customCodexConfig?: CodexCustomProviderConfig | null;
    codexHome?: string;
    _createCodexClient?: (child: ChildProcessWithoutNullStreams, logger: Logger, getTraceContext: () => CodexAppServerTraceContext) => CodexAppServerClientLike;
    resolveSlashCommandInvocation?: (prompt: AgentPromptInput) => Promise<{
        commandName: string;
        args?: string;
    } | null>;
}
export declare function normalizeCodexOutputSchema(schema: unknown): Record<string, unknown>;
export declare function codexMicrosoftStoreBinaryCandidates(packageRoot: string, entries: Dirent[]): string[];
export declare function findCodexMicrosoftStoreBinary(): Promise<string | null>;
export declare function findDefaultCodexBinary(): Promise<string | null>;
export declare function listCodexSkills(cwd: string, codexHome: string, workspaceGitService?: Pick<WorkspaceGitService, "resolveRepoRoot">): Promise<AgentSlashCommand[]>;
export declare function toAgentUsage(tokenUsage: unknown): AgentUsage | undefined;
export declare function planStepsToMarkdown(steps: Array<{
    step: string;
    status: string;
}>): string;
export declare function mapCodexPlanUpdateToTodo(steps: Array<{
    step?: string | null;
    status?: string | null;
}>): Extract<AgentTimelineItem, {
    type: "todo";
}>;
export declare function mapCodexPlanToToolCall(params: {
    callId: string;
    text: string;
}): ToolCallTimelineItem | null;
interface CodexQuestionOption {
    label: string;
    description?: string;
}
interface CodexQuestionPrompt {
    id: string;
    header: string;
    question: string;
    options: CodexQuestionOption[];
    multiSelect?: boolean;
    isOther?: boolean;
    isSecret?: boolean;
}
export declare function normalizeCodexQuestionPrompts(raw: unknown): CodexQuestionPrompt[];
export declare function formatCodexQuestionPrompts(questions: CodexQuestionPrompt[]): string;
export declare function mapCodexQuestionRequestToToolCall(params: {
    callId: string;
    questions: CodexQuestionPrompt[];
    status: ToolCallTimelineItem["status"];
    answers?: Record<string, string[]>;
    error?: unknown;
}): ToolCallTimelineItem;
export declare function mapCodexPatchNotificationToToolCall(params: {
    callId?: string | null;
    changes: unknown;
    cwd?: string | null;
    stdout?: string | null;
    stderr?: string | null;
    success?: boolean | null;
    running: boolean;
}): ToolCallTimelineItem | null;
export declare function threadItemToTimeline(item: unknown, options?: {
    includeUserMessage?: boolean;
    cwd?: string | null;
}): AgentTimelineItem | null;
export declare function forkCodexThread(client: CodexAppServerClientLike, params: CodexThreadForkParams): Promise<CodexThreadForkResponse>;
export declare function rollbackCodexThread(client: CodexAppServerClientLike, params: CodexThreadRollbackParams): Promise<CodexThreadRollbackResponse>;
interface CodexSkillPromptBlock {
    type: "skill";
    name: string;
    path: string;
}
type CodexPromptContentBlock = AgentPromptContentBlock | CodexSkillPromptBlock;
type CodexPromptInput = string | CodexPromptContentBlock[];
interface CodexTextElement {
    byteRange: {
        start: number;
        end: number;
    };
    placeholder: string | null;
}
type CodexAppServerUserInput = {
    type: "text";
    text: string;
    text_elements: CodexTextElement[];
} | {
    type: "localImage";
    path: string;
} | CodexSkillPromptBlock;
export declare function codexAppServerTurnInputFromPrompt(prompt: CodexPromptInput, logger: Logger): Promise<CodexAppServerUserInput[]>;
export declare function buildCodexAppServerEnv(runtimeSettings?: ProviderRuntimeSettings, launchEnv?: Record<string, string>): import("../../paseo-env.js").ExternalProcessEnv;
interface CodexCustomProviderConfig {
    model_provider: string;
    model_providers: Record<string, Record<string, unknown>>;
}
export declare class CodexAppServerAgentSession implements AgentSession {
    private readonly resumeHandle;
    private readonly spawnAppServer;
    private readonly deps;
    private readonly ephemeral;
    private readonly goalsEnabled;
    private readonly autoReviewEnabled;
    private readonly agentId?;
    private readonly initialResumePurpose;
    readonly provider: "codex";
    readonly capabilities: AgentCapabilityFlags;
    private readonly logger;
    private readonly config;
    private readonly asyncQuestions;
    private readonly codexHome;
    private currentMode;
    private hasWorkflowModeOverride;
    private readonly providerOptions;
    private resolvedWorkspaceWrite;
    private resolvedSandboxPolicy;
    private currentThreadId;
    private currentTurnId;
    private pendingForegroundTurnIdentification;
    private pendingForegroundStart;
    private client;
    private threadRollbackAvailable;
    private readonly subscribers;
    private nextTurnOrdinal;
    private activeForegroundTurnId;
    private activeClientMessageId;
    private cachedRuntimeInfo;
    private serviceTier;
    private speedModels;
    private planModeEnabled;
    private historyPending;
    private persistedHistory;
    private loadingPersistedHistory;
    private persistedProviderSubagentEvents;
    private pendingPermissions;
    private mcpElicitationPermissionIds;
    private pendingPermissionHandlers;
    private resolvedPermissionRequests;
    private pendingAgentMessages;
    private pendingReasoning;
    private pendingCommandOutputDeltas;
    private pendingFileChangeOutputDeltas;
    private pendingAssistantMessageBoundary;
    private terminalCommandByProcessId;
    private pendingUnlabeledTerminalInteractions;
    private nextTerminalInteractionOrdinal;
    private emittedTerminalInteractionKeys;
    private emittedExecCommandStartedCallIds;
    private emittedExecCommandCompletedCallIds;
    private emittedItemStartedIds;
    private emittedItemCompletedIds;
    private emittedProviderSubagentUserMessageKeys;
    private subAgentCallsByCallId;
    private subAgentCallIdByChildThreadId;
    private pendingSubAgentNotificationsByThreadId;
    private warnedUnknownNotificationMethods;
    private warnedInvalidNotificationPayloads;
    private warnedIncompleteEditToolCallIds;
    private latestUsage;
    private latestPlanResult;
    private readonly userMessageTurnIndexes;
    private readonly userMessageTurnIds;
    private readonly userMessageProviderTurnIds;
    private pendingManualCompactionStarts;
    private compactionTriggerByItemId;
    private pendingRootCompactionItemIds;
    private pendingAnonymousRootCompactions;
    private unpairedCompactionNotificationCompletions;
    private unpairedCompactionItemCompletions;
    private connectionState;
    private connectionPromise;
    private closed;
    private collaborationModes;
    private resolvedCollaborationMode;
    private cachedSkills;
    private readonly usageSessionKey;
    private readonly harnessEnvironment;
    usageSession(): {
        provider: string;
        model: string | undefined;
        env: Record<string, string>;
        sessionKey: `${string}-${string}-${string}-${string}-${string}`;
    } | null;
    constructor(config: AgentSessionConfig, resumeHandle: {
        sessionId: string;
        metadata?: Record<string, unknown>;
    } | null, logger: Logger, spawnAppServer: () => Promise<ChildProcessWithoutNullStreams>, deps?: CodexAppServerAgentDeps, ephemeral?: boolean, goalsEnabled?: boolean, autoReviewEnabled?: boolean, agentId?: string | undefined, initialResumePurpose?: "interactive" | "history");
    get id(): string | null;
    get features(): AgentFeature[];
    connect(): Promise<void>;
    private establishConnection;
    private loadResolvedWorkspaceWrite;
    private rememberResolvedSandboxPolicy;
    private createClosedError;
    private traceContext;
    private handleUnexpectedTermination;
    private loadCollaborationModes;
    private loadSkills;
    private findCollaborationMode;
    private hasPlanCollaborationMode;
    private resolveCollaborationMode;
    private refreshResolvedCollaborationMode;
    private currentServiceTiers;
    private reconcileServiceTier;
    private applyFeatureValue;
    private rememberPlanResult;
    private emitSyntheticPlanApprovalRequest;
    /**
     * Prepare the session for plan implementation by disabling plan mode
     * and returning the implementation prompt. The caller is responsible for
     * starting the turn through the normal streamAgent path.
     */
    private preparePlanImplementation;
    private registerRequestHandlers;
    private readArchivedHistory;
    private loadPersistedHistory;
    private loadPersistedSubAgentHistories;
    private ensureThreadLoaded;
    private parseSlashCommandInput;
    private resolveSlashCommandInvocation;
    private buildCommandPromptInput;
    private buildTurnStartParams;
    private applyTurnWorkflowPolicy;
    private logTurnStartSummary;
    run(prompt: AgentPromptInput, options?: AgentRunOptions): Promise<AgentRunResult>;
    startTurn(prompt: AgentPromptInput, options?: AgentRunOptions): Promise<{
        turnId: string;
    }>;
    steerActiveTurn(prompt: AgentPromptInput, options: SteerActiveTurnOptions): Promise<SteerResult>;
    private matchesSteerAdmission;
    private rememberCodexUserMessageTurn;
    private resetCodexUserMessageTurns;
    private truncateCodexUserMessageTurns;
    private codexUserMessageTurns;
    subscribe(callback: (event: AgentStreamEvent) => void): () => void;
    streamHistory(): AsyncGenerator<AgentStreamEvent>;
    getRuntimeInfo(): Promise<AgentRuntimeInfo>;
    getAvailableModes(): Promise<AgentMode[]>;
    getCurrentMode(): Promise<string | null>;
    setMode(modeId: string): Promise<void | AgentProviderNotice>;
    setModel(modelId: string | null): Promise<void>;
    setThinkingOption(thinkingOptionId: string | null): Promise<void | AgentProviderNotice>;
    setFeature(featureId: string, value: unknown): Promise<void>;
    getPendingPermissions(): AgentPermissionRequest[];
    respondToPermission(requestId: string, response: AgentPermissionResponse): Promise<AgentPermissionResult | void>;
    private respondToAsyncQuestion;
    private handlePlanPermissionResponse;
    private dismissPendingPlanApprovals;
    private clearPendingPermissionsForSteer;
    private resolvePlanPermission;
    private recordPlanOutcome;
    private emitDeniedToolCallTimelineEvent;
    describePersistence(): {
        provider: typeof CODEX_PROVIDER;
        sessionId: string;
        nativeHandle: string;
        metadata: Record<string, unknown>;
    } | null;
    revertConversation(input: {
        messageId: string;
    }): Promise<void>;
    interrupt(): Promise<void>;
    close(): Promise<void>;
    private clearPendingPermissions;
    private disposeClient;
    listCommands(): Promise<AgentSlashCommand[]>;
    tryHandleOutOfBand(prompt: AgentPromptInput): {
        run(ctx: {
            emit: (event: AgentStreamEvent) => void;
        }): Promise<void>;
    } | null;
    private executeCompactCommand;
    private executeGoalSubcommand;
    private resolveModelAndThinking;
    private applyDefaultModelAndThinking;
    private ensureThread;
    private buildThreadStartRequest;
    private buildCodexInnerConfig;
    private buildUserInput;
    private emitEvent;
    private notifySubscribers;
    private createTurnId;
    private handleNotification;
    private dispatchSubAgentNotification;
    private dispatchParsedNotification;
    private resolveCodexThreadRoute;
    private bufferPendingSubAgentNotification;
    private replayPendingSubAgentNotifications;
    private handleThreadStateNotification;
    private traceParsedNotification;
    private getSubAgentCallIdForThread;
    private registerSubAgentToolCall;
    private handleRegisteredSubAgentActivity;
    private handleCompletedContextCompactionItem;
    private handleCompletedSpecialItem;
    private upsertSubAgentChildItem;
    private emitCodexToolTimelineItem;
    private getSubAgentChildTimeline;
    private emitSubAgentActivityUpdate;
    private emitProviderSubagentUpsert;
    private emitProviderSubagentTimeline;
    private emitCompletedProviderSubagentItem;
    private emitStartedProviderSubagentItem;
    private emitProviderSubagentTimelineItems;
    private handleSubAgentChildItemCompleted;
    private handleSubAgentContextCompactionItem;
    private shouldSkipCompletedThreadItem;
    private handleCodexDeltaNotification;
    private handleThreadStartedNotification;
    private handleTurnStartedNotification;
    private handleTurnCompletedNotification;
    private resetTurnTrackingState;
    private handlePlanUpdatedNotification;
    private handleTokenUsageUpdatedNotification;
    private resolveContextCompactionTrigger;
    private trackPendingRootCompaction;
    private consumePendingRootCompaction;
    private completePendingRootCompactions;
    private createContextCompactionTimelineItem;
    private isContextCompactionItem;
    private isUserMessageItem;
    private handleThreadRolledBackNotification;
    private handleContextCompactedNotification;
    private handleExecCommandStartedNotification;
    private handleExecCommandCompletedNotification;
    private handleTerminalInteractionNotification;
    private handlePatchApplyStartedNotification;
    private handlePatchApplyCompletedNotification;
    private receiveAsyncQuestion;
    private dismissInterruptedAsyncQuestions;
    private reconcileAsyncQuestionsAfterRewind;
    private handleItemCompletedNotification;
    private consumeStreamedTextCompletion;
    private emitMissingFinalTextSuffix;
    private buildMissingFinalTextSuffix;
    private applyBufferedDeltaTextToTimelineItem;
    private handleItemStartedNotification;
    private handleUserMessageItem;
    private warnUnknownNotificationMethod;
    private warnInvalidNotificationPayload;
    private appendOutputDeltaChunk;
    private consumeOutputDelta;
    private rememberTerminalProcessForCommand;
    private rememberTerminalProcessForItem;
    private rememberTerminalProcess;
    private createTerminalInteractionCallId;
    private shouldEmitTerminalInteractionKey;
    private warnOnIncompleteEditToolCall;
    private handleCommandApprovalRequest;
    private handleFileChangeApprovalRequest;
    private handleToolApprovalRequest;
    private handleMcpElicitationRequest;
}
export declare class CodexAppServerAgentClient implements AgentClient {
    private readonly logger;
    private readonly runtimeSettings?;
    private readonly deps;
    readonly provider: "codex";
    readonly capabilities: AgentCapabilityFlags;
    private goalsEnabledPromise;
    private autoReviewEnabledPromise;
    constructor(logger: Logger, runtimeSettings?: ProviderRuntimeSettings | undefined, deps?: CodexAppServerAgentDeps);
    private sessionDeps;
    private customProviderConfig;
    private resolveGoalsEnabled;
    private resolveAutoReviewEnabled;
    private probeAutoReviewEnabled;
    private spawnAppServer;
    createSession(config: AgentSessionConfig, launchContext?: AgentLaunchContext, options?: AgentCreateSessionOptions): Promise<AgentSession>;
    resumeSession(handle: {
        sessionId: string;
        metadata?: Record<string, unknown>;
    }, overrides?: Partial<AgentSessionConfig>, launchContext?: AgentLaunchContext, options?: AgentResumeSessionOptions): Promise<AgentSession>;
    listImportableSessions(options?: ListImportableSessionsOptions): Promise<ImportableProviderSession[]>;
    importSession(input: ImportProviderSessionInput, context: ImportProviderSessionContext): Promise<import("../agent-sdk-types.js").ImportedProviderSession>;
    getCatalogCacheKey(_options: FetchCatalogOptions): Promise<string>;
    fetchCatalog(_options: FetchCatalogOptions, context?: ProviderRefreshContext): Promise<ProviderCatalog>;
    resolveDefaultModeId(input: ResolveAgentDefaultModeInput): Promise<string>;
    private fetchModelsFromAppServer;
    archiveNativeSession(handle: AgentPersistenceHandle): Promise<void>;
    unarchiveNativeSession(handle: AgentPersistenceHandle): Promise<void>;
    private updateNativeThreadArchiveState;
    isAvailable(): Promise<boolean>;
    getDiagnostic(): Promise<{
        diagnostic: string;
    }>;
}
export {};
//# sourceMappingURL=codex-app-server-agent.d.ts.map