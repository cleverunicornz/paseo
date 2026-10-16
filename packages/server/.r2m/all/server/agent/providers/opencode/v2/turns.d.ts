import type { OpenCodeEvent, SessionInfo, SessionMessageInfo } from "@opencode/client";
import type { AgentPromptInput, AgentRunOptions, AgentStreamEvent, SteerActiveTurnOptions, SteerResult } from "../../../agent-sdk-types.js";
import type { V2Api } from "./api.js";
interface TurnSnapshot {
    info: SessionInfo;
    history: SessionMessageInfo[];
}
interface TurnOptions {
    client(): V2Api;
    id: string;
    cwd: string;
    signal: AbortSignal;
    emit(event: AgentStreamEvent): void;
    reconcile(): Promise<TurnSnapshot>;
    clearPermissions(): Promise<void>;
    reportReconciliationError(error: unknown): void;
}
export declare class SessionTurns {
    private readonly options;
    private turn;
    private stopping;
    private stopFailed;
    private revision;
    private execution;
    private sequence;
    private refresh;
    private dirty;
    private retryTimer;
    constructor(options: TurnOptions);
    get id(): string | undefined;
    get hasStructuredOutput(): boolean;
    fail(error: Error): void;
    private release;
    close(): void;
    private createTurn;
    startTurn(prompt: AgentPromptInput, options?: AgentRunOptions): Promise<{
        turnId: string;
    }>;
    private submit;
    observe(event: OpenCodeEvent): void;
    requestDenied(): void;
    private requestReconciliation;
    private scheduleRecovery;
    reconcile(): Promise<void>;
    private drainReconciliation;
    private reconcileTurn;
    private dispatch;
    private finish;
    private readExecution;
    private promptInput;
    steerActiveTurn(prompt: AgentPromptInput, options: SteerActiveTurnOptions): Promise<SteerResult>;
    interrupt(): Promise<void>;
    private observeActiveTurn;
}
export {};
//# sourceMappingURL=turns.d.ts.map