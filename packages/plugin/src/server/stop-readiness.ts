import type { PaseoApi } from "@getpaseo/client";

/**
 * What the daemon sent one plugin as `agent.timeline_item` for one agent and
 * epoch, and what that plugin's handlers finished. A delivery is acknowledged
 * when every handler for it resolved; a handler that throws leaves it failed.
 */
export interface PluginStopTimelineStream {
  agentId: string;
  epoch: string;
  /** Highest `seq` sent to this plugin. */
  emittedThrough: number;
  /** Every item sent to this plugin with `seq <= deliveredThrough` was acknowledged. */
  deliveredThrough: number;
  /** Items sent whose handlers have not finished yet. */
  pending: number;
  /** Items sent whose handlers threw, or whose plugin process exited first. */
  failed: number;
}

export interface PluginStopContext {
  paseo: PaseoApi;
  /** True once a controller asked the daemon to begin stopping. */
  stopping: boolean;
  /** This plugin's timeline deliveries, one entry per agent and epoch. */
  timeline: PluginStopTimelineStream[];
}

/** The `timeline` part of the daemon's stop-readiness answer. */
export interface PluginTimelineStopReadiness {
  ready: boolean;
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

/**
 * Answers whether stopping the daemon now would lose anything. Register it
 * while the plugin's server entry sets up. Each part is optional; when no
 * plugin provides a part the daemon answers it `ready: false` with reason
 * `no provider`, and when several plugins provide the same part, with reason
 * `multiple providers`. Answers must carry no credential.
 */
export interface PluginStopReadinessProvider {
  timeline?(
    context: PluginStopContext,
  ): PluginTimelineStopReadiness | Promise<PluginTimelineStopReadiness>;
  wip?(context: PluginStopContext): PluginWipStopReadiness | Promise<PluginWipStopReadiness>;
  /**
   * Called each time a controller asks the daemon to begin stopping. Start the
   * work that makes the parts ready (for example a WIP commit and push). The
   * daemon does not wait for it; it may be called more than once.
   */
  beginStopping?(context: PluginStopContext): void | Promise<void>;
}
