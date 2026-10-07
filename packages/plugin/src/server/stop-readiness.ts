/** The `timeline` part of the daemon's stop-readiness answer. */
export interface PluginTimelineStopReadiness {
  ready: boolean;
  /** The agent's timeline epoch (`PluginTimelineItemEvent.epoch`); null before any item. */
  epoch: string | null;
  emitted_through: number | null;
  acknowledged_through: number | null;
  reason?: string;
}

/** The `wip` part of the daemon's stop-readiness answer. */
export interface PluginWipStopReadiness {
  ready: boolean;
  /** A git ref name such as `refs/heads/wip/agent-1`. Never a URL. */
  ref?: string;
  /** The full commit id the ref points at. */
  sha?: string;
  reason?: string;
}

/** The answer to "would stopping now lose anything?". `ready` is `timeline.ready && wip.ready`. */
export interface PluginStopReadiness {
  ready: boolean;
  timeline: PluginTimelineStopReadiness;
  wip: PluginWipStopReadiness;
}

export interface PluginStopSignalContext {
  /** Aborted when the daemon stops waiting: at its shutdown, or at the drain deadline. */
  signal: AbortSignal;
}

/**
 * Answers whether stopping the daemon now would lose anything, and does the
 * work that makes it ready. Register it while the server entry sets up; one
 * plugin per daemon. Answers must carry no credential.
 */
export interface PluginStopReadinessProvider {
  /** Asked on every `GET /api/stop-readiness`. */
  readiness(): PluginStopReadiness | Promise<PluginStopReadiness>;
  /**
   * Called on `POST /api/begin-stopping` once the agents' running turns are
   * stopped, for example to commit and push work in progress. May be called
   * again on a later request.
   */
  stop?(context: PluginStopSignalContext): Promise<PluginWipStopReadiness>;
  /**
   * Resolves when every timeline item is acknowledged (or held as refused);
   * rejects on abort. Called on begin-stopping, in parallel with `stop`, and at
   * shutdown, where the daemon waits for it up to its drain deadline.
   */
  drain?(context: PluginStopSignalContext): Promise<void>;
}
