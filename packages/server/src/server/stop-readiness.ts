import type { Logger } from "pino";
import { z } from "zod";
import type { PluginStopReadinessOperation } from "./plugins/plugin-process-protocol.js";
import type { TimelineDrainFailure, TimelineDrainResult } from "./plugins/timeline-deliveries.js";

export interface TimelineReadiness {
  ready: boolean;
  epoch: string | null;
  emitted_through: number | null;
  acknowledged_through: number | null;
  reason?: string;
}

export interface WipReadiness {
  ready: boolean;
  ref?: string;
  sha?: string;
  reason?: string;
}

/** The answer to "would stopping now lose anything?". `ready` is the conjunction of the parts. */
export interface StopReadiness {
  ready: boolean;
  timeline: TimelineReadiness;
  wip: WipReadiness;
}

/** A stop-readiness provider whose `drain` did not resolve before the shutdown deadline. */
export interface ProviderDrainFailure {
  pluginId: string;
  reason: "deadline" | "rejected";
}

export type ShutdownDrainResult =
  | { status: "drained" }
  | {
      status: "failed";
      deadlineMs: number;
      failures: TimelineDrainFailure[];
      providerFailures: ProviderDrainFailure[];
    };

export interface StopReadinessPlugins {
  listStopReadinessProviders(operation: PluginStopReadinessOperation): string[];
  hasPendingTimelineDeliveries(pluginId: string): boolean;
  requestStopReadiness(input: {
    pluginId: string;
    operation: PluginStopReadinessOperation;
    signal?: AbortSignal;
  }): Promise<unknown>;
  drainTimelineDeliveries(deadlineMs: number): Promise<TimelineDrainResult>;
}

const MAX_REASON_LENGTH = 300;

// A reason is plugin-supplied free text; credentials in URLs never reach the answer.
function sanitizeReason(reason: string | undefined): string | undefined {
  if (reason === undefined) return undefined;
  return reason
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@]*@/gi, "$1[redacted]@")
    .slice(0, MAX_REASON_LENGTH);
}

function withReason<Part extends { reason?: string }>(part: Part): Part {
  const { reason, ...rest } = part;
  const sanitized = sanitizeReason(reason);
  return (sanitized === undefined ? rest : { ...rest, reason: sanitized }) as Part;
}

const TimelineAnswerSchema = z
  .object({
    ready: z.boolean(),
    epoch: z.string().max(200).nullable(),
    emitted_through: z.number().int().nonnegative().nullable(),
    acknowledged_through: z.number().int().nonnegative().nullable(),
    reason: z.string().optional(),
  })
  .strict();

const WipAnswerSchema = z
  .object({
    ready: z.boolean(),
    // A ref name, never a URL: no scheme, userinfo or whitespace can pass.
    ref: z
      .string()
      .regex(/^[A-Za-z0-9._/-]{1,255}$/)
      .refine((ref) => !ref.includes(".."), "ref must not contain ..")
      .optional(),
    sha: z
      .string()
      .regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/)
      .optional(),
    reason: z.string().optional(),
  })
  .strict();

const ReadinessAnswerSchema = z
  .object({ ready: z.boolean(), timeline: TimelineAnswerSchema, wip: WipAnswerSchema })
  .strict();

function notReady(reason: string): StopReadiness {
  return {
    ready: false,
    timeline: {
      ready: false,
      epoch: null,
      emitted_through: null,
      acknowledged_through: null,
      reason,
    },
    wip: { ready: false, reason },
  };
}

/**
 * Composes the daemon's stop-readiness answer from the plugin that registered
 * a stop-readiness provider, and drives that provider's stop work. With no
 * provider, several providers, a failed provider or a malformed answer,
 * nothing is ready.
 */
export class StopReadinessService {
  private stopWork: AbortController | null = null;
  private stopWorkRunning = false;

  constructor(
    private readonly deps: {
      plugins: StopReadinessPlugins;
      /** Refuses new agents and turns, then stops the turns that are running. */
      stopAgentWork: () => Promise<void>;
      logger: Logger;
    },
  ) {}

