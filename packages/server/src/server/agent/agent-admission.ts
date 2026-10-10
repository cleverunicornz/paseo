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

export interface AgentAdmissionOptions {
  singleAgent: boolean;
  /** Ids of the public (non-internal) agents the manager currently holds. */
  listPublicAgentIds: () => string[];
  /** An archived agent loaded only to read its history does not count as live. */
  isArchived: (agentId: string) => Promise<boolean>;
}

/**
 * Decides whether the agent manager takes new agents and new turns: not once a
 * controller asked the daemon to begin stopping, and in single-agent mode not
 * a second live agent.
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
