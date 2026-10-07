import type { Logger } from "pino";
import { z } from "zod";
import type { PluginStopReadinessPart } from "./plugins/runtime.js";

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

export interface StopReadinessPlugins {
  listStopReadinessProviders(part: PluginStopReadinessPart): string[];
  hasPendingTimelineDeliveries(pluginId: string): boolean;
  requestStopReadiness(input: {
    pluginId: string;
    part: PluginStopReadinessPart;
    stopping: boolean;
  }): Promise<unknown>;
}

const MAX_REASON_LENGTH = 300;

// A reason is plugin-supplied free text; credentials in URLs never reach the answer.
function sanitizeReason(reason: string | undefined): string | undefined {
  if (reason === undefined) return undefined;
  return reason
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@]*@/gi, "$1[redacted]@")
    .slice(0, MAX_REASON_LENGTH);
}

const ReasonSchema = z.string().optional();

const TimelineAnswerSchema = z
  .object({
    ready: z.boolean(),
    epoch: z.string().max(200).nullable(),
    emitted_through: z.number().int().nonnegative().nullable(),
    acknowledged_through: z.number().int().nonnegative().nullable(),
    reason: ReasonSchema,
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
    reason: ReasonSchema,
  })
  .strict();

function unavailableTimeline(reason: string): TimelineReadiness {
  return { ready: false, epoch: null, emitted_through: null, acknowledged_through: null, reason };
}

/**
 * Composes the daemon's stop-readiness answer from plugin providers and starts
 * their stop work on request. A part with no provider, several providers, a
 * failed provider or a malformed answer is not ready.
 */
export class StopReadinessService {
  private stopping = false;

  constructor(
    private readonly deps: {
      plugins: StopReadinessPlugins;
      /** Stops new agents and new turns in the agent manager. */
      stopAcceptingWork: () => void;
      logger: Logger;
    },
  ) {}

  isStopping(): boolean {
    return this.stopping;
  }

  async readiness(): Promise<StopReadiness> {
    const [timeline, wip] = await Promise.all([this.timeline(), this.wip()]);
    return { ready: timeline.ready && wip.ready, timeline, wip };
  }

  /**
   * Refuses new agents and new turns from now on, then asks every provider to
   * start its stop work. Providers run in the background; their failures are
   * logged and show up as parts that do not become ready.
   */
  beginStopping(): void {
    this.stopping = true;
    this.deps.stopAcceptingWork();
    for (const pluginId of this.deps.plugins.listStopReadinessProviders("beginStopping")) {
      this.deps.plugins
        .requestStopReadiness({ pluginId, part: "beginStopping", stopping: true })
        .catch((error: unknown) => {
          this.deps.logger.warn({ err: error, pluginId }, "Plugin failed to begin stopping");
        });
    }
  }

  private async timeline(): Promise<TimelineReadiness> {
    const answer = await this.ask("timeline", TimelineAnswerSchema);
    if (answer.status !== "answered") return unavailableTimeline(answer.reason);
    const { pluginId, value } = answer;
    if (value.ready && this.deps.plugins.hasPendingTimelineDeliveries(pluginId)) {
      return { ...value, ready: false, reason: "timeline items in flight to the provider" };
    }
    return { ...value, ...optionalReason(value.reason) };
  }

  private async wip(): Promise<WipReadiness> {
    const answer = await this.ask("wip", WipAnswerSchema);
    if (answer.status !== "answered") return { ready: false, reason: answer.reason };
    return { ...answer.value, ...optionalReason(answer.value.reason) };
  }

  private async ask<Schema extends z.ZodType>(
    part: "timeline" | "wip",
    schema: Schema,
  ): Promise<
    | { status: "answered"; pluginId: string; value: z.infer<Schema> }
    | { status: "unavailable"; reason: string }
  > {
    const providers = this.deps.plugins.listStopReadinessProviders(part);
    if (providers.length === 0) return { status: "unavailable", reason: "no provider" };
    if (providers.length > 1) return { status: "unavailable", reason: "multiple providers" };
    const pluginId = providers[0]!;
    let raw: unknown;
    try {
      raw = await this.deps.plugins.requestStopReadiness({
        pluginId,
        part,
        stopping: this.stopping,
      });
    } catch (error) {
      this.deps.logger.warn({ err: error, pluginId, part }, "Stop-readiness provider failed");
      return { status: "unavailable", reason: "provider failed" };
    }
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      this.deps.logger.warn(
        { pluginId, part, issues: parsed.error.issues.map((issue) => issue.message) },
        "Stop-readiness provider answered with an invalid shape",
      );
      return { status: "unavailable", reason: "invalid provider answer" };
    }
    return { status: "answered", pluginId, value: parsed.data };
  }
}

function optionalReason(reason: string | undefined): { reason?: string } {
  const sanitized = sanitizeReason(reason);
  return sanitized === undefined ? {} : { reason: sanitized };
}
