import { describe, expect, it } from "vitest";
import type { DaemonServerInfo } from "@/stores/session-store";
import { selectAgentCreationBlocked, selectEveryHostAgentCreationBlocked } from "./host-features";

function state(input: {
  singleAgent?: boolean;
  agents: Array<{ id: string; archivedAt?: Date | null }>;
}) {
  const serverInfo = {
    features: input.singleAgent === undefined ? {} : { singleAgent: input.singleAgent },
  } as DaemonServerInfo;
  return {
    sessions: {
      host: {
        serverInfo,
        agents: new Map(input.agents.map((agent) => [agent.id, agent])),
      },
    },
  };
}

describe("selectAgentCreationBlocked", () => {
  it("blocks a new agent on a single-agent host that has a live agent", () => {
    expect(
      selectAgentCreationBlocked(state({ singleAgent: true, agents: [{ id: "a" }] }), "host"),
    ).toBe(true);
  });

  it("allows the first agent on a single-agent host, and one after the live agent is archived", () => {
    expect(selectAgentCreationBlocked(state({ singleAgent: true, agents: [] }), "host")).toBe(
      false,
    );
    expect(
      selectAgentCreationBlocked(
        state({ singleAgent: true, agents: [{ id: "a", archivedAt: new Date() }] }),
        "host",
      ),
    ).toBe(false);
  });

  it("never blocks on an ordinary host", () => {
    expect(selectAgentCreationBlocked(state({ agents: [{ id: "a" }, { id: "b" }] }), "host")).toBe(
      false,
    );
    expect(selectAgentCreationBlocked(state({ agents: [] }), "unknown-host")).toBe(false);
  });
});

describe("selectEveryHostAgentCreationBlocked", () => {
  const occupied = {
    serverInfo: { features: { singleAgent: true } } as DaemonServerInfo,
    agents: new Map([["a", { archivedAt: null }]]),
  };
  const ordinary = {
    serverInfo: { features: {} } as DaemonServerInfo,
    agents: new Map([["b", { archivedAt: null }]]),
  };

  it("withdraws app-wide agent starts only when every host is an occupied single-agent host", () => {
    expect(selectEveryHostAgentCreationBlocked({ sessions: { one: occupied } }, ["one"])).toBe(
      true,
    );
    expect(
      selectEveryHostAgentCreationBlocked({ sessions: { one: occupied, two: ordinary } }, [
        "one",
        "two",
      ]),
    ).toBe(false);
    expect(selectEveryHostAgentCreationBlocked({ sessions: {} }, [])).toBe(false);
  });
});
