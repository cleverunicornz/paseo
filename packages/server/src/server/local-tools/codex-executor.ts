import type { ChildProcess, ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdir } from "node:fs/promises";
import type { Logger } from "pino";

import { spawnProcess } from "../../utils/spawn.js";
import { buildAllowlistedHarnessEnv } from "../agent/model-gateway-env.js";
import { CodexAppServerClient } from "../agent/providers/codex/app-server-transport.js";
import type { ManagedProcessRegistry } from "../managed-processes/managed-processes.js";

const INITIALIZE_TIMEOUT_MS = 30_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;

export interface CodexExecutorOptions {
  codexPath: string;
  codexHome: string;
  /** The app server's complete environment; `CODEX_HOME` is set on top. */
  env: Record<string, string>;
  logger: Logger;
  managedProcesses?: ManagedProcessRegistry;
}

type NotificationListener = (method: string, params: unknown) => void;

interface RunningExecutor {
  client: CodexAppServerClient;
  child: ChildProcessWithoutNullStreams;
  codexHome: string;
  managedProcessId: Promise<string | null>;
}

/**
 * The environment of the executor and so of every command it runs: the
 * harness allowlist (base variables plus the configured pass-through). The
 * local tools stand in for a harness's own shell, so they get what the
 * harness itself would.
 */
export function buildExecutorEnv(input: {
  envPassthrough: readonly string[];
}): Record<string, string> {
  return buildAllowlistedHarnessEnv({
    inherited: [process.env],
    envPassthrough: input.envPassthrough,
  });
}

function assertChildWithPipes(
  child: ChildProcess,
): asserts child is ChildProcessWithoutNullStreams {
  if (!child.stdin || !child.stdout || !child.stderr) {
    throw new Error("Codex executor was spawned without stdio streams");
  }
}

/**
 * One Codex app server per daemon, run with no model and no login as the
 * executor of the local tools. It starts on the first request, and a request
 * after it died starts it again.
 */
export class CodexExecutor {
  private running: RunningExecutor | null = null;
  private starting: Promise<RunningExecutor> | null = null;
  private closed = false;
  private readonly notificationListeners = new Set<NotificationListener>();
  private readonly exitListeners = new Set<() => void>();

  constructor(private readonly options: CodexExecutorOptions) {}

  get pid(): number | null {
    return this.running?.child.pid ?? null;
  }

  /** The Codex home the running app server reports. */
  get codexHome(): string | null {
    return this.running?.codexHome ?? null;
  }

  async request<T = unknown>(
    method: string,
    params: unknown,
    timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  ): Promise<T> {
    const running = await this.ensureStarted();
    return (await running.client.request(method, params, timeoutMs)) as T;
  }

  /** Every app-server notification, for every request this executor serves. */
  onNotification(listener: NotificationListener): () => void {
    this.notificationListeners.add(listener);
    return () => this.notificationListeners.delete(listener);
  }

  /** Called when a running app server goes away; its connection-scoped state is gone. */
  onExit(listener: () => void): () => void {
    this.exitListeners.add(listener);
    return () => this.exitListeners.delete(listener);
  }

  async close(): Promise<void> {
    this.closed = true;
    const running = this.running ?? (await this.starting?.catch(() => null)) ?? null;
    if (!running) {
      return;
    }
    this.detach(running);
    await running.client.dispose().catch((error: unknown) => {
      this.options.logger.warn({ err: error }, "Failed to stop the Codex executor");
    });
    await this.removeManagedRecord(running);
  }

  private ensureStarted(): Promise<RunningExecutor> {
    if (this.closed) {
      return Promise.reject(new Error("Codex executor is closed"));
    }
    if (this.running) {
      return Promise.resolve(this.running);
    }
    this.starting ??= this.start().finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  private async start(): Promise<RunningExecutor> {
    const { codexPath, codexHome, env, logger } = this.options;
    await mkdir(codexHome, { recursive: true, mode: 0o700 });
    const child = spawnProcess(codexPath, ["app-server"], {
      cwd: codexHome,
      env: { ...env, CODEX_HOME: codexHome },
      envMode: "internal",
      detached: process.platform !== "win32",
      stdio: ["pipe", "pipe", "pipe"],
    });
    assertChildWithPipes(child);
    const client = new CodexAppServerClient(child, logger.child({ component: "codex-executor" }));
    let running: RunningExecutor | null = null;
    client.setNotificationHandler((method, params) => {
      for (const listener of this.notificationListeners) {
        try {
          listener(method, params);
        } catch (error) {
          logger.warn({ err: error, method }, "Codex executor notification listener failed");
        }
      }
    });
    client.setUnexpectedTerminationHandler((error) => {
      logger.warn({ err: error }, "Codex executor exited");
      if (running) {
        this.detach(running);
        void this.removeManagedRecord(running);
      }
    });

    let initialized: { codexHome?: unknown };
    try {
      initialized = (await client.request(
        "initialize",
        {
          clientInfo: { name: "paseo_local_tools", title: "Paseo local tools", version: "1" },
          // process/* is part of the experimental API.
          capabilities: { experimentalApi: true, requestAttestation: false },
        },
        INITIALIZE_TIMEOUT_MS,
      )) as { codexHome?: unknown };
      client.notify("initialized");
    } catch (error) {
      await client.dispose().catch(() => undefined);
      throw new Error(
        `Codex executor did not start: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
    running = {
      client,
      child,
      codexHome: typeof initialized.codexHome === "string" ? initialized.codexHome : codexHome,
      managedProcessId: this.recordManagedProcess(child),
    };
    if (this.closed) {
      await client.dispose().catch(() => undefined);
      await this.removeManagedRecord(running);
      throw new Error("Codex executor is closed");
    }
    this.running = running;
    logger.info({ pid: child.pid, codexHome: running.codexHome }, "Codex executor started");
    return running;
  }

  private detach(running: RunningExecutor): void {
    if (this.running !== running) {
      return;
    }
    this.running = null;
    for (const listener of this.exitListeners) {
      try {
        listener();
      } catch (error) {
        this.options.logger.warn({ err: error }, "Codex executor exit listener failed");
      }
    }
  }

  private async recordManagedProcess(child: ChildProcess): Promise<string | null> {
    const pid = child.pid;
    if (!this.options.managedProcesses || typeof pid !== "number" || pid <= 0) {
      return null;
    }
    try {
      const record = await this.options.managedProcesses.record({
        owner: { provider: "paseo", kind: "local-tools-executor" },
        pid,
        command: this.options.codexPath,
        args: ["app-server"],
      });
      return record.id;
    } catch (error) {
      this.options.logger.warn({ err: error, pid }, "Failed to record the Codex executor process");
      return null;
    }
  }

  private async removeManagedRecord(running: RunningExecutor): Promise<void> {
    const id = await running.managedProcessId;
    if (id && this.options.managedProcesses) {
      await this.options.managedProcesses.remove(id).catch(() => undefined);
    }
  }
}
