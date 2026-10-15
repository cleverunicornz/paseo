import { setImmediate as scheduleImmediate } from "node:timers";
import pThrottle from "p-throttle";

export interface GitProcessPolicy {
  maxProcessesPerSecond: number;
  maxProcessConcurrency: number;
  /**
   * The largest number of commands that may wait for a process slot at once.
   * Past this bound the scheduler refuses rather than growing without limit:
   * a five-minute reconciliation sweep of a large estate once queued 907
   * commands with no ceiling and starved interactive work for minutes.
   */
  maxQueueDepth: number;
}

export const DEFAULT_GIT_PROCESS_POLICY: GitProcessPolicy = {
  maxProcessesPerSecond: 64,
  maxProcessConcurrency: 8,
  maxQueueDepth: 256,
};

export interface ScheduledGitProcess<T> {
  result: Promise<T>;
  exited: Promise<void>;
}

export type GitProcessPriority = "normal" | "high";

/**
 * Thrown when the scheduler's wait queue is at its bound. The caller's command
 * never ran: it is refused, not queued, so a burst cannot grow the backlog.
 * Callers that treat a Git read as optional (observation, reconciliation) drop
 * the read; interactive callers surface the refusal to the user.
 */
export class GitProcessQueueFullError extends Error {
  readonly code = "GIT_PROCESS_QUEUE_FULL";

  constructor(readonly maxQueueDepth: number) {
    super(
      `Git process queue is full (${maxQueueDepth} waiting); refusing command so the backlog cannot grow unbounded`,
    );
    this.name = "GitProcessQueueFullError";
  }
}

function parsePositiveInteger(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

export function resolveGitProcessPolicy(input: {
  env: NodeJS.ProcessEnv;
  persisted?: Partial<GitProcessPolicy>;
}): GitProcessPolicy {
  return {
    maxProcessesPerSecond:
      parsePositiveInteger(input.env.PASEO_GIT_MAX_PROCESSES_PER_SECOND) ??
      input.persisted?.maxProcessesPerSecond ??
      DEFAULT_GIT_PROCESS_POLICY.maxProcessesPerSecond,
    maxProcessConcurrency:
      parsePositiveInteger(input.env.PASEO_GIT_MAX_PROCESS_CONCURRENCY) ??
      // COMPAT(gitConcurrencyEnv): renamed in v0.2.6; remove after 2027-02-02.
      parsePositiveInteger(input.env.PASEO_GIT_CONCURRENCY) ??
      input.persisted?.maxProcessConcurrency ??
      DEFAULT_GIT_PROCESS_POLICY.maxProcessConcurrency,
    maxQueueDepth:
      parsePositiveInteger(input.env.PASEO_GIT_MAX_QUEUE_DEPTH) ??
      input.persisted?.maxQueueDepth ??
      DEFAULT_GIT_PROCESS_POLICY.maxQueueDepth,
  };
}

export class GitProcessScheduler {
  private readonly startThrottled;
  private readonly highPriorityQueue: Array<() => void> = [];
  private readonly normalPriorityQueue: Array<() => void> = [];
  private admitted = 0;
  private running = 0;
  private waiting = 0;
  private drainScheduled = false;

  constructor(readonly policy: GitProcessPolicy) {
    const throttle = pThrottle({
      limit: policy.maxProcessesPerSecond,
      interval: 1_000,
      strict: true,
    });
    this.startThrottled = throttle((start: () => Promise<void>) => start());
  }

  get activeCount(): number {
    return this.running;
  }

  get pendingCount(): number {
    return this.waiting;
  }

  get maxQueueDepth(): number {
    return this.policy.maxQueueDepth;
  }

  run<T>(
    start: () => ScheduledGitProcess<T>,
    options?: { priority?: GitProcessPriority },
  ): Promise<T> {
    if (this.waiting >= this.policy.maxQueueDepth) {
      return Promise.reject(new GitProcessQueueFullError(this.policy.maxQueueDepth));
    }
    this.waiting += 1;
    return new Promise<T>((resolve, reject) => {
      const admit = () => {
        void this.startThrottled(() => this.execute(start, resolve, reject)).catch((error) => {
          this.waiting = Math.max(0, this.waiting - 1);
          this.admitted = Math.max(0, this.admitted - 1);
          reject(error);
          this.scheduleDrain();
        });
      };
      const queue =
        options?.priority === "high" ? this.highPriorityQueue : this.normalPriorityQueue;
      queue.push(admit);
      if (this.admitted === 0 && !this.drainScheduled) {
        this.drainOne();
      } else {
        this.scheduleDrain();
      }
    });
  }

  private scheduleDrain(): void {
    if (this.drainScheduled || this.admitted >= this.policy.maxProcessConcurrency) {
      return;
    }
    if (this.highPriorityQueue.length === 0 && this.normalPriorityQueue.length === 0) {
      return;
    }
    this.drainScheduled = true;
    scheduleImmediate(() => this.drainOne());
  }

  private drainOne(): void {
    this.drainScheduled = false;
    if (this.admitted >= this.policy.maxProcessConcurrency) {
      return;
    }
    const admit = this.highPriorityQueue.shift() ?? this.normalPriorityQueue.shift();
    if (!admit) {
      return;
    }
    this.admitted += 1;
    admit();
    // Spawning can be synchronous and expensive on a throttled host. Let timers,
    // sockets, and child exits run before admitting another Git process.
    this.scheduleDrain();
  }

  private async execute<T>(
    start: () => ScheduledGitProcess<T>,
    resolve: (value: T | PromiseLike<T>) => void,
    reject: (reason?: unknown) => void,
  ): Promise<void> {
    this.waiting = Math.max(0, this.waiting - 1);
    this.running += 1;
    try {
      const process = start();
      void process.result.then(resolve, reject);
      await process.exited;
    } catch (error) {
      reject(error);
    } finally {
      this.running = Math.max(0, this.running - 1);
      this.admitted = Math.max(0, this.admitted - 1);
      this.scheduleDrain();
    }
  }
}
