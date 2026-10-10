import { describe, expect, test } from "vitest";
import { ShutdownGatewayCallers } from "./shutdown-callers.js";

const closing = {
  agentId: "agent-1",
  sessionId: "session-1",
  workspaceId: "workspace-1",
  provider: "claude",
  model: "claude-opus-5-5",
};

describe("ShutdownGatewayCallers", () => {
  test("a retained agent's token resolves to the identity it had when the shutdown began", () => {
    const callers = new ShutdownGatewayCallers();
    callers.retain([closing]);

    const token = callers.issue("agent-1");

    expect(token).toEqual(expect.any(String));
    expect(callers.issue("agent-1")).toBe(token);
    expect(callers.resolve(token)).toEqual(closing);
  });

  test("an agent not closed by the shutdown gets no token, and unknown tokens resolve to nothing", () => {
    const callers = new ShutdownGatewayCallers();
    callers.retain([closing]);

    expect(callers.issue("closed-before-shutdown")).toBeNull();
    expect(callers.resolve("not-a-token")).toBeNull();
    expect(callers.resolve(null)).toBeNull();
  });

  test("after the drain ends, nothing is issued, earlier tokens stop resolving, and nothing is retained again", () => {
    const callers = new ShutdownGatewayCallers();
    callers.retain([closing]);
    const token = callers.issue("agent-1");

    callers.end();

    expect(callers.resolve(token)).toBeNull();
    expect(callers.issue("agent-1")).toBeNull();
    callers.retain([closing]);
    expect(callers.issue("agent-1")).toBeNull();
  });
});
