// Compiled-payload probe: the capped-prefix detach behaves as the heap fix
// specifies. `argv[2]` is the built server's `dist/server`.
//
// The validator's r1 negative control reverted `retainTextPrefix` to a bare
// `text.slice(...)` and the marker gate still passed, because the sibling
// stream helper kept `utf16le` in the tree. Here the built limiter must keep
// the 64 KiB cap without keeping each 2 MiB source alive, and must not corrupt
// a surrogate pair split at the cap.
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

if (!globalThis.gc) {
  throw new Error("Run this probe with --expose-gc");
}

const root = path.resolve(process.argv[2] ?? "");
const { limitAgentTimelineItemContent } = await import(
  pathToFileURL(path.join(root, "server/agent/agent-timeline-content.js"))
);
assert.equal(typeof limitAgentTimelineItemContent, "function", "the built limiter is absent");

const ITEM_COUNT = 24;
const SOURCE_CODE_UNITS = 2 * 1024 * 1024;
const MAX_LENGTH = 64 * 1024;
const HIGH_SURROGATE = 0xd83d;

/** A 2 MiB source whose surrogate pair straddles the cap boundary. */
function buildOversizedText(index) {
  const prefix = String(index).padStart(8, "0");
  const head = "x".repeat(MAX_LENGTH - 1 - prefix.length);
  const tail = "y".repeat(SOURCE_CODE_UNITS - MAX_LENGTH - 1);
  return `${prefix}${head}\u{1F600}${tail}`;
}

function forceGc() {
  for (let index = 0; index < 3; index += 1) globalThis.gc();
  return process.memoryUsage().heapUsed;
}

const retained = [];
const baseline = forceGc();
for (let index = 1; index <= ITEM_COUNT; index += 1) {
  const item = limitAgentTimelineItemContent({
    type: "tool_call",
    callId: `payload-probe-${index}`,
    name: "synthetic",
    status: "completed",
    error: null,
    detail: { type: "shell", command: "synthetic", output: buildOversizedText(index) },
  });
  retained.push(item.detail.output);
}

const retainedBytes = forceGc() - baseline;
const visibleBytes = retained.reduce((total, text) => total + text.length * 2, 0);
const sourceBytes = ITEM_COUNT * SOURCE_CODE_UNITS * 2;
const replacementCharacters = retained.reduce(
  (total, text) => total + (text.match(/�/g)?.length ?? 0),
  0,
);
const lastKeptCodeUnit = retained.map((text) => text.charCodeAt(MAX_LENGTH - 1));

const observed = {
  probe: "capped-prefix-detach",
  items: ITEM_COUNT,
  visibleBytes,
  sourceBytes,
  retainedBytes,
  replacementCharacters,
  lastKeptCodeUnit: [...new Set(lastKeptCodeUnit)],
};
process.stdout.write(`${JSON.stringify(observed)}\n`);

// Every capped item keeps its cap; none keeps its source. The reverted helper
// retained 100,743,688 bytes against 3,145,728 visible.
assert.equal(retained.length, ITEM_COUNT, "the limiter dropped an item");
for (const text of retained) {
  assert.ok(text.length <= MAX_LENGTH, "the cap did not hold");
}
assert.ok(
  retainedBytes < visibleBytes + 8 * 1024 * 1024,
  `the capped prefixes still retain their sources (${retainedBytes} bytes for ${visibleBytes} visible)`,
);
assert.equal(replacementCharacters, 0, "a split surrogate pair was turned into replacement characters");
assert.ok(
  lastKeptCodeUnit.every((codeUnit) => codeUnit === HIGH_SURROGATE),
  "the cap did not cut at the split surrogate pair",
);
