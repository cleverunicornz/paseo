import type { PluginStopTimelineStream } from "@getpaseo/plugin/server";

interface DeliveryStream {
  pluginId: string;
  agentId: string;
  epoch: string;
  emittedThrough: number;
  pending: Set<number>;
  failed: Set<number>;
}

/** One plugin, agent and epoch whose deliveries did not all acknowledge before the drain deadline. */
export interface TimelineDrainFailure {
  pluginId: string;
  agentId: string;
  epoch: string;
  highestUnacknowledgedSeq: number;
  unacknowledged: number;
  deliveredThrough: number;
}

export type TimelineDrainResult =
  | { status: "drained" }
  | { status: "failed"; deadlineMs: number; failures: TimelineDrainFailure[] };

/**
 * Tracks every `agent.timeline_item` delivery to every plugin until the
 * plugin acknowledges it, so shutdown can wait for the deliveries still in
 * flight and report the ones that never acknowledged instead of dropping them.
 * A delivery fails when its handler throws or its plugin process goes away;
 * a failed delivery stays unacknowledged.
 */
export class TimelineDeliveryLedger {
  private readonly streams = new Map<string, DeliveryStream>();
  private readonly settledListeners = new Set<() => void>();

  sent(input: { pluginId: string; agentId: string; epoch: string; seq: number }): void {
    const stream = this.stream(input);
    stream.emittedThrough = Math.max(stream.emittedThrough, input.seq);
    stream.pending.add(input.seq);
  }

  acknowledged(input: { pluginId: string; agentId: string; epoch: string; seq: number }): void {
    const stream = this.stream(input);
    stream.pending.delete(input.seq);
    this.notifySettled();
  }

  failed(input: { pluginId: string; agentId: string; epoch: string; seq: number }): void {
    const stream = this.stream(input);
    if (stream.pending.delete(input.seq)) stream.failed.add(input.seq);
    this.notifySettled();
  }

  hasPending(pluginId?: string): boolean {
    for (const stream of this.streams.values()) {
      if (pluginId !== undefined && stream.pluginId !== pluginId) continue;
      if (stream.pending.size > 0) return true;
    }
    return false;
  }

  /** The plugin's view of its deliveries, as stop-readiness providers receive it. */
  describe(pluginId: string): PluginStopTimelineStream[] {
    return [...this.streams.values()]
      .filter((stream) => stream.pluginId === pluginId)
      .map((stream) => ({
        agentId: stream.agentId,
        epoch: stream.epoch,
        emittedThrough: stream.emittedThrough,
        deliveredThrough: deliveredThrough(stream),
        pending: stream.pending.size,
        failed: stream.failed.size,
      }));
  }

  /**
   * Waits until no delivery is pending or the deadline passes, whichever is
   * first. Every delivery still pending then, and every failed one, is
   * reported; none is counted as delivered.
   */
  async drain(deadlineMs: number): Promise<TimelineDrainResult> {
    await this.waitForSettled(deadlineMs);
    const failures = [...this.streams.values()]
      .filter((stream) => stream.pending.size > 0 || stream.failed.size > 0)
      .map((stream) => {
        return {
          pluginId: stream.pluginId,
          agentId: stream.agentId,
          epoch: stream.epoch,
          highestUnacknowledgedSeq: unacknowledgedBound(stream, "highest"),
          unacknowledged: stream.pending.size + stream.failed.size,
          deliveredThrough: deliveredThrough(stream),
        };
      });
    return failures.length === 0
      ? { status: "drained" }
      : { status: "failed", deadlineMs, failures };
  }

  private async waitForSettled(deadlineMs: number): Promise<void> {
    if (!this.hasPending()) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let listener: (() => void) | undefined;
    const deadline = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, deadlineMs);
    });
    const settled = new Promise<void>((resolve) => {
      listener = () => {
        if (!this.hasPending()) resolve();
      };
      this.settledListeners.add(listener);
    });
    await Promise.race([deadline, settled]);
    clearTimeout(timer);
    if (listener) this.settledListeners.delete(listener);
  }

  private notifySettled(): void {
    for (const listener of this.settledListeners) listener();
  }

  private stream(input: { pluginId: string; agentId: string; epoch: string }): DeliveryStream {
    const key = JSON.stringify([input.pluginId, input.agentId, input.epoch]);
    let stream = this.streams.get(key);
    if (!stream) {
      stream = {
        pluginId: input.pluginId,
        agentId: input.agentId,
        epoch: input.epoch,
        emittedThrough: 0,
        pending: new Set(),
        failed: new Set(),
      };
      this.streams.set(key, stream);
    }
    return stream;
  }
}

function deliveredThrough(stream: DeliveryStream): number {
  if (stream.pending.size === 0 && stream.failed.size === 0) return stream.emittedThrough;
  return unacknowledgedBound(stream, "lowest") - 1;
}

function unacknowledgedBound(stream: DeliveryStream, bound: "lowest" | "highest"): number {
  let result = bound === "lowest" ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
  for (const seqs of [stream.pending, stream.failed]) {
    for (const seq of seqs) {
      result = bound === "lowest" ? Math.min(result, seq) : Math.max(result, seq);
    }
  }
  return result;
}
