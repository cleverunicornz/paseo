import { randomBytes } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";

import type { CodexExecutor } from "./codex-executor.js";

const DEFAULT_MAX_BUFFERED_CHARS = 1024 * 1024;
const DEFAULT_MAX_RUNNING_PER_AGENT = 16;

export class LocalProcessNotFoundError extends Error {
  constructor(readonly processId: string) {
    super(`Process not found: ${processId}`);
    this.name = "LocalProcessNotFoundError";
  }
}

export type LocalProcessExit =
  | { status: "running" }
  | { status: "exited"; exitCode: number }
  /** The executor went away; the process went with it. */
  | { status: "lost" };

export interface LocalProcessSummary {
  processId: string;
  command: string[];
  cwd: string;
  startedAt: string;
  running: boolean;
}

export interface LocalProcessRead {
  stdout: string;
  stderr: string;
  exited: boolean;
  exitCode: number | null;
  /** Output dropped because it was not read before the buffer filled. */
  droppedChars: number;
}

interface StreamBuffer {
  decoder: TextDecoder;
  unread: string;
}

interface LocalProcess {
  processId: string;
  agentId: string;
  handle: string;
  command: string[];
  cwd: string;
  startedAt: string;
  stdout: StreamBuffer;
  stderr: StreamBuffer;
  droppedChars: number;
  exit: LocalProcessExit;
  waiters: Set<() => void>;
}

export interface LocalProcessSpawnInput {
  agentId: string;
  command: string[];
  cwd: string;
  env: Record<string, string>;
}

interface OutputDeltaParams {
  processHandle?: unknown;
  stream?: unknown;
  deltaBase64?: unknown;
}

interface ExitedParams {
  processHandle?: unknown;
  exitCode?: unknown;
}

/** Resolves on the process's next output or exit, or after `waitMs`. */
async function waitForNews(entry: LocalProcess, waitMs: number): Promise<void> {
  const woken = new AbortController();
  const wake = () => woken.abort();
  entry.waiters.add(wake);
  try {
    await sleep(waitMs, undefined, { signal: woken.signal });
  } catch {
    // Woken by output or exit before the wait ran out.
  } finally {
    entry.waiters.delete(wake);
  }
}

function newStreamBuffer(): StreamBuffer {
  return { decoder: new TextDecoder("utf-8"), unread: "" };
}

/**
 * Long-running processes the local tools started through the executor's
 * `process/*` API. Handles are connection-scoped at the executor, which serves
 * every agent, so each process belongs to the agent that started it and no
 * other agent can address it.
 */
export class LocalProcessRegistry {
  private readonly processes = new Map<string, LocalProcess>();
  private readonly maxBufferedChars: number;
  private readonly maxRunningPerAgent: number;

  constructor(
    private readonly executor: CodexExecutor,
    options: { maxBufferedChars?: number; maxRunningPerAgent?: number } = {},
  ) {
    this.maxBufferedChars = options.maxBufferedChars ?? DEFAULT_MAX_BUFFERED_CHARS;
    this.maxRunningPerAgent = options.maxRunningPerAgent ?? DEFAULT_MAX_RUNNING_PER_AGENT;
    executor.onNotification((method, params) => this.handleNotification(method, params));
    executor.onExit(() => {
      for (const entry of this.processes.values()) {
        if (entry.exit.status === "running") {
          entry.exit = { status: "lost" };
          this.wake(entry);
        }
      }
    });
  }

  async spawn(input: LocalProcessSpawnInput): Promise<{ processId: string }> {
    const running = [...this.processes.values()].filter(
      (entry) => entry.agentId === input.agentId && entry.exit.status === "running",
    );
    if (running.length >= this.maxRunningPerAgent) {
      throw new Error(
        `At most ${this.maxRunningPerAgent} processes may run at once; kill one with process_kill first`,
      );
    }
    const processId = `proc-${randomBytes(6).toString("hex")}`;
    const entry: LocalProcess = {
      processId,
      agentId: input.agentId,
      handle: `${input.agentId}:${processId}`,
      command: input.command,
      cwd: input.cwd,
      startedAt: new Date().toISOString(),
      stdout: newStreamBuffer(),
      stderr: newStreamBuffer(),
      droppedChars: 0,
      exit: { status: "running" },
      waiters: new Set(),
    };
    this.processes.set(entry.handle, entry);
    try {
      await this.executor.request("process/spawn", {
        command: input.command,
        processHandle: entry.handle,
        cwd: input.cwd,
        tty: false,
        streamStdin: true,
        streamStdoutStderr: true,
        // Paseo bounds what it keeps; the process itself runs until it exits or is killed.
        outputBytesCap: null,
        timeoutMs: null,
        env: input.env,
      });
    } catch (error) {
      this.processes.delete(entry.handle);
      throw error;
    }
    return { processId };
  }