  async readiness(): Promise<StopReadiness> {
    const providers = this.deps.plugins.listStopReadinessProviders("readiness");
    if (providers.length === 0) return notReady("no provider");
    if (providers.length > 1) return notReady("multiple providers");
    const pluginId = providers[0]!;
    let raw: unknown;
    try {
      raw = await this.deps.plugins.requestStopReadiness({ pluginId, operation: "readiness" });
    } catch (error) {
      this.deps.logger.warn({ err: error, pluginId }, "Stop-readiness provider failed");
      return notReady("provider failed");
    }
    const parsed = ReadinessAnswerSchema.safeParse(raw);
    if (!parsed.success) {
      this.deps.logger.warn(
        { pluginId, issues: parsed.error.issues.map((issue) => issue.message) },
        "Stop-readiness provider answered with an invalid shape",
      );
      return notReady("invalid provider answer");
    }
    // Items the daemon sent that the provider has not answered may not be in its count yet.
    const timeline =
      parsed.data.timeline.ready && this.deps.plugins.hasPendingTimelineDeliveries(pluginId)
        ? {
            ...parsed.data.timeline,
            ready: false,
            reason: "timeline items in flight to the provider",
          }
        : withReason(parsed.data.timeline);
    const wip = withReason(parsed.data.wip);
    return { ready: timeline.ready && wip.ready, timeline, wip };
  }

  /**
   * Refuses new agents and turns, stops the running turns, then calls the
   * provider's `stop` and `drain` together. Returns once the work is started;
   * a request while that work still runs starts nothing new.
   */
  beginStopping(): void {
    // A controller may repeat the request while it polls; work already running
    // (a push, say) is left to finish rather than restarted.
    if (this.stopWorkRunning) return;
    const controller = new AbortController();
    this.stopWork = controller;
    this.stopWorkRunning = true;
    void this.runStopWork(controller.signal).finally(() => {
      this.stopWorkRunning = false;
    });
  }

  private async runStopWork(signal: AbortSignal): Promise<void> {
    try {
      await this.deps.stopAgentWork();
    } catch (error) {
      this.deps.logger.warn({ err: error }, "Failed to stop running turns");
    }
    if (signal.aborted) return;
    const calls = (["stop", "drain"] as const).flatMap((operation) =>
      this.deps.plugins.listStopReadinessProviders(operation).map((pluginId) =>
        this.deps.plugins
          .requestStopReadiness({ pluginId, operation, signal })
          .catch((error: unknown) => {
            this.deps.logger.warn(
              { err: error, pluginId, operation },
              "Stop-readiness provider operation failed",
            );
          }),
      ),
    );
    await Promise.all(calls);
  }

  /**
   * Waits up to the deadline for the daemon's own timeline deliveries and for
   * every provider's `drain`. Whatever is still outstanding then is a failure.
   */
  async drainForShutdown(deadlineMs: number): Promise<ShutdownDrainResult> {
    this.stopWork?.abort();
    const deadline = new AbortController();
    const timer = setTimeout(() => deadline.abort(), deadlineMs);
    try {
      const [deliveries, providerFailures] = await Promise.all([
        this.deps.plugins.drainTimelineDeliveries(deadlineMs),
        this.drainProviders(deadline.signal),
      ]);
      if (deliveries.status === "drained" && providerFailures.length === 0) {
        return { status: "drained" };
      }
      return {
        status: "failed",
        deadlineMs,
        failures: deliveries.status === "failed" ? deliveries.failures : [],
        providerFailures,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  private async drainProviders(deadline: AbortSignal): Promise<ProviderDrainFailure[]> {
    const pluginIds = this.deps.plugins.listStopReadinessProviders("drain");
    const outcomes = await Promise.all(
      pluginIds.map((pluginId) =>
        settleBy(
          this.deps.plugins.requestStopReadiness({
            pluginId,
            operation: "drain",
            signal: deadline,
          }),
          deadline,
        ).then((outcome) => ({ pluginId, outcome })),
      ),
    );
    return outcomes.flatMap(({ pluginId, outcome }) => {
      if (outcome.status === "resolved") return [];
      this.deps.logger.error(
        { pluginId, reason: outcome.status, err: outcome.error },
        "Stop-readiness provider did not drain",
      );
      return [{ pluginId, reason: outcome.status === "deadline" ? "deadline" : "rejected" }];
    });
  }
}

type Settled =
  | { status: "resolved" }
  | { status: "rejected"; error: unknown }
  | { status: "deadline"; error?: undefined };

/** A drain that rejects because the deadline aborted it counts as missing the deadline. */
function settleBy(promise: Promise<unknown>, deadline: AbortSignal): Promise<Settled> {
  const expired = new Promise<Settled>((resolve) => {
    if (deadline.aborted) resolve({ status: "deadline" });
    deadline.addEventListener("abort", () => resolve({ status: "deadline" }), { once: true });
  });
  const settled = promise.then(
    (): Settled => ({ status: "resolved" }),
    (error: unknown): Settled =>
      deadline.aborted ? { status: "deadline" } : { status: "rejected", error },
  );
  return Promise.race([settled, expired]);
}
