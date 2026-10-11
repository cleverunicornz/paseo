import { createHash, randomBytes } from "node:crypto";
import type { McpGatewayAgent } from "./mcp-gateway.js";

function digest(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Until when a retained agent's identity is admitted. */
type Retention =
  /** Until the shutdown's timeline drain ends. */
  | "shutdown"
  /** While plugins still hold timeline items of the agent that they have not acknowledged. */
  | "undelivered";

/**
 * The gateway identities of agents that no longer run but whose timeline items
 * plugins still deliver, kept so plugins can call the gateway on their behalf
 * for that delivery: the agents a shutdown closes, until the shutdown's
 * timeline drain ends, and the agents the session refused for running another
 * model, while plugins hold any of their items unacknowledged. A closed agent
 * adds no timeline items, so those are items it emitted before it closed.
 *
 * Each identity is captured before its agent closes, and the table mints a
 * separate token per agent that only the daemon ever holds: the agent's own
 * token, which its harness and the processes it ran received, is not revived,
 * and stays refused. An agent whose close failed stays live and calls with its
 * own token as before. `end` drops every identity and token once the
 * shutdown's drain is over.
 */
export class DrainGatewayCallers {
  private readonly retained = new Map<string, { agent: McpGatewayAgent; until: Retention }>();
  private readonly agentByDigest = new Map<string, string>();
  private readonly tokenByAgent = new Map<string, string>();
  private ended = false;

  constructor(private readonly hasUndeliveredTimeline: (agentId: string) => boolean) {}

  /** Keeps the identities of the agents the shutdown is about to close. */
  retain(agents: readonly McpGatewayAgent[]): void {
    if (this.ended) return;
    for (const agent of agents) this.retained.set(agent.agentId, { agent, until: "shutdown" });
  }

  /** Keeps the identity of an agent the session refused, before it closes. */
  retainRefused(agent: McpGatewayAgent): void {
    if (this.ended || this.retained.has(agent.agentId)) return;
    this.retained.set(agent.agentId, { agent, until: "undelivered" });
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
    this.retained.clear();
    this.agentByDigest.clear();
    this.tokenByAgent.clear();
  }

  private admits(agentId: string): boolean {
    if (this.ended) return false;
    const retained = this.retained.get(agentId);
    if (!retained) return false;
    return retained.until === "shutdown" || this.hasUndeliveredTimeline(agentId);
  }
}
