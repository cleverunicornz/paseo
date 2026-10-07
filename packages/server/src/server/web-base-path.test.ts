import { describe, expect, test } from "vitest";
import { stripWebBasePath } from "./web-base-path.js";

describe("stripWebBasePath", () => {
  test("routes a prefixed path as if it came without the prefix", () => {
    expect(stripWebBasePath("/s/abc/ws", "/s/abc/")).toBe("/ws");
    expect(stripWebBasePath("/s/abc/api/stop-readiness?x=1", "/s/abc/")).toBe(
      "/api/stop-readiness?x=1",
    );
    expect(stripWebBasePath("/s/abc/", "/s/abc/")).toBe("/");
    expect(stripWebBasePath("/s/abc", "/s/abc/")).toBe("/");
    expect(stripWebBasePath("/s/abc?x=1", "/s/abc/")).toBe("/?x=1");
  });

  test("leaves paths outside the prefix alone", () => {
    expect(stripWebBasePath("/mcp/agents", "/s/abc/")).toBeNull();
    expect(stripWebBasePath("/s/abcd/ws", "/s/abc/")).toBeNull();
    expect(stripWebBasePath("/anything", "/")).toBe("/anything");
  });
});
