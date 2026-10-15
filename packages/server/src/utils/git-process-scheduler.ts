import { setImmediate as scheduleImmediate } from "node:timers";
import pThrottle from "p-throttle";

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
export class GitProcessQueueFullError extends Error {
  readonly code = "GIT_PROCESS_QUEUE_FULL";

  constructor(readonly maxQueueDepth: number) {
    super(
      `Git process queue is full (${maxQueueDepth} waiting); deferring background command so the backlog cannot grow unbounded`,
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

/**
 * Foreground admissions owed to waiting background work. A background command
 * is admitted at least once per this many foreground admissions, so an
 * unbroken stream of foreground work delays the reconciliation sweep by at
 * most a bounded number of commands rather than starving it.
 */
const BACKGROUND_RESERVATION_WINDOW = 1;

export class GitProcessScheduler {
  private readonly startThrottled;
  private readonly highPriorityQueue: Array<() => void> = [];
  private readonly normalPriorityQueue: Array<() => void> = [];
  private readonly backgroundPriorityQueue: Array<() => void> = [];
  private admitted = 0;
  private running = 0;
  private waiting = 0;
  private backgroundWaiting = 0;
  private foregroundAdmissionsSinceReservation = 0;
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
    options?: { priority?: GitProcessPriority; class?: GitProcessClass },
  ): Promise<T> {
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
    return new Promise<T>((resolve, reject) => {
      const admit = () => {
        void this.startThrottled(() => this.execute(start, resolve, reject, isBackground)).catch(
          (error) => {
            this.dropWaiting(isBackground);
            reject(error);
            this.scheduleDrain();
          },
        );
      };
      const queue = this.queueFor(options?.priority, isBackground);
      queue.push(admit);
      if (this.admitted === 0 && !this.drainScheduled) {
        this.drainOne();
      } else {
        this.scheduleDrain();
      }
    });
  }

  private queueFor(
    priority: GitProcessPriority | undefined,
    isBackground: boolean,
  ): Array<() => void> {
    if (isBackground) {
      return this.backgroundPriorityQueue;
    }
    return priority === "high" ? this.highPriorityQueue : this.normalPriorityQueue;
  }

  /** A command left the wait queue: it either started or its start failed. */
  private dropWaiting(isBackground: boolean): void {
    this.waiting = Math.max(0, this.waiting - 1);
    if (isBackground) {
      this.backgroundWaiting = Math.max(0, this.backgroundWaiting - 1);
    }
  }

  private scheduleDrain(): void {
    if (this.drainScheduled || this.admitted >= this.policy.maxProcessConcurrency) {
      return;
    }
    if (this.waiting === 0) {
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
  private takeNextAdmission(): (() => void) | undefined {
    const hasForeground = this.highPriorityQueue.length > 0 || this.normalPriorityQueue.length > 0;
    const hasBackground = this.backgroundPriorityQueue.length > 0;
    const awaitsReservation =
      hasForeground &&
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

  private async execute<T>(
    start: () => ScheduledGitProcess<T>,
    resolve: (value: T | PromiseLike<T>) => void,
    reject: (reason?: unknown) => void,
    isBackground: boolean,
  ): Promise<void> {
    this.dropWaiting(isBackground);
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
