import { createHash, randomBytes } from "node:crypto";
import type { McpGatewayAgent } from "./mcp-gateway.js";

function digest(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Until when a retained agent's identity is admitted. */
type Retention =
  /** Until the shutdown's timeline drain ends. */
  | { kind: "shutdown" }
  /**
   * While plugins still hold timeline items of the agent that they have not
   * acknowledged, and at most until `deadline`.
   */
  | { kind: "undelivered"; deadline: number; expiry: NodeJS.Timeout };

export interface DrainGatewayCallersOptions {
  hasUndeliveredTimeline: (agentId: string) => boolean;
  /** How long after its refusal a refused agent's identity is admitted at most: `timelineDrainMs`. */
  refusedDrainMs: number;
  now?: () => number;
}

/**
 * The gateway identities of agents that no longer run but whose timeline items
 * plugins still deliver, kept so plugins can call the gateway on their behalf
 * for that delivery: the agents a shutdown closes, until the shutdown's
 * timeline drain ends, and the agents the session refused for running another
 * model, while plugins hold any of their items unacknowledged and for at most
 * `refusedDrainMs` from the refusal, the same bound a shutdown's drain has. A
 * closed agent adds no timeline items, so those are items it emitted before it
 * closed.
 *
 * Each identity is captured before its agent closes, and the table mints a
 * separate token per agent that only the daemon ever holds: the agent's own
 * token, which its harness and the processes it ran received, is not revived,
 * and stays refused. An agent whose close failed stays live and calls with its
 * own token as before. A refused identity is dropped with its token by a timer
 * at its deadline, whether or not anything looks it up again; `end` drops every
 * identity and token once the shutdown's drain is over.
 */
export class DrainGatewayCallers {
  private readonly retained = new Map<string, { agent: McpGatewayAgent; until: Retention }>();
  private readonly agentByDigest = new Map<string, string>();
  private readonly tokenByAgent = new Map<string, string>();
  private readonly hasUndeliveredTimeline: (agentId: string) => boolean;
  private readonly refusedDrainMs: number;
  private readonly now: () => number;
  private ended = false;

  constructor(options: DrainGatewayCallersOptions) {
    this.hasUndeliveredTimeline = options.hasUndeliveredTimeline;
    this.refusedDrainMs = options.refusedDrainMs;
    this.now = options.now ?? Date.now;
  }

  /** Keeps the identities of the agents the shutdown is about to close. */
  retain(agents: readonly McpGatewayAgent[]): void {
    if (this.ended) return;
    for (const agent of agents) {
      this.clearExpiry(agent.agentId);
      this.retained.set(agent.agentId, { agent, until: { kind: "shutdown" } });
    }
  }

  /**
   * Keeps the identity of an agent the session refused, before it closes, for
   * `refusedDrainMs`. Each refusal starts its own window with its own token.
   */
  retainRefused(agent: McpGatewayAgent): void {
    if (this.ended || this.retained.get(agent.agentId)?.until.kind === "shutdown") return;
    this.drop(agent.agentId);
    const expiry = setTimeout(() => {
      // Only this window: a later refusal of the agent replaced the entry and its timer.
      if (this.retained.get(agent.agentId) === entry) this.drop(agent.agentId);
    }, this.refusedDrainMs);
    expiry.unref();
    const entry = {
      agent,
      until: {
        kind: "undelivered" as const,
        deadline: this.now() + this.refusedDrainMs,
        expiry,
      },
    };
    this.retained.set(agent.agentId, entry);
  }

  /** The daemon-only token for an admitted agent, or null for any other id or after `end`. */
  issue(agentId: string): string | null {
    if (!this.admits(agentId)) return null;
    const existing = this.tokenByAgent.get(agentId);
    if (existing) return existing;
    const token = randomBytes(32).toString("base64url");
    this.tokenByAgent.set(agentId, token);
    this.agentByDigest.set(digest(token), agentId);
    return token;
  }

  /** The retained identity a token was issued for, while it is admitted, marked as a drain call; or null. */
  resolve(token: string | null): McpGatewayAgent | null {
    if (!token) return null;
    const agentId = this.agentByDigest.get(digest(token));
    if (!agentId || !this.admits(agentId)) return null;
    const retained = this.retained.get(agentId);
    return retained ? { ...retained.agent, drain: true } : null;
  }

  /** The shutdown's drain is over: nothing resolves or issues from here on. */
  end(): void {
    this.ended = true;
    for (const agentId of this.retained.keys()) this.clearExpiry(agentId);
    this.retained.clear();
    this.agentByDigest.clear();
    this.tokenByAgent.clear();
  }

  private admits(agentId: string): boolean {
    if (this.ended) return false;
    const retained = this.retained.get(agentId);
    if (!retained) return false;
    if (retained.until.kind === "shutdown") return true;
    if (this.now() >= retained.until.deadline) {
      this.drop(agentId);
      return false;
    }
    return this.hasUndeliveredTimeline(agentId);
  }

  private clearExpiry(agentId: string): void {
    const until = this.retained.get(agentId)?.until;
    if (until?.kind === "undelivered") clearTimeout(until.expiry);
  }

  private drop(agentId: string): void {
    this.clearExpiry(agentId);
    this.retained.delete(agentId);
    const token = this.tokenByAgent.get(agentId);
    if (!token) return;
    this.tokenByAgent.delete(agentId);
    this.agentByDigest.delete(digest(token));
  }
}
