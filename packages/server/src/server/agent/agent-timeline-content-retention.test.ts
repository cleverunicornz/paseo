import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

import { limitAgentTimelineItemContent } from "./agent-timeline-content.js";

type ContentCapField = "shell" | "plain" | "error";

interface ContentCapResult {
  field: ContentCapField;
  items: number;
  sourceCodeUnits: number;
  sourceBytes: number;
  visibleBytes: number;
  retainedBytes: number;
  visibleLengths: number[];
  matchesExpected: boolean;
  expectedSha256: string[];
  visibleSha256: string[];
  replacementCharacters: number;
  lastKeptCodeUnit: number[];
  rows: number;
}

function measureCappedRetention(field: ContentCapField): ContentCapResult {
  const fixture = fileURLToPath(
    new URL("./test-utils/content-cap-retention-fixture.ts", import.meta.url),
  );
  const stdout = execFileSync(
    process.execPath,
    ["--expose-gc", "--import", "tsx", fixture, field],
    {
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  const line = stdout.trim().split("\n").at(-1);
  if (!line) {
    throw new Error(`Retention fixture produced no output for ${field}`);
  }
  return JSON.parse(line) as ContentCapResult;
}

const MAX_LENGTH = 64 * 1024;
const TRUNCATION_NOTICE = "\n\n[Content truncated]";
const HIGH_SURROGATE = 0xd83d;

describe("agent timeline content cap retention", () => {
  for (const field of ["shell", "plain", "error"] as const) {
    test(`${field} keeps the 64 KiB cap without retaining the source output`, () => {
      const result = measureCappedRetention(field);

      expect(result.items).toBe(24);
      expect(result.rows).toBe(24);
      expect(result.sourceCodeUnits).toBe(2 * 1024 * 1024);
      for (const length of result.visibleLengths) {
        expect(length).toBeLessThanOrEqual(MAX_LENGTH);
      }
      // 24 x 64 KiB of retained text plus fixture overhead. The 24 x 2 MiB sources would be
      // 100 MiB of backing store if each capped prefix still referred to its original string.
      expect(result.retainedBytes).toBeLessThan(result.visibleBytes + 8 * 1024 * 1024);
      expect(result.retainedBytes).toBeLessThan((result.sourceBytes * result.items) / 8);
    });

    test(`${field} cuts a split surrogate pair at the cap without corruption`, () => {
      const result = measureCappedRetention(field);

      expect(result.matchesExpected).toBe(true);
      expect(result.visibleSha256).toEqual(result.expectedSha256);
      expect(result.replacementCharacters).toBe(0);
      // The source puts a high surrogate at the last kept code unit; the low surrogate is
      // dropped. Slicing must not turn either into a replacement character.
      for (const lastKept of result.lastKeptCodeUnit) {
        expect(lastKept).toBe(HIGH_SURROGATE);
      }
    });
  }

  test("plain-text truncation keeps the notice after a split surrogate pair", () => {
    const cap = MAX_LENGTH - TRUNCATION_NOTICE.length;
    const prefix = "x".repeat(cap - 1);
    const item = limitAgentTimelineItemContent({
      type: "tool_call",
      callId: "terminal-session-surrogate",
      name: "terminal",
      status: "completed",
      error: null,
      detail: { type: "plain_text", text: `${prefix}\u{1F600}${"y".repeat(1024)}` },
    });

    if (item.type !== "tool_call" || item.detail.type !== "plain_text") {
      throw new Error("expected a plain-text tool call");
    }
    const text = item.detail.text;
    if (text === undefined) {
      throw new Error("expected plain-text detail");
    }
    expect(text.length).toBe(MAX_LENGTH);
    expect(text.charCodeAt(cap - 1)).toBe(HIGH_SURROGATE);
    expect(text.endsWith(TRUNCATION_NOTICE)).toBe(true);
  });
});
