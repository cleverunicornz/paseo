import type { SessionIdentity } from "../session-runtime-config.js";

export class AgentManagerStoppingError extends Error {
  constructor(work: "agents" | "turns") {
    super(`Paseo is stopping and accepts no new ${work}`);
    this.name = "AgentManagerStoppingError";
  }
}

export class SingleAgentModeError extends Error {
  constructor(readonly liveAgentId: string | null) {
    super(
      liveAgentId
        ? `This Paseo runs one agent at a time and agent ${liveAgentId} is live; it cannot start another agent`
        : "This Paseo runs one agent at a time and another agent is starting; it cannot start another agent",
    );
    this.name = "SingleAgentModeError";
  }
}

export class SessionMemberError extends Error {
  constructor(
    readonly member: string,
    readonly attempted: string,
  ) {
    super(
      `This session's member is ${member}. This agent would run ${attempted}. A different model needs a new session.`,
    );
    this.name = "SessionMemberError";
  }
}

/** ASCII-only lowercasing, so Unicode case folding never turns another value into a member. */
function asciiLowercase(value: string): string {
  return value.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
}

export interface AgentAdmissionOptions {
  singleAgent: boolean;
  /** In session mode, the identity whose member every agent runs as. */
  sessionIdentity?: SessionIdentity | null;
  /** Ids of the public (non-internal) agents the manager currently holds. */
  listPublicAgentIds: () => string[];
  /** An archived agent loaded only to read its history does not count as live. */
  isArchived: (agentId: string) => Promise<boolean>;
}

/**
 * Decides whether the agent manager takes new agents and new turns: not once a
 * controller asked the daemon to begin stopping, in single-agent mode not
 * a second live agent, and in session mode no agent that runs another member.
 */
export class AgentAdmission {
  private stopping = false;
  private readonly reservations = new Set<string>();

  constructor(private readonly options: AgentAdmissionOptions) {}

  get singleAgent(): boolean {
    return this.options.singleAgent;
  }

  get isStopping(): boolean {
    return this.stopping;
  }

  beginStopping(): void {
    this.stopping = true;
  }

  assertAcceptingTurns(): void {
    if (this.stopping) throw new AgentManagerStoppingError("turns");
  }

  /**
   * In session mode, refuses any provider and model but the session's member.
   * The agent's value is compared lowercased and otherwise as given: a suffixed
   * variant such as `[1m]` is a different model.
   */
  assertRunsSessionMember(provider: string, model: string | null | undefined): void {
    const member = this.options.sessionIdentity?.member;
    if (member === undefined) return;
    const attempted = model
      ? asciiLowercase(`${provider}/${model}`)
      : `${asciiLowercase(provider)} without a model`;
    if (attempted !== member) throw new SessionMemberError(member, attempted);
  }

  /**
   * Admits a live agent, new or resumed from storage, and holds its place until `release` runs, so two
   * concurrent creates cannot both pass the single-agent check. Release once
   * the agent is registered or has failed to start.
   */
  async admitAgent(agentId: string, origin: "new" | "existing"): Promise<() => void> {
    if (this.stopping && origin === "new") throw new AgentManagerStoppingError("agents");
    if (!this.options.singleAgent) return () => {};
    if ([...this.reservations].some((reserved) => reserved !== agentId)) {
      throw new SingleAgentModeError(null);
    }
    this.reservations.add(agentId);
    const release = () => {
      this.reservations.delete(agentId);
    };
    try {
      for (const liveAgentId of this.options.listPublicAgentIds()) {
        if (liveAgentId === agentId) continue;
        if (!(await this.options.isArchived(liveAgentId))) {
          throw new SingleAgentModeError(liveAgentId);
        }
      }
    } catch (error) {
      release();
      throw error;
    }
    return release;
  }
}