  async write(
    agentId: string,
    processId: string,
    input: { data?: string; closeStdin?: boolean },
  ): Promise<void> {
    const entry = this.require(agentId, processId);
    if (entry.exit.status !== "running") {
      throw new Error(`Process ${processId} is no longer running`);
    }
    await this.executor.request("process/writeStdin", {
      processHandle: entry.handle,
      ...(input.data ? { deltaBase64: Buffer.from(input.data, "utf8").toString("base64") } : {}),
      closeStdin: input.closeStdin === true,
    });
  }

  /** Returns the output not read yet, waiting up to `waitMs` for some when there is none. */
  async read(
    agentId: string,
    processId: string,
    options: { waitMs: number; maxChars: number },
  ): Promise<LocalProcessRead> {
    const entry = this.require(agentId, processId);
    if (!this.hasNews(entry) && options.waitMs > 0) {
      await waitForNews(entry, options.waitMs);
    }
    const stdout = entry.stdout.unread.slice(0, options.maxChars);
    entry.stdout.unread = entry.stdout.unread.slice(stdout.length);
    const stderr = entry.stderr.unread.slice(0, options.maxChars);
    entry.stderr.unread = entry.stderr.unread.slice(stderr.length);
    const droppedChars = entry.droppedChars;
    entry.droppedChars = 0;
    const exited = entry.exit.status !== "running";
    if (exited && !entry.stdout.unread && !entry.stderr.unread) {
      // Everything about this process has been reported.
      this.processes.delete(entry.handle);
    }
    return {
      stdout,
      stderr,
      exited,
      exitCode: entry.exit.status === "exited" ? entry.exit.exitCode : null,
      droppedChars,
    };
  }

  async kill(agentId: string, processId: string): Promise<void> {
    const entry = this.require(agentId, processId);
    if (entry.exit.status !== "running") {
      return;
    }
    await this.executor.request("process/kill", { processHandle: entry.handle });
  }

  list(agentId: string): LocalProcessSummary[] {
    return [...this.processes.values()]
      .filter((entry) => entry.agentId === agentId)
      .map((entry) => ({
        processId: entry.processId,
        command: entry.command,
        cwd: entry.cwd,
        startedAt: entry.startedAt,
        running: entry.exit.status === "running",
      }));
  }

  /** Kills every running process of an agent and forgets them all. */
  async releaseAgent(agentId: string): Promise<void> {
    const entries = [...this.processes.values()].filter((entry) => entry.agentId === agentId);
    for (const entry of entries) {
      this.processes.delete(entry.handle);
      if (entry.exit.status === "running") {
        await this.executor
          .request("process/kill", { processHandle: entry.handle })
          .catch(() => undefined);
      }
    }
  }

  private require(agentId: string, processId: string): LocalProcess {
    const entry = this.processes.get(`${agentId}:${processId}`);
    if (!entry) {
      throw new LocalProcessNotFoundError(processId);
    }
    return entry;
  }

  private hasNews(entry: LocalProcess): boolean {
    return (
      entry.stdout.unread.length > 0 ||
      entry.stderr.unread.length > 0 ||
      entry.exit.status !== "running"
    );
  }

  private wake(entry: LocalProcess): void {
    for (const waiter of entry.waiters) {
      waiter();
    }
  }

  private append(entry: LocalProcess, buffer: StreamBuffer, text: string): void {
    buffer.unread += text;
    const total = entry.stdout.unread.length + entry.stderr.unread.length;
    if (total > this.maxBufferedChars) {
      const excess = total - this.maxBufferedChars;
      buffer.unread = buffer.unread.slice(Math.min(excess, buffer.unread.length));
      entry.droppedChars += excess;
    }
  }

  private handleNotification(method: string, params: unknown): void {
    if (method === "process/outputDelta") {
      const delta = params as OutputDeltaParams;
      const entry = this.processes.get(String(delta.processHandle));
      if (!entry || typeof delta.deltaBase64 !== "string") return;
      const buffer = delta.stream === "stderr" ? entry.stderr : entry.stdout;
      this.append(
        entry,
        buffer,
        buffer.decoder.decode(Buffer.from(delta.deltaBase64, "base64"), { stream: true }),
      );
      this.wake(entry);
      return;
    }
    if (method === "process/exited") {
      const exited = params as ExitedParams;
      const entry = this.processes.get(String(exited.processHandle));
      if (!entry) return;
      this.append(entry, entry.stdout, entry.stdout.decoder.decode());
      this.append(entry, entry.stderr, entry.stderr.decoder.decode());
      entry.exit = {
        status: "exited",
        exitCode: typeof exited.exitCode === "number" ? exited.exitCode : -1,
      };
      this.wake(entry);
    }
  }
}
