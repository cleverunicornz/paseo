import { describe, expect, test } from "vitest";
import { DrainGatewayCallers } from "./drain-callers.js";

const closing = { agentId: "agent-1", sessionId: "session-1", workspaceId: "workspace-1" };
const refused = { agentId: "agent-2", sessionId: "session-2", workspaceId: "workspace-2" };

/** Callers whose plugins hold undelivered timeline items of the agents in `undelivered`. */
function callersWithUndelivered(undelivered: Set<string>) {
  return new DrainGatewayCallers({
    hasUndeliveredTimeline: (agentId) => undelivered.has(agentId),
    refusedDrainMs: 300_000,
  });
}

describe("DrainGatewayCallers", () => {
  test("a retained agent's token resolves to the identity it had when the shutdown began", () => {
    const callers = callersWithUndelivered(new Set());
    callers.retain([closing]);

    const token = callers.issue("agent-1");

    expect(token).toEqual(expect.any(String));
    expect(callers.issue("agent-1")).toBe(token);
    expect(callers.resolve(token)).toEqual({ ...closing, drain: true });
  });

  test("an agent not closed by the shutdown gets no token, and unknown tokens resolve to nothing", () => {
    const callers = callersWithUndelivered(new Set(["closed-before-shutdown"]));
    callers.retain([closing]);

    expect(callers.issue("closed-before-shutdown")).toBeNull();
    expect(callers.resolve("not-a-token")).toBeNull();
    expect(callers.resolve(null)).toBeNull();
  });

  test("after the drain ends, nothing is issued, earlier tokens stop resolving, and nothing is retained again", () => {
    const callers = callersWithUndelivered(new Set(["agent-2"]));
    callers.retain([closing]);
    callers.retainRefused(refused);
    const token = callers.issue("agent-1");
    const refusedToken = callers.issue("agent-2");

    callers.end();

    expect(callers.resolve(token)).toBeNull();
    expect(callers.resolve(refusedToken)).toBeNull();
    expect(callers.issue("agent-1")).toBeNull();
    callers.retain([closing]);
    callers.retainRefused(refused);
    expect(callers.issue("agent-1")).toBeNull();
    expect(callers.issue("agent-2")).toBeNull();
  });

  test("an agent the session refused is admitted only while plugins hold its undelivered timeline items", () => {
    const undelivered = new Set(["agent-2"]);
    const callers = callersWithUndelivered(undelivered);
    callers.retainRefused(refused);

    const token = callers.issue("agent-2");
    expect(token).toEqual(expect.any(String));
    expect(callers.resolve(token)).toEqual({ ...refused, drain: true });

    // Every item it emitted before it closed is acknowledged: nothing more is admitted.
    undelivered.delete("agent-2");
    expect(callers.resolve(token)).toBeNull();
    expect(callers.issue("agent-2")).toBeNull();

    // An item offered again after a failed delivery admits the same identity again.
    undelivered.add("agent-2");
    expect(callers.issue("agent-2")).toBe(token);
    expect(callers.resolve(token)).toEqual({ ...refused, drain: true });
  });

  test("a refused agent the shutdown also closes keeps its identity until the shutdown's drain ends", () => {
    const callers = callersWithUndelivered(new Set());
    callers.retainRefused(refused);
    expect(callers.issue("agent-2")).toBeNull();

    callers.retain([refused]);

    expect(callers.resolve(callers.issue("agent-2"))).toEqual({ ...refused, drain: true });
  });

  test("a refused agent's drain identity ends timelineDrainMs after the refusal, though a plugin never acknowledges", () => {
    let now = 1_000;
    const callers = new DrainGatewayCallers({
      hasUndeliveredTimeline: () => true,
      refusedDrainMs: 300,
      now: () => now,
    });
    callers.retainRefused(refused);
    const token = callers.issue("agent-2");

    now += 299;
    expect(callers.resolve(token)).toEqual({ ...refused, drain: true });
    expect(callers.issue("agent-2")).toBe(token);

    now += 1;
    expect(callers.resolve(token)).toBeNull();
    expect(callers.issue("agent-2")).toBeNull();
    // The agent refused again later, after a resume, gets a window of its own.
    callers.retainRefused(refused);
    const next = callers.issue("agent-2");
    expect(next).toEqual(expect.any(String));
    expect(next).not.toBe(token);
    expect(callers.resolve(token)).toBeNull();
    now += 300;
    expect(callers.resolve(next)).toBeNull();
  });
});
