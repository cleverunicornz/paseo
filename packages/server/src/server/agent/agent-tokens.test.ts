import { describe, expect, test } from "vitest";

import { AgentTokenRegistry } from "./agent-tokens.js";

describe("AgentTokenRegistry", () => {
  test("a token identifies exactly the agent it was issued to", () => {
    const tokens = new AgentTokenRegistry();
    const first = tokens.issue("agent-1");
    const second = tokens.issue("agent-2");

    expect(first).not.toBe(second);
    expect(tokens.resolve(first)).toBe("agent-1");
    expect(tokens.resolve(second)).toBe("agent-2");
  });

  test("issuing again for the same agent returns its existing token", () => {
    const tokens = new AgentTokenRegistry();
    expect(tokens.issue("agent-1")).toBe(tokens.issue("agent-1"));
  });

  test("tokens are unguessable and carry no agent identity", () => {
    const tokens = new AgentTokenRegistry();
    const token = tokens.issue("agent-1");
    expect(token.length).toBeGreaterThanOrEqual(43);
    expect(token).not.toContain("agent-1");
  });

  test("unknown, empty, and missing tokens resolve to no agent", () => {
    const tokens = new AgentTokenRegistry();
    const token = tokens.issue("agent-1");
    expect(tokens.resolve(null)).toBeNull();
    expect(tokens.resolve("")).toBeNull();
    expect(tokens.resolve("agent-1")).toBeNull();
    expect(tokens.resolve(`${token}x`)).toBeNull();
  });

  test("revoking an agent invalidates its token and a later issue mints a new one", () => {
    const tokens = new AgentTokenRegistry();
    const original = tokens.issue("agent-1");
    const other = tokens.issue("agent-2");
    tokens.revoke("agent-1");

    expect(tokens.resolve(original)).toBeNull();
    expect(tokens.resolve(other)).toBe("agent-2");
    const reissued = tokens.issue("agent-1");
    expect(reissued).not.toBe(original);
    expect(tokens.resolve(reissued)).toBe("agent-1");
  });
});
