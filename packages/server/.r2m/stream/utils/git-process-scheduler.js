import { setImmediate as scheduleImmediate } from "node:timers";
import pThrottle from "p-throttle";
export const DEFAULT_GIT_PROCESS_POLICY = {
    maxProcessesPerSecond: 64,
    maxProcessConcurrency: 8,
    maxQueueDepth: 256,
};
/**
 * Thrown when the scheduler's wait queue is at its bound and the submission is
 * of the `background` class. The command never ran: it is refused, not queued,
 * so a sweep cannot grow the backlog. The refusal is the yield signal - the
 * sweep defers the tick and retries. A `foreground` submission never throws
 * this: refusing it would drop work an agent or a user asked for.
 */
export class GitProcessQueueFullError extends Error {
    constructor(maxQueueDepth) {
        super(`Git process queue is full (${maxQueueDepth} waiting); deferring background command so the backlog cannot grow unbounded`);
        this.maxQueueDepth = maxQueueDepth;
        this.code = "GIT_PROCESS_QUEUE_FULL";
        this.name = "GitProcessQueueFullError";
    }
}
function parsePositiveInteger(value) {
    if (value === undefined) {
        return undefined;
    }
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}
export function resolveGitProcessPolicy(input) {
    return {
        maxProcessesPerSecond: parsePositiveInteger(input.env.PASEO_GIT_MAX_PROCESSES_PER_SECOND) ??
            input.persisted?.maxProcessesPerSecond ??
            DEFAULT_GIT_PROCESS_POLICY.maxProcessesPerSecond,
        maxProcessConcurrency: parsePositiveInteger(input.env.PASEO_GIT_MAX_PROCESS_CONCURRENCY) ??
            // COMPAT(gitConcurrencyEnv): renamed in v0.2.6; remove after 2027-02-02.
            parsePositiveInteger(input.env.PASEO_GIT_CONCURRENCY) ??
            input.persisted?.maxProcessConcurrency ??
            DEFAULT_GIT_PROCESS_POLICY.maxProcessConcurrency,
        maxQueueDepth: parsePositiveInteger(input.env.PASEO_GIT_MAX_QUEUE_DEPTH) ??
            input.persisted?.maxQueueDepth ??
            DEFAULT_GIT_PROCESS_POLICY.maxQueueDepth,
    };
}
/**
 * Foreground admissions owed to waiting background work. A background command
 * is admitted at least once per this many foreground admissions, so an
 * unbroken stream of foreground work delays the reconciliation sweep by at
 * most a bounded number of commands rather than starving it.
 */
const BACKGROUND_RESERVATION_WINDOW = 1;
export class GitProcessScheduler {
    constructor(policy) {
        this.policy = policy;
        this.highPriorityQueue = [];
        this.normalPriorityQueue = [];
        this.backgroundPriorityQueue = [];
        this.admitted = 0;
        this.running = 0;
        this.waiting = 0;
        this.backgroundWaiting = 0;
        this.foregroundAdmissionsSinceReservation = 0;
        this.drainScheduled = false;
        const throttle = pThrottle({
            limit: policy.maxProcessesPerSecond,
            interval: 1000,
            strict: true,
        });
        this.startThrottled = throttle((start) => start());
    }
    get activeCount() {
        return this.running;
    }
    get pendingCount() {
        return this.waiting;
    }
    get maxQueueDepth() {
        return this.policy.maxQueueDepth;
    }
    run(start, options) {
        const isBackground = options?.class === "background";
        // The bound governs the sweep. A foreground command is the work an agent
        // or a user asked for, so it always enqueues, however deep the queue.
        if (isBackground && this.waiting >= this.policy.maxQueueDepth) {
            return Promise.reject(new GitProcessQueueFullError(this.policy.maxQueueDepth));
        }
        this.waiting += 1;
        if (isBackground) {
            this.backgroundWaiting += 1;
            // A newly waiting sweep read waits behind at most the reservation window
            // of foreground admissions, counted from its own arrival.
            this.foregroundAdmissionsSinceReservation = 0;
        }
        return new Promise((resolve, reject) => {
            const admit = () => {
                void this.startThrottled(() => this.execute(start, resolve, reject, isBackground)).catch((error) => {
                    this.dropWaiting(isBackground);
                    reject(error);
                    this.scheduleDrain();
                });
            };
            const queue = this.queueFor(options?.priority, isBackground);
            queue.push(admit);
            if (this.admitted === 0 && !this.drainScheduled) {
                this.drainOne();
            }
            else {
                this.scheduleDrain();
            }
        });
    }
    queueFor(priority, isBackground) {
        if (isBackground) {
            return this.backgroundPriorityQueue;
        }
        return priority === "high" ? this.highPriorityQueue : this.normalPriorityQueue;
    }
    /** A command left the wait queue: it either started or its start failed. */
    dropWaiting(isBackground) {
        this.waiting = Math.max(0, this.waiting - 1);
        if (isBackground) {
            this.backgroundWaiting = Math.max(0, this.backgroundWaiting - 1);
        }
    }
    scheduleDrain() {
        if (this.drainScheduled || this.admitted >= this.policy.maxProcessConcurrency) {
            return;
        }
        if (this.waiting === 0) {
            return;
        }
        this.drainScheduled = true;
        scheduleImmediate(() => this.drainOne());
    }
    drainOne() {
        this.drainScheduled = false;
        if (this.admitted >= this.policy.maxProcessConcurrency) {
            return;
        }
        const admit = this.takeNextAdmission();
        if (!admit) {
            return;
        }
        this.admitted += 1;
        admit();
        // Spawning can be synchronous and expensive on a throttled host. Let timers,
        // sockets, and child exits run before admitting another Git process.
        this.scheduleDrain();
    }
    /**
     * Foreground work goes ahead of a waiting sweep, but not without limit: once
     * the reservation window's worth of foreground commands have been admitted
     * while background work waits, the sweep gets the next turn. Foreground
     * admission is otherwise what keeps interactive work responsive.
     */
    takeNextAdmission() {
        const hasForeground = this.highPriorityQueue.length > 0 || this.normalPriorityQueue.length > 0;
        const hasBackground = this.backgroundPriorityQueue.length > 0;
        const awaitsReservation = hasForeground &&
            hasBackground &&
            this.foregroundAdmissionsSinceReservation >= BACKGROUND_RESERVATION_WINDOW;
        if (hasBackground && (!hasForeground || awaitsReservation)) {
            if (awaitsReservation) {
                this.foregroundAdmissionsSinceReservation = 0;
            }
            return this.backgroundPriorityQueue.shift();
        }
        if (!hasForeground) {
            return undefined;
        }
        if (hasBackground) {
            this.foregroundAdmissionsSinceReservation += 1;
        }
        return this.highPriorityQueue.shift() ?? this.normalPriorityQueue.shift();
    }
    async execute(start, resolve, reject, isBackground) {
        this.dropWaiting(isBackground);
        this.running += 1;
        try {
            const process = start();
            void process.result.then(resolve, reject);
            await process.exited;
        }
        catch (error) {
            reject(error);
        }
        finally {
            this.running = Math.max(0, this.running - 1);
            this.admitted = Math.max(0, this.admitted - 1);
            this.scheduleDrain();
        }
    }
}
//# sourceMappingURL=git-process-scheduler.js.map