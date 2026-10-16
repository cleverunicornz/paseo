import type { AgentUsage } from "../../agent-sdk-types.js";
import type { OmpSessionStats } from "./rpc-types.js";
export interface OmpUsagePollScheduler {
    schedulePoll(callback: () => void): () => void;
}
interface OmpUsagePollerOptions {
    readStats(): Promise<OmpSessionStats>;
    onUsage(usage: AgentUsage, turnId?: string): void;
    onPollError(error: unknown): void;
    scheduler?: OmpUsagePollScheduler;
}
export declare class OmpUsagePoller {
    private readonly options;
    private readonly scheduler;
    private active;
    private closed;
    private generation;
    private cancelScheduledPoll;
    private lastUsage;
    constructor(options: OmpUsagePollerOptions);
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