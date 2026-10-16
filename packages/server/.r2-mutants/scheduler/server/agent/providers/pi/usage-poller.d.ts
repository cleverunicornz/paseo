import type { AgentUsage } from "../../agent-sdk-types.js";
import type { PiSessionStats } from "./rpc-types.js";
export interface PiUsagePollScheduler {
    schedulePoll(callback: () => void): () => void;
}
interface PiUsagePollerOptions {
    readStats(): Promise<PiSessionStats>;
    onUsage(usage: AgentUsage, turnId?: string): void;
    onPollError(error: unknown): void;
    scheduler?: PiUsagePollScheduler;
}
export declare class PiUsagePoller {
    private readonly options;
    private readonly scheduler;
    private active;
    private closed;
    private generation;
    private cancelScheduledPoll;
    private lastUsage;
    constructor(options: PiUsagePollerOptions);
    startTurn(): void;
    stopTurn(): void;
    completeTurn(turnId?: string): Promise<void>;
    close(): void;
    private invalidatePendingWork;
    private schedule;
    private poll;
    private takeChangedUsage;
    private publishUsage;
}
export {};
//# sourceMappingURL=usage-poller.d.ts.map