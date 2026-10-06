import { createHash, randomBytes } from "node:crypto";

function digest(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Per-agent bearer tokens for the agent → daemon hop (/mcp/agents and the MCP
 * gateway). The daemon derives a caller's identity from its token alone.
 * Tokens live in memory only, end when the agent closes or the daemon stops,
 * and are looked up by a SHA-256 digest of the token.
 */
export class AgentTokenRegistry {
  private readonly agentByDigest = new Map<string, string>();
  private readonly tokenByAgent = new Map<string, string>();

  /** Returns the agent's token, minting one on first use. */
  issue(agentId: string): string {
    const existing = this.tokenByAgent.get(agentId);
    if (existing) {
      return existing;
    }
    const token = randomBytes(32).toString("base64url");
    this.tokenByAgent.set(agentId, token);
    this.agentByDigest.set(digest(token), agentId);
    return token;
  }

  resolve(token: string | null | undefined): string | null {
    if (!token) {
      return null;
    }
    return this.agentByDigest.get(digest(token)) ?? null;
  }

  revoke(agentId: string): void {
    const token = this.tokenByAgent.get(agentId);
    if (!token) {
      return;
    }
    this.tokenByAgent.delete(agentId);
    this.agentByDigest.delete(digest(token));
  }
}
