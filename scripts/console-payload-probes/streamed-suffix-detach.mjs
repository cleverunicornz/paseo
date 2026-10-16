// Compiled-payload probe: the streamed-suffix detach behaves as the heap fix
// specifies. `argv[2]` is the built server's `dist/server`.
//
// The validator's r1 negative control reverted the Claude stream helper to a
// bare `text.slice(start)` and every marker string still passed, because the
// sibling cap helper kept `utf16le` in the tree. Here the built assembler must
// stream 2,048 small chunks without retaining the accumulated text's backing
// store, and must join them into exactly the text that was streamed.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";

if (!globalThis.gc) {
  throw new Error("Run this probe with --expose-gc");
}

const root = path.resolve(process.argv[2] ?? "");
const load = (relative) => import(pathToFileURL(path.join(root, relative)));
const { ClaudeAgentClient } = await load("server/agent/providers/claude/agent.js");
const { TimelineProjection } = await load("server/agent/timeline-projection.js");
assert.equal(typeof ClaudeAgentClient, "function", "the built agent client is absent");

const CHUNK_CODE_UNITS = 64;
const CHUNK_COUNT = 2048;
/** The split surrogate pair straddles the boundary between chunk 3 and chunk 4. */
const SURROGATE_HIGH_INDEX = CHUNK_CODE_UNITS * 4 - 1;

const logger = {
  child() {
    return this;
  },
  trace() {},
  debug() {},
  info() {},
  warn() {},
  error() {},
  fatal() {},
};

const client = new ClaudeAgentClient({
  logger,
  queryFactory() {
    throw new Error("the payload probe never reaches the model");
  },
  resolveBinary: async () => "/nonexistent/claude",
});
const session = await client.createSession({ provider: "claude", cwd: process.cwd() });
const assembler = session.timelineAssembler;
assert.equal(typeof assembler?.consume, "function", "the built timeline assembler is absent");

function forceGc() {
  for (let index = 0; index < 3; index += 1) globalThis.gc();
  return process.memoryUsage().heapUsed;
}

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

const expected =
  "x".repeat(SURROGATE_HIGH_INDEX) +
  "\u{1F600}" +
  "y".repeat(CHUNK_CODE_UNITS * CHUNK_COUNT - SURROGATE_HIGH_INDEX - 2);
const chunks = [];
for (let offset = 0; offset < expected.length; offset += CHUNK_CODE_UNITS) {
  chunks.push(expected.slice(offset, offset + CHUNK_CODE_UNITS));
}

const projection = new TimelineProjection();
const emitted = [];
const baseline = forceGc();

for (const chunk of chunks) {
  const items = assembler.consume({
    message: {
      type: "stream_event",
      event: { type: "content_block_delta", delta: { type: "text_delta", text: chunk } },
    },
    runId: "payload-probe",
    messageIdHint: "payload-probe-message",
  });
  for (const item of items) {
    if (item.type !== "assistant_message") continue;
    emitted.push(item.text);
    projection.append({
      seq: emitted.length,
      item,
      timestamp: "2026-01-01T00:00:00Z",
      turnId: "payload-probe",
    });
  }
}

const joined = emitted.join("");
const retainedBytes = forceGc() - baseline;
const visibleBytes = expected.length * 2;

const observed = {
  probe: "streamed-suffix-detach",
  chunks: chunks.length,
  visibleBytes,
  emittedItems: emitted.length,
  joinedEqualsExpected: joined === expected,
  firstSplitCodeUnit: chunks[3].charCodeAt(CHUNK_CODE_UNITS - 1),
  secondSplitCodeUnit: chunks[4].charCodeAt(0),
  retainedBytes,
};
process.stdout.write(`${JSON.stringify(observed)}\n`);

// The reverted helper retained 269,130,736 bytes against 262,144 visible.
assert.equal(emitted.length, CHUNK_COUNT, "the assembler did not emit one item per chunk");
assert.equal(joined, expected, "the streamed text was not preserved");
assert.equal(sha256(joined), sha256(expected), "the streamed text's digest changed");
assert.ok(
  retainedBytes < visibleBytes * 32,
  `the emitted suffixes still retain the accumulated store (${retainedBytes} bytes for ${visibleBytes} visible)`,
);
assert.equal(observed.firstSplitCodeUnit, 0xd83d, "the split high surrogate moved");
assert.equal(observed.secondSplitCodeUnit, 0xde00, "the split low surrogate moved");
