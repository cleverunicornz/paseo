import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

interface StreamRetentionResult {
  kind: "assistant" | "reasoning";
  chunks: number;
  visibleCodeUnits: number;
  visibleBytes: number;
  emittedItems: number;
  joinedEqualsExpected: boolean;
  joinedSha256: string;
  expectedSha256: string;
  firstSplitCodeUnit: number;
  secondSplitCodeUnit: number;
  retainedBytes: number;
  rows: number;
}

function measureStreamedRetention(kind: "assistant" | "reasoning"): StreamRetentionResult {
  const fixture = fileURLToPath(
    new URL("./test-utils/stream-retention-fixture.ts", import.meta.url),
  );
  const stdout = execFileSync(process.execPath, ["--expose-gc", "--import", "tsx", fixture, kind], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  const line = stdout.trim().split("\n").at(-1);
  if (!line) {
    throw new Error(`Retention fixture produced no output for ${kind}`);
  }
  return JSON.parse(line) as StreamRetentionResult;
}

test.each(["assistant", "reasoning"] as const)(
  "%s chunks do not retain the accumulated text backing store",
  (kind) => {
    const result = measureStreamedRetention(kind);

    expect(result.chunks).toBe(2048);
    expect(result.rows).toBe(1);
    expect(result.retainedBytes).toBeLessThan(result.visibleBytes * 32);
  },
  60_000,
);

test.each(["assistant", "reasoning"] as const)(
  "%s chunks emit text, message ids and item counts unchanged",
  (kind) => {
    const result = measureStreamedRetention(kind);

    expect(result.joinedEqualsExpected).toBe(true);
    expect(result.joinedSha256).toBe(result.expectedSha256);
    expect(result.emittedItems).toBe(2048);
  },
  60_000,
);

test("an assistant split surrogate pair survives the chunk boundary", () => {
  const result = measureStreamedRetention("assistant");

  expect(result.firstSplitCodeUnit).toBe(0xd83d);
  expect(result.secondSplitCodeUnit).toBe(0xde00);
  expect(result.joinedEqualsExpected).toBe(true);
}, 60_000);

test("a reasoning split surrogate pair survives the chunk boundary", () => {
  const result = measureStreamedRetention("reasoning");

  expect(result.firstSplitCodeUnit).toBe(0xd83d);
  expect(result.secondSplitCodeUnit).toBe(0xde00);
  expect(result.joinedEqualsExpected).toBe(true);
}, 60_000);
