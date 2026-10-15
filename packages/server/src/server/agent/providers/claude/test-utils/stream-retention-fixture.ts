/**
 * Child-process fixture: drives the real Claude `TimelineAssembler` with many small streamed
 * chunks, retains its output in a real `TimelineProjection`, and reports the post-GC heap delta.
 *
 * Run with: node --expose-gc --import tsx stream-retention-fixture.ts <assistant|reasoning>
 */
import { createHash } from "node:crypto";

import { ClaudeAgentClient } from "../agent.js";
import { TimelineProjection } from "../../../timeline-projection.js";
import { createTestLogger } from "../../../../../test-utils/test-logger.js";
import type { AgentTimelineItem } from "../../../agent-sdk-types.js";

const CHUNK_CODE_UNITS = 64;
const CHUNK_COUNT = 2048;
/** The split surrogate pair straddles the boundary between chunk 3 and chunk 4. */
const SURROGATE_HIGH_INDEX = CHUNK_CODE_UNITS * 4 - 1;

function buildStreamedText(): string {
  const total = CHUNK_CODE_UNITS * CHUNK_COUNT;
  const head = "x".repeat(SURROGATE_HIGH_INDEX);
  const tail = "y".repeat(total - SURROGATE_HIGH_INDEX - 2);
  return `${head}\u{1F600}${tail}`;
}

function chunkText(text: string): string[] {
  const chunks: string[] = [];
  for (let offset = 0; offset < text.length; offset += CHUNK_CODE_UNITS) {
    chunks.push(text.slice(offset, offset + CHUNK_CODE_UNITS));
  }
  return chunks;
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

async function main(): Promise<void> {
  const kind = process.argv[2] === "reasoning" ? "reasoning" : "assistant";
  if (!global.gc) {
    throw new Error("Run this fixture with --expose-gc");
  }

  const client = new ClaudeAgentClient({
    logger: createTestLogger(),
    queryFactory() {
      throw new Error("fixture never reaches the model");
    },
    resolveBinary: async () => "/nonexistent/claude",
  });
  const session = await client.createSession({
    provider: "claude",
    cwd: process.cwd(),
    modeId: "default",
  });
  const assembler = (
    session as unknown as {
      timelineAssembler: {
        consume(input: {
          message: unknown;
          runId: string | null;
          messageIdHint?: string | null;
        }): AgentTimelineItem[];
      };
    }
  ).timelineAssembler;

  const projection = new TimelineProjection();
  (globalThis as Record<string, unknown>).fixtureProjection = projection;

  const expected = buildStreamedText();
  const chunks = chunkText(expected);
  const emitted: string[] = [];

  const baseline = forceGc();

  for (const [index, chunk] of chunks.entries()) {
    const delta =
      kind === "reasoning"
        ? { type: "thinking_delta", thinking: chunk }
        : { type: "text_delta", text: chunk };
    const items = assembler.consume({
      message: { type: "stream_event", event: { type: "content_block_delta", delta } },
      runId: "fixture-run",
      messageIdHint: "fixture-message",
    });
    for (const item of items) {
      if (item.type !== "assistant_message" && item.type !== "reasoning") {
        continue;
      }
      emitted.push(item.text);
      projection.append({
        seq: index + 1,
        item,
        timestamp: "2026-10-15T00:00:00Z",
        turnId: "fixture-run",
      });
    }
  }

  const stopItems = assembler.consume({
    message: { type: "stream_event", event: { type: "message_stop" } },
    runId: "fixture-run",
    messageIdHint: "fixture-message",
  });
  for (const item of stopItems) {
    if (item.type === "assistant_message" || item.type === "reasoning") {
      emitted.push(item.text);
    }
  }

  const joined = emitted.join("");
  const retainedBytes = forceGc() - baseline;
  const rows = projection.getRows();

  process.stdout.write(
    `${JSON.stringify({
      kind,
      chunks: chunks.length,
      visibleCodeUnits: expected.length,
      visibleBytes: expected.length * 2,
      emittedItems: emitted.length,
      joinedEqualsExpected: joined === expected,
      joinedSha256: sha256(joined),
      expectedSha256: sha256(expected),
      firstSplitCodeUnit: chunks[3].charCodeAt(CHUNK_CODE_UNITS - 1),
      secondSplitCodeUnit: chunks[4].charCodeAt(0),
      retainedBytes,
      rows: rows.length,
    })}\n`,
  );
  process.exit(0);
}

void main();
