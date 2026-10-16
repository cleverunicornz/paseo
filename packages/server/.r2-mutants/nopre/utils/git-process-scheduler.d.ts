export interface GitProcessPolicy {
    maxProcessesPerSecond: number;
    maxProcessConcurrency: number;
    /**
     * The largest number of queued commands before the scheduler stops accepting
     * new ones. It bounds only submissions of the `background` class; a
     * `foreground` submission is never refused for depth, because a command an
     * agent or a user asked for is work, and refusing it drops that work.
     *
     * A five-minute reconciliation sweep of a large estate once queued 907
     * commands with no ceiling and starved interactive work for minutes. The
     * sweep, not the interactive command, is what yields: past this bound a
     * background submission is refused, and the caller treats the refusal as a
     * deferral (skip this tick, retry the next).
     */
    maxQueueDepth: number;
}
export declare const DEFAULT_GIT_PROCESS_POLICY: GitProcessPolicy;
export interface ScheduledGitProcess<T> {
    result: Promise<T>;
    exited: Promise<void>;
}
export type GitProcessPriority = "normal" | "high";
/**
 * What asked for a command. `foreground` is the default and is never refused
 * for queue depth: it is the work an agent or a user asked for. `background`
 * is the reconciliation sweep's own reads, which yield when the queue is deep.
 */
export type GitProcessClass = "foreground" | "background";
/**
 * Thrown when the scheduler's wait queue is at its bound and the submission is
 * of the `background` class. The command never ran: it is refused, not queued,
 * so a sweep cannot grow the backlog. The refusal is the yield signal - the
 * sweep defers the tick and retries. A `foreground` submission never throws
 * this: refusing it would drop work an agent or a user asked for.
 */
export declare class GitProcessQueueFullError extends Error {
    readonly maxQueueDepth: number;
    readonly code = "GIT_PROCESS_QUEUE_FULL";
    constructor(maxQueueDepth: number);
}
export declare function resolveGitProcessPolicy(input: {
    env: NodeJS.ProcessEnv;
    persisted?: Partial<GitProcessPolicy>;
}): GitProcessPolicy;
export declare class GitProcessScheduler {
    readonly policy: GitProcessPolicy;
    private readonly startThrottled;
    private readonly highPriorityQueue;
    private readonly normalPriorityQueue;
    private readonly backgroundPriorityQueue;
    private admitted;
    private running;
    private waiting;
    private backgroundWaiting;
    private foregroundAdmissionsSinceReservation;
    private drainScheduled;
    constructor(policy: GitProcessPolicy);
    get activeCount(): number;
    get pendingCount(): number;
    get maxQueueDepth(): number;
    run<T>(start: () => ScheduledGitProcess<T>, options?: {
        priority?: GitProcessPriority;
        class?: GitProcessClass;
    }): Promise<T>;
    private queueFor;
    /** A command left the wait queue: it either started or its start failed. */
    private dropWaiting;
    private scheduleDrain;
    private drainOne;
    /**
     * Foreground work goes ahead of a waiting sweep, but not without limit: once
     * the reservation window's worth of foreground commands have been admitted
     * while background work waits, the sweep gets the next turn. Foreground
     * admission is otherwise what keeps interactive work responsive.
     */
    private takeNextAdmission;
    private execute;
}
//# sourceMappingURL=git-process-scheduler.d.ts.map