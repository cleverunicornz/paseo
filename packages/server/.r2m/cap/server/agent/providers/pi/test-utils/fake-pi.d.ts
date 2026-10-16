import type { PiRuntime, PiRuntimeLaunch, PiRuntimeSession, PiStartSessionInput } from "../runtime.js";
import type { PiAgentMessage, PiModel, PiPromptAck, PiRpcSlashCommand, PiRuntimeEvent, PiSessionState, PiSessionStats } from "../rpc-types.js";
type FakePiSubagentSubscriptionLevel = "off" | "progress" | "events";
type FakePiSubagentStatus = "pending" | "running" | "completed" | "failed" | "aborted";
export interface FakePiSubagentSnapshot {
    id: string;
    index: number;
    agent: string;
    description?: string;
    status: FakePiSubagentStatus;
    task?: string;
    assignment?: string;
    sessionFile?: string;
    parentToolCallId?: string;
    lastUpdate?: number;
}
export interface FakePiSubagentMessagesSelector {
    subagentId?: string;
    sessionFile?: string;
    fromByte?: number;
}
export interface FakePiSubagentMessagesResult {
    sessionFile: string;
    fromByte: number;
    nextByte: number;
    reset: boolean;
    messages: PiAgentMessage[];
}
interface FakePiUserEntry {
    id: string;
    parentId: string | null;
    text: string;
}
export declare class FakePi implements PiRuntime {
    readonly recordedLaunches: PiRuntimeLaunch[];
    private readonly sessions;
    private readonly command;
    private readonly queuedCommands;
    private readonly queuedSessionSetups;
    private readonly removedModels;
    constructor(command?: [string, ...string[]]);
    startSession(input: PiStartSessionInput): Promise<FakePiSession>;
    queueCommands(commands: PiRpcSlashCommand[]): void;
    queueSessionSetup(setup: (session: FakePiSession) => void): void;
    removeModel(modelId: string): void;
    latestSession(): FakePiSession;
}
export declare class FakePiSession implements PiRuntimeSession {
    private readonly removedModels;
    readonly environment: Record<string, string>;
    readonly prompts: Array<{
        message: string;
        imageCount: number;
    }>;
    readonly steerCalls: Array<{
        message: string;
        imageCount: number;
    }>;
    steerError: Error | null;
    readonly controlRequests: string[];
    clearQueueError: Error | null;
    readonly compactRequests: Array<{
        customInstructions?: string;
    }>;
    readonly setAutoCompactionRequests: boolean[];
    readonly subagentSubscriptionRequests: FakePiSubagentSubscriptionLevel[];
    readonly subagentMessageRequests: FakePiSubagentMessagesSelector[];
    readonly setModelRequests: Array<{
        provider: string;
        modelId: string;
    }>;
    readonly setThinkingLevelRequests: string[];
    readonly treeNavigationRequests: string[];
    readonly handoffRequests: Array<{
        customInstructions?: string;
    }>;
    readonly sessionNameRequests: string[];
    readonly rawFrames: Array<object & {
        type: string;
    }>;
    treeUserEntries: FakePiUserEntry[];
    contextUserEntries: FakePiUserEntry[];
    abortRequested: boolean;
    readonly canceledExtensionUiRequests: string[];
    readonly extensionUiResponses: Array<{
        id: string;
        response: {
            value?: string;
            confirmed?: boolean;
            cancelled?: boolean;
        };
    }>;
    setModelResult: PiModel | null;
    models: PiModel[];
    messages: PiAgentMessage[];
    stats: PiSessionStats;
    commands: PiRpcSlashCommand[];
    subagents: FakePiSubagentSnapshot[];
    subagentSubscriptionError: Error | null;
    setSessionNameError: Error | null;
    compactError: Error | null;
    emitCompactEnd: boolean;
    getStateError: Error | null;
    getSessionStatsError: Error | null;
    promptAck: PiPromptAck;
    branchResponse: {
        text?: string;
        cancelled?: boolean;
    };
    readonly branchRequests: string[];
    state: PiSessionState;
    private readonly subscribers;
    private readonly subagentMessageResults;
    private nextHeldPrompt;
    private activeHeldPrompt;
    constructor(launch: PiRuntimeLaunch, removedModels?: ReadonlySet<string>);
    onEvent(callback: (event: PiRuntimeEvent) => void): () => void;
    prompt(message: string, images?: Array<{
        type: "image";
        data: string;
        mimeType: string;
    }>): Promise<PiPromptAck>;
    holdNextPrompt(): void;
    failHeldPrompt(error: Error): Promise<void>;
    steer(message: string, images?: Array<{
        type: "image";
        data: string;
        mimeType: string;
    }>): Promise<void>;
    clearQueue(): Promise<void>;
    compact(customInstructions?: string): Promise<void>;
    setAutoCompaction(enabled: boolean): Promise<void>;
    abort(): Promise<void>;
    getState(): Promise<PiSessionState>;
    getMessages(): Promise<PiAgentMessage[]>;
    getAvailableModels(_timeoutMs?: number | null): Promise<PiModel[]>;
    setModel(provider: string, modelId: string): Promise<PiModel>;
    setThinkingLevel(level: string): Promise<void>;
    getSessionStats(): Promise<PiSessionStats>;
    setSubagentSubscription(level: FakePiSubagentSubscriptionLevel): Promise<void>;
    getSubagents(): Promise<FakePiSubagentSnapshot[]>;
    getSubagentMessages(selector: FakePiSubagentMessagesSelector): Promise<FakePiSubagentMessagesResult>;
    queueSubagentMessages(result: FakePiSubagentMessagesResult): void;
    getCommands(): Promise<PiRpcSlashCommand[]>;
    sendRawFrame(frame: object & {
        type: string;
    }): void;
    request(command: {
        type: string;
        [key: string]: unknown;
    }): Promise<unknown>;
    respondToExtensionUiRequest(id: string, response: {
        value?: string;
        confirmed?: boolean;
        cancelled?: boolean;
    }): void;
    cancelExtensionUiRequest(id: string): void;
    close(): Promise<void>;
    emit(event: PiRuntimeEvent): void;
    finishAgentRun({ message, willRetry }: {
        message: PiAgentMessage;
        willRetry: boolean;
    }): void;
    settleTurn(): void;
    finishTurn(message?: PiAgentMessage): void;
    finishLegacyTurn(message?: PiAgentMessage): void;
    finishSubmittedUserMessage(entry: FakePiUserEntry): void;
    private handleTreeNavigationCommand;
    private handleEntryCaptureCommand;
    emitEntryCapture(requestId?: string, reason?: string): void;
    private emitExtensionCommandResult;
}
export {};
//# sourceMappingURL=fake-pi.d.ts.map