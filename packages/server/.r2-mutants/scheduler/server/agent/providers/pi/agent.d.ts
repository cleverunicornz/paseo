import type { Logger } from "pino";
import { z } from "zod";
import { type AgentCapabilityFlags, type AgentClient, type AgentFeature, type AgentLaunchContext, type AgentMode, type AgentModelDefinition, type AgentPermissionRequest, type AgentPermissionResponse, type AgentProviderNotice, type AgentPersistenceHandle, type AgentPromptInput, type AgentProvider, type AgentRunOptions, type AgentRunResult, type AgentRuntimeInfo, type AgentSession, type AgentSessionConfig, type AgentSlashCommand, type AgentStreamEvent, type FetchCatalogOptions, type SteerActiveTurnOptions, type SteerResult, type ImportableProviderSession, type ImportProviderSessionContext, type ImportProviderSessionInput, type ListImportableSessionsOptions, type ProviderCatalog, type ProviderRefreshContext } from "../../agent-sdk-types.js";
import { type ProviderRuntimeSettings } from "../../provider-launch-config.js";
import type { PiRuntime, PiRuntimeSession } from "./runtime.js";
import type { PiSessionState } from "./rpc-types.js";
import { type PiUsagePollScheduler } from "./usage-poller.js";
export declare const PiProviderOptionsSchema: z.ZodObject<{
    sessionDir: z.ZodOptional<z.ZodString>;
    rpcTimeoutMs: z.ZodDefault<z.ZodNumber>;
    extensionTimeoutMs: z.ZodDefault<z.ZodNumber>;
}, z.core.$strict>;
export interface PiRpcAgentClientOptions {
    logger: Logger;
    runtimeSettings?: ProviderRuntimeSettings;
    runtime?: PiRuntime;
    usagePollScheduler?: PiUsagePollScheduler;
}
interface StartTurnResult {
    turnId: string;
}
interface PiRpcAgentSessionOptions {
    runtimeSession: PiRuntimeSession;
    config: AgentSessionConfig;
    initialState: PiSessionState;
    capabilities: AgentCapabilityFlags;
    currentModeId?: string | null;
    cleanup?: () => void;
    extensionTimeoutMs?: number;
    logger: Logger;
    usagePollScheduler?: PiUsagePollScheduler;
}
export declare function transformPiModels(models: AgentModelDefinition[]): AgentModelDefinition[];
export declare class PiRpcAgentSession implements AgentSession {
    readonly provider: AgentProvider;
    readonly capabilities: AgentCapabilityFlags;
    private readonly subscribers;
    private readonly activeToolCalls;
    private readonly pendingExtensionUiRequests;
    private readonly extensionHost;
    private activeTurnId;
    private activeClientMessageId;
    private activeAssistantMessageId;
    private activeTurnStarted;
    private activeTurnStartedEmitted;
    private pendingSettledMessages;
    private activeNoTurnPromptText;
    private readonly pendingNoTurnOutputs;
    private activePromptRequestId;
    private readonly pendingPromptResults;
    private readonly pendingSteerSubmissions;
    currentLeafOverrideId: string | null | undefined;
    private readonly contextUserEntries;
    private readonly treeUserEntriesById;
    private readonly pendingExtensionResults;
    private outOfBandCompactionEmit;
    private outOfBandCompactionStarted;
    private outOfBandCompactionCompleted;
    private commandCache;
    private state;
    private readonly currentModeId;
    private readonly logger;
    private readonly usagePoller;
    private closed;
    private readonly closeController;
    private readonly pendingExtensionHydrations;
    private interruptingTurn;
    private readonly usageSessionKey;
    usageSession(): {
        provider: string;
        model: string | undefined;
        env: Record<string, string>;
        sessionKey: `${string}-${string}-${string}-${string}-${string}`;
    } | null;
    constructor(options: PiRpcAgentSessionOptions);
    private readonly runtimeSession;
    private readonly config;
    private readonly cleanup?;
    private readonly extensionTimeoutMs;
    get id(): string | null;
    run(prompt: AgentPromptInput, options?: AgentRunOptions): Promise<AgentRunResult>;
    startTurn(prompt: AgentPromptInput, options?: AgentRunOptions): Promise<StartTurnResult>;
    steerActiveTurn(prompt: AgentPromptInput, options: SteerActiveTurnOptions): Promise<SteerResult>;
    private clearPendingPermissionsForSteer;
    private takePendingSteerSubmission;
    subscribe(callback: (event: AgentStreamEvent) => void): () => void;
    streamHistory(): AsyncGenerator<AgentStreamEvent>;
    getRuntimeInfo(): Promise<AgentRuntimeInfo>;
    getAvailableModes(): Promise<AgentMode[]>;
    getCurrentMode(): Promise<string | null>;
    setMode(_modeId: string): Promise<void | AgentProviderNotice>;
    getPendingPermissions(): AgentPermissionRequest[];
    respondToPermission(requestId: string, response: AgentPermissionResponse): Promise<void>;
    describePersistence(): AgentPersistenceHandle | null;
    interrupt(): Promise<void>;
    revertConversation(input: {
        messageId: string;
    }): Promise<void>;
    private runPiTreeExtensionCommand;
    close(): Promise<void>;
    listCommands(): Promise<AgentSlashCommand[]>;
    tryHandleOutOfBand(prompt: AgentPromptInput): {
        run(ctx: {
            emit: (event: AgentStreamEvent) => void;
        }): Promise<void>;
    } | null;
    setModel(modelId: string | null): Promise<void>;
    setThinkingOption(thinkingOptionId: string | null): Promise<void>;
    private emit;
    private emitExtensionOutput;
    private currentTurnIdForEvent;
    private completeNoTurnPrompt;
    private completePromptIfHandledWithoutTurn;
    private clearNoTurnBuffers;
    private emitBufferedNoTurnOutputs;
    private bufferNoTurnOutput;
    private parseSlashCommandInput;
    private executeCompactCommand;
    private executeAutoCompactCommand;
    private requestEntryCapture;
    private waitForExtensionResult;
    private resolveExtensionResult;
    private rejectExtensionResult;
    private rejectAllExtensionResults;
    private recordCapturedUserEntries;
    private handleSubmittedUserEntryMarker;
    private handleEntryCaptureMarker;
    private handleCommandResultMarker;
    private handleExtensionUiRequest;
    private handleCommandOutput;
    private handleRuntimeEvent;
    private handleProcessExit;
    private handleSessionEvent;
    private handleTurnBoundaryEvent;
    private handleToolExecutionEnd;
    private emitCompactionTimeline;
    private handleMessageUpdate;
    private handleMessageStart;
    private handleMessageEnd;
    private emitToolCallEvent;
    private completeTurn;
    private refreshState;
    private refreshAfterTurn;
}
export declare class PiRpcAgentClient implements AgentClient {
    readonly provider: AgentProvider;
    readonly capabilities: AgentCapabilityFlags;
    private readonly logger;
    private readonly runtimeSettings?;
    private readonly runtime?;
    private readonly usagePollScheduler?;
    constructor(options: PiRpcAgentClientOptions);
    createSession(config: AgentSessionConfig, launchContext?: AgentLaunchContext): Promise<AgentSession>;
    resumeSession(handle: AgentPersistenceHandle, overrides?: Partial<AgentSessionConfig>, launchContext?: AgentLaunchContext): Promise<AgentSession>;
    private applyResumeModel;
    fetchCatalog(options: FetchCatalogOptions, context?: ProviderRefreshContext): Promise<ProviderCatalog>;
    listFeatures(_config: AgentSessionConfig): Promise<AgentFeature[]>;
    listImportableSessions(options?: ListImportableSessionsOptions): Promise<ImportableProviderSession[]>;
    importSession(input: ImportProviderSessionInput, context: ImportProviderSessionContext): Promise<import("../../agent-sdk-types.js").ImportedProviderSession>;
    isAvailable(): Promise<boolean>;
    getDiagnostic(): Promise<{
        diagnostic: string;
    }>;
    private resolveRuntime;
    private prepareMcpInjection;
    private detectMcpSupport;
    private resolvePiLaunch;
}
export {};
//# sourceMappingURL=agent.d.ts.map