import type { PluginLifecycleEvents } from "@getpaseo/plugin/server";

export type TimelineItemEvent = PluginLifecycleEvents["agent.timeline_item"];

interface DeliveryStream {
  pluginId: string;
  agentId: string;
  epoch: string;
  emittedThrough: number;
  pending: Set<number>;
  /** When each failed delivery failed, by `seq`. */
  failed: Map<number, number>;
  /** The event of every delivery not yet acknowledged, kept to offer it again. */
  events: Map<number, TimelineItemEvent>;
  lastSentAt: number;
}

export interface TimelineDelivery {
  pluginId: string;
  agentId: string;
  epoch: string;
  seq: number;
}

/** What plugins have not acknowledged, and the most recently active such stream. */
export interface UnacknowledgedTimeline {
  count: number;
  epoch: string;
  emittedThrough: number;
  deliveredThrough: number;
}

/** One plugin, agent and epoch whose deliveries did not all acknowledge before the drain deadline. */
export interface TimelineDrainFailure {
  pluginId: string;
  agentId: string;
  epoch: string;
  highestUnacknowledgedSeq: number;
  unacknowledged: number;
  /** Every `seq` still pending or failed, ascending. */
  unacknowledgedSeqs: number[];
  deliveredThrough: number;
}

/**
 * Tracks every `agent.timeline_item` delivery to every plugin until the
 * plugin acknowledges it, so shutdown can wait for the deliveries still in
 * flight and report the ones that never acknowledged instead of dropping them.
 * A delivery fails when its handler throws or its plugin process goes away;
 * a failed delivery stays unacknowledged until it is offered again and that
 * offer is acknowledged.
 */
export class TimelineDeliveryLedger {
  private readonly streams = new Map<string, DeliveryStream>();
  private readonly settledListeners = new Set<() => void>();

  private sentCount = 0;

  sent(input: TimelineDelivery, event: TimelineItemEvent): void {
    const stream = this.stream(input);
    stream.emittedThrough = Math.max(stream.emittedThrough, input.seq);
    stream.pending.add(input.seq);
    stream.events.set(input.seq, event);
    stream.lastSentAt = ++this.sentCount;
  }

  acknowledged(input: TimelineDelivery): void {
    const stream = this.stream(input);
    if (stream.pending.delete(input.seq)) stream.events.delete(input.seq);
    this.notifySettled();
  }

  failed(input: TimelineDelivery): void {
    const stream = this.stream(input);
    if (stream.pending.delete(input.seq)) stream.failed.set(input.seq, Date.now());
    this.notifySettled();
  }

  /**
   * Hands back the plugin's failed deliveries that failed at least
   * `minAgeMs` ago, now pending again, for the caller to offer once more.
   */
  takeFailed(
    pluginId: string,
    minAgeMs: number,
  ): Array<{ delivery: TimelineDelivery; event: TimelineItemEvent }> {
    const now = Date.now();
    const taken: Array<{ delivery: TimelineDelivery; event: TimelineItemEvent }> = [];
    for (const stream of this.streams.values()) {
      if (stream.pluginId !== pluginId) continue;
      for (const [seq, failedAt] of stream.failed) {
        const event = stream.events.get(seq);
        if (!event || now - failedAt < minAgeMs) continue;
        stream.failed.delete(seq);
        stream.pending.add(seq);
        taken.push({
          delivery: { pluginId, agentId: stream.agentId, epoch: stream.epoch, seq },
          event,
        });
      }
    }
    return taken.sort((left, right) => left.delivery.seq - right.delivery.seq);
  }

  /** Pending and failed deliveries to every plugin; null when all are acknowledged. */
  unacknowledged(): UnacknowledgedTimeline | null {
    let count = 0;
    let latest: DeliveryStream | null = null;
    for (const stream of this.streams.values()) {
      const open = stream.pending.size + stream.failed.size;
      if (open === 0) continue;
      count += open;
      if (!latest || stream.lastSentAt > latest.lastSentAt) latest = stream;
    }
    if (!latest) return null;
    return {
      count,
      epoch: latest.epoch,
      emittedThrough: latest.emittedThrough,
      deliveredThrough: deliveredThrough(latest),
    };
  }

  private hasPending(): boolean {
    for (const stream of this.streams.values()) {
      if (stream.pending.size > 0) return true;
    }
    return false;
  }

  /**
   * Waits until no delivery to any plugin is pending, or until `deadline`
   * aborts. Items sent while it waits are waited for too: every settled
   * delivery checks the whole ledger again, so it returns only when nothing,
   * old or new, is in flight. Every delivery still pending then, and every
   * failed one, is reported; none is counted as delivered. An empty list
   * means everything sent so far was acknowledged.
   */
  async drain(deadline: AbortSignal): Promise<TimelineDrainFailure[]> {
    await this.waitForSettled(deadline);
    return [...this.streams.values()]
      .filter((stream) => stream.pending.size > 0 || stream.failed.size > 0)
      .map((stream) => ({
        pluginId: stream.pluginId,
        agentId: stream.agentId,
        epoch: stream.epoch,
        highestUnacknowledgedSeq: unacknowledgedBound(stream, "highest"),
        unacknowledged: stream.pending.size + stream.failed.size,
        unacknowledgedSeqs: [...stream.pending, ...stream.failed.keys()].sort((a, b) => a - b),
        deliveredThrough: deliveredThrough(stream),
      }));
  }

  private async waitForSettled(deadline: AbortSignal): Promise<void> {
    if (!this.hasPending() || deadline.aborted) return;
    let listener: (() => void) | undefined;
    let onAbort: (() => void) | undefined;
    await new Promise<void>((resolve) => {
      listener = () => {
        if (!this.hasPending()) resolve();
      };
      onAbort = resolve;
      this.settledListeners.add(listener);
      deadline.addEventListener("abort", onAbort, { once: true });
    });
    if (listener) this.settledListeners.delete(listener);
    if (onAbort) deadline.removeEventListener("abort", onAbort);
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
        failed: new Map(),
        events: new Map(),
        lastSentAt: 0,
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
  for (const seqs of [stream.pending, stream.failed.keys()]) {
    for (const seq of seqs) {
      result = bound === "lowest" ? Math.min(result, seq) : Math.max(result, seq);
    }
  }
  return result;
}
