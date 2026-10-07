import { createHash, randomBytes } from "node:crypto";
import type { McpGatewayAgent } from "./mcp-gateway.js";

function digest(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * The gateway identities of the agents a shutdown closes, kept so plugins can
 * still call the gateway on their behalf while the timeline drain runs.
 *
 * Shutdown closes agents before it drains, so nothing new reaches the
 * timeline, and closing revokes each agent's own token. This table holds the
 * identity each agent had, captured before it closed, and mints a separate
 * token per agent that only the daemon ever holds: the agent's own token,
 * which its harness and the processes it ran received, is not revived. The
 * table admits only agents captured when the shutdown began, and `end` drops
 * every identity and token once the drain is over.
 */
export class ShutdownGatewayCallers {
  private readonly identities = new Map<string, McpGatewayAgent>();
  private readonly agentByDigest = new Map<string, string>();
  private readonly tokenByAgent = new Map<string, string>();
  private ended = false;

  /** Keeps the identities of the agents the shutdown is about to close. */
  retain(agents: readonly McpGatewayAgent[]): void {
    if (this.ended) return;
    for (const agent of agents) this.identities.set(agent.agentId, agent);
  }

  /** The daemon-only token for a retained agent, or null for any other id or after `end`. */
  issue(agentId: string): string | null {
    if (this.ended || !this.identities.has(agentId)) return null;
    const existing = this.tokenByAgent.get(agentId);
    if (existing) return existing;
    const token = randomBytes(32).toString("base64url");
    this.tokenByAgent.set(agentId, token);
    this.agentByDigest.set(digest(token), agentId);
    return token;
  }

  /** The retained identity a token was issued for, or null. */
  resolve(token: string | null): McpGatewayAgent | null {
    if (this.ended || !token) return null;
    const agentId = this.agentByDigest.get(digest(token));
    return agentId ? (this.identities.get(agentId) ?? null) : null;
  }

  /** The drain is over: nothing resolves or issues from here on. */
  end(): void {
    this.ended = true;
    this.identities.clear();
    this.agentByDigest.clear();
    this.tokenByAgent.clear();
  }
}
