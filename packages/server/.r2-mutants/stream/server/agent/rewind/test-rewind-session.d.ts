import type { AgentCapabilityFlags, AgentPermissionRequest, AgentPermissionResponse, AgentPersistenceHandle, AgentProvider, AgentRunResult, AgentSession, AgentStreamEvent, AgentTimelineItem } from "../agent-sdk-types.js";
export declare const REWIND_TEST_CAPABILITIES: AgentCapabilityFlags;
export interface RecordedRewind {
    mode: "conversation" | "files" | "both";
    messageId: string;
}
export declare class FakeRewindSession implements AgentSession {
    private readonly waitBeforeHistory?;
    readonly provider: AgentProvider;
    readonly id = "fake-rewind-session";
    readonly capabilities: AgentCapabilityFlags;
    readonly recordedRewinds: RecordedRewind[];
    aborted: boolean;
    historyReadCount: number;
    history: AgentTimelineItem[];
    private subscribers;
    private activeTurnId;
    constructor(waitBeforeHistory?: (() => Promise<void>) | undefined);
    run(): Promise<AgentRunResult>;
    startTurn(): Promise<{
        turnId: string;
    }>;
    subscribe(callback: (event: AgentStreamEvent) => void): () => void;
    streamHistory(): AsyncGenerator<AgentStreamEvent>;
    getRuntimeInfo(): Promise<{
        provider: string;
        sessionId: string;
    }>;
    getAvailableModes(): Promise<never[]>;
    getCurrentMode(): Promise<null>;
    setMode(): Promise<void>;
    getPendingPermissions(): AgentPermissionRequest[];
    respondToPermission(_requestId: string, _response: AgentPermissionResponse): Promise<void>;
    describePersistence(): AgentPersistenceHandle;
    interrupt(): Promise<void>;
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
    private emit;
}
//# sourceMappingURL=test-rewind-session.d.ts.map