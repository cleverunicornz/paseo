import { type AgentStreamEvent } from "./agent-sdk-types.js";
export interface ForegroundTurnWaiter {
    turnId: string;
    callback: (event: AgentStreamEvent) => void;
    settled: boolean;
    settledPromise: Promise<void>;
    resolveSettled: () => void;
}
export interface PendingForegroundRun {
    token: string;
    kind: "foreground";
    stagedEvents: AgentStreamEvent[];
    start: {
        status: "pending";
    } | {
        status: "started";
        turnId: string;
    } | {
        status: "failed";
        error: string;
    };
    settled: boolean;
    settledPromise: Promise<void>;
    resolveSettled: () => void;
}
export interface AutonomousAgentRun {
    token: string;
    kind: "autonomous";
    turnId: string | null;
    started: true;
    settled: boolean;
    settledPromise: Promise<void>;
    resolveSettled: () => void;
}
export type TrackedAgentRun = PendingForegroundRun | AutonomousAgentRun;
export interface ForegroundRunAgentState {
    foregroundTurnWaiters: Set<ForegroundTurnWaiter>;
    finalizedForegroundTurnIds: Set<string>;
}
export declare class AgentRunState {
    private readonly runs;
    createPendingRun(agentId: string): PendingForegroundRun;
    getPendingRun(agentId: string): PendingForegroundRun | null;
    hasPendingRun(agentId: string): boolean;
    getRun(agentId: string): TrackedAgentRun | null;
    hasRun(agentId: string): boolean;
    getTurnId(agentId: string): string | null;
    trackAutonomousRun(agentId: string, turnId: string | null): TrackedAgentRun;
    settleTerminalRun(agentId: string, turnId: string | undefined): void;
    settleForegroundRun(agentId: string, token: string): void;
    clearAgentRun(agentId: string): void;
    createTurnStream(turnId: string): ForegroundTurnStream;
    addWaiter(agent: ForegroundRunAgentState, waiter: ForegroundTurnWaiter): void;
    deleteWaiter(agent: ForegroundRunAgentState, waiter: ForegroundTurnWaiter): void;
    settleWaiter(waiter: ForegroundTurnWaiter): void;
    getMatchingWaiters(agent: ForegroundRunAgentState, turnId: string | undefined): ForegroundTurnWaiter[];
    notifyWaiters(waiters: Iterable<ForegroundTurnWaiter>, event: AgentStreamEvent, options: {
        terminal: boolean;
    }): void;
    notifyAgentWaiters(agent: ForegroundRunAgentState, event: AgentStreamEvent, options?: {
        terminal?: boolean;
    }): void;
    cancelWaiters(agent: ForegroundRunAgentState, createEvent: (turnId: string) => AgentStreamEvent): void;
    rememberFinalizedTurn(agent: ForegroundRunAgentState, turnId: string): void;
    hasFinalizedTurn(agent: ForegroundRunAgentState, turnId: string): boolean;
    private clearRun;
}
export declare class ForegroundTurnStream {
    private readonly queue;
    private queueResolve;
    readonly waiter: ForegroundTurnWaiter;
    constructor(turnId: string);
    events(isTerminalEvent: (event: AgentStreamEvent) => boolean): AsyncGenerator<AgentStreamEvent>;
    private wake;
}
//# sourceMappingURL=agent-run-state.d.ts.map