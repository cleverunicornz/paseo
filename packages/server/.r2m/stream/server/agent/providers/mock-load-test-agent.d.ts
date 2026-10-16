import type { Logger } from "pino";
import type { AgentCapabilityFlags, AgentClient, AgentFeature, AgentLaunchContext, AgentMode, AgentPersistenceHandle, AgentPermissionRequest, AgentPermissionResponse, AgentPermissionResult, AgentPromptInput, AgentProvider, AgentRunOptions, AgentRunResult, AgentRuntimeInfo, AgentSession, AgentSessionConfig, AgentStreamEvent, FetchCatalogOptions, ImportableProviderSession, ImportProviderSessionContext, ImportProviderSessionInput, ProviderCatalog, SteerActiveTurnOptions, SteerResult } from "../agent-sdk-types.js";
export declare const MOCK_LOAD_TEST_PROVIDER_ID = "mock";
export declare const MOCK_LOAD_TEST_DEFAULT_MODEL_ID = "five-minute-stream";
export declare const MOCK_LOAD_TEST_HANDLED_COMMAND = "/mock handled-command";
export declare class MockLoadTestAgentClient implements AgentClient {
    private readonly logger?;
    readonly provider: AgentProvider;
    readonly capabilities: AgentCapabilityFlags;
    constructor(logger?: Logger | undefined);
    createSession(config: AgentSessionConfig, _launchContext?: AgentLaunchContext): Promise<AgentSession>;
    resumeSession(handle: AgentPersistenceHandle, overrides?: Partial<AgentSessionConfig>, _launchContext?: AgentLaunchContext): Promise<AgentSession>;
    fetchCatalog(_options: FetchCatalogOptions): Promise<ProviderCatalog>;
    listImportableSessions(): Promise<ImportableProviderSession[]>;
    importSession(input: ImportProviderSessionInput, context: ImportProviderSessionContext): Promise<import("../agent-sdk-types.js").ImportedProviderSession>;
    isAvailable(): Promise<boolean>;
    getDiagnostic(): Promise<{
        diagnostic: string;
    }>;
}
export declare class MockLoadTestAgentSession implements AgentSession {
    readonly provider: AgentProvider;
    readonly capabilities: AgentCapabilityFlags;
    readonly features: AgentFeature[];
    readonly id: string;
    private readonly usageSessionKey;
    private readonly listeners;
    private readonly history;
    private readonly logger?;
    private activeTurn;
    private pendingPermissions;
    private modeId;
    private modelId;
    private readonly assistantResponse;
    private readonly assistantResponses;
    private readonly streamingAssistantResponse;
    private readonly streamingAssistantIntervalMs;
    private readonly rewindError;
    private remainingPromptRejections;
    private remainingSteerFailures;
    constructor(options: {
        config: AgentSessionConfig;
        sessionId: string;
        logger?: Logger;
    });
    usageSession(): {
        provider: string;
        model: string | undefined;
        env: {};
        sessionKey: `${string}-${string}-${string}-${string}-${string}`;
    };
    run(prompt: AgentPromptInput, options?: AgentRunOptions): Promise<AgentRunResult>;
    startTurn(prompt: AgentPromptInput, options?: AgentRunOptions): Promise<{
        turnId: string;
    }>;
    tryHandleOutOfBand(prompt: AgentPromptInput): {
        run(ctx: {
            emit: (event: AgentStreamEvent) => void;
        }): Promise<void>;
    } | null;
    subscribe(callback: (event: AgentStreamEvent) => void): () => void;
    streamHistory(): AsyncGenerator<AgentStreamEvent>;
    getRuntimeInfo(): Promise<AgentRuntimeInfo>;
    getAvailableModes(): Promise<AgentMode[]>;
    getCurrentMode(): Promise<string | null>;
    setMode(modeId: string): Promise<void>;
    getPendingPermissions(): AgentPermissionRequest[];
    respondToPermission(requestId: string, response: AgentPermissionResponse): Promise<AgentPermissionResult | void>;
    describePersistence(): AgentPersistenceHandle | null;
    interrupt(): Promise<void>;
    steerActiveTurn(_prompt: AgentPromptInput, options: SteerActiveTurnOptions): Promise<SteerResult>;
    close(): Promise<void>;
    revertConversation(input: {
        messageId: string;
    }): Promise<void>;
    revertFiles(input: {
        messageId: string;
    }): Promise<void>;
    revertBoth(input: {
        messageId: string;
    }): Promise<void>;
    setModel(modelId: string | null): Promise<void>;
    private schedule;
    private emitTurnStarted;
    private failConfiguredRewind;
    private validateRewindTarget;
    private scheduleLargePayloadTurn;
    private scheduleFailedTurn;
    private scheduleSteeringReplayTurn;
    private scheduleStressTurn;
    private schedulePlanApprovalTurn;
    private scheduleQuestionPromptTurn;
    private scheduleSettledAssistantTurn;
    private scheduleStreamingAssistantTurn;
    private emitSettledAssistantTurn;
    private emitPlanApprovalTurn;
    private emitQuestionPromptTurn;
    private emitStressTurn;
    private emitLargePayloadTurn;
    private tick;
    private dispatchCycleEvent;
    private finishTurn;
    private finishTurnWithText;
    private emitTimeline;
    private emit;
    private remember;
    private keepFirstUserMessageHistory;
    private clearTurnTimer;
}
//# sourceMappingURL=mock-load-test-agent.d.ts.map