/**
 * Child-process fixture: pushes 24 distinct 2 MiB tool outputs through the real content limiter
 * into a real `TimelineProjection`, then reports the post-GC heap delta and the visible text.
 *
 * Run with: node --expose-gc --import tsx content-cap-retention-fixture.ts <shell|plain|error>
 */
import { createHash } from "node:crypto";

import { limitAgentTimelineItemContent } from "../agent-timeline-content.js";
import { TimelineProjection } from "../timeline-projection.js";
import type { AgentTimelineItem } from "../agent-sdk-types.js";

/** The three fields `limitAgentTimelineItemContent` caps at 64 KiB. */
type ContentCapField = "shell" | "plain" | "error";

const ITEM_COUNT = 24;
const SOURCE_CODE_UNITS = 2 * 1024 * 1024;
const MAX_LENGTH = 64 * 1024;
const TRUNCATION_NOTICE = "\n\n[Content truncated]";

/**
 * The cap boundary each field cuts at: shell output and failed-shell error content keep the full
 * 64 KiB, plain text reserves room for the truncation notice.
 */
export function visibleCapFor(field: ContentCapField): number {
  return field === "plain" ? MAX_LENGTH - TRUNCATION_NOTICE.length : MAX_LENGTH;
}

/**
 * A 2 MiB source whose surrogate pair straddles the cap boundary: the high surrogate is the last
 * kept code unit, its low surrogate is the first dropped one.
 */
export function buildOversizedText(field: ContentCapField, index: number): string {
  const boundary = visibleCapFor(field);
  const prefix = String(index).padStart(8, "0");
  const head = "x".repeat(boundary - 1 - prefix.length);
  const tail = "y".repeat(SOURCE_CODE_UNITS - boundary - 1);
  return `${prefix}${head}\u{1F600}${tail}`;
}

/** The text the limiter must keep, computed independently of it. */
export function expectedVisibleText(field: ContentCapField, index: number): string {
  const source = buildOversizedText(field, index);
  const head = source.slice(0, visibleCapFor(field));
  return field === "plain" ? `${head}${TRUNCATION_NOTICE}` : head;
}

function readVisibleText(field: ContentCapField, item: AgentTimelineItem): string {
  if (item.type !== "tool_call") {
    throw new Error("fixture expects a tool_call item");
  }
  if (field === "error") {
    return item.error?.content ?? "";
  }
  if (item.detail.type === "plain_text") {
    return item.detail.text;
  }
  if (item.detail.type === "shell") {
    return item.detail.output;
  }
  return "";
}

function forceGc(): number {
  for (let index = 0; index < 3; index += 1) {
    global.gc?.();
  }
  return process.memoryUsage().heapUsed;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function buildItem(field: ContentCapField, index: number, text: string): AgentTimelineItem {
  const base = {
    type: "tool_call" as const,
    callId: `call-${field}-${index}`,
    name: "synthetic",
  };
  if (field === "plain") {
    return { ...base, status: "completed", error: null, detail: { type: "plain_text", text } };
  }
  if (field === "error") {
    return {
      ...base,
      status: "failed",
      error: { content: text },
      detail: { type: "shell", command: "synthetic", output: "" },
    };
  }
  return {
    ...base,
    status: "completed",
    error: null,
    detail: { type: "shell", command: "synthetic", output: text },
  };
}

function main(): void {
  const field = (process.argv[2] ?? "shell") as ContentCapField;
  if (!global.gc) {
    throw new Error("Run this fixture with --expose-gc");
  }

  const projection = new TimelineProjection();
  (globalThis as Record<string, unknown>).fixtureProjection = projection;
  const visible: string[] = [];
  const expected: string[] = [];

  const baseline = forceGc();

  for (let index = 1; index <= ITEM_COUNT; index += 1) {
    const item = limitAgentTimelineItemContent(
      buildItem(field, index, buildOversizedText(field, index)),
    );
    visible.push(readVisibleText(field, item));
    expected.push(expectedVisibleText(field, index));
    projection.append({
      seq: index,
      item,
      timestamp: "2026-10-14T00:00:00Z",
    });
  }

  const retainedBytes = forceGc() - baseline;
  const visibleBytes = visible.reduce((total, text) => total + text.length * 2, 0);

  process.stdout.write(
    `${JSON.stringify({
      field,
      items: ITEM_COUNT,
      sourceCodeUnits: SOURCE_CODE_UNITS,
      sourceBytes: SOURCE_CODE_UNITS * 2,
      visibleBytes,
      retainedBytes,
      visibleLengths: visible.map((text) => text.length),
      matchesExpected: visible.every((text, index) => text === expected[index]),
      expectedSha256: expected.map(sha256),
      visibleSha256: visible.map(sha256),
      replacementCharacters: visible.reduce(
        (total, text) => total + (text.match(/�/g)?.length ?? 0),
        0,
      ),
      lastKeptCodeUnit: visible.map((text) => text.charCodeAt(visibleCapFor(field) - 1)),
      rows: projection.getRows().length,
    })}\n`,
  );
  process.exit(0);
}

main();
