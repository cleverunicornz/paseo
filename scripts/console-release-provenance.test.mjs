import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  assertReleaseProvenance,
  expectedAssetVersion,
  HEAP_FIX_COMMIT,
  RELEASE_PACKAGES,
  SCHEDULER_SOURCE_COMMIT,
  UPSTREAM_0_11_2,
} from "./console-release-provenance.mjs";

const VERSION = "0.11.2-cvu.3";
const TAG = `v${VERSION}`;

/** A manifest that satisfies every rule, for the tests to break one at a time. */
function manifest(overrides = {}) {
  return {
    tag: TAG,
    sourceCommit: "a".repeat(40),
    accountedAncestors: ["upstream-0.11.2", "heap-fix"],
    assetNames: RELEASE_PACKAGES.map((name) => `getpaseo-${name}-${VERSION}.tgz`),
    checksumInputs: RELEASE_PACKAGES.map((name) => `getpaseo-${name}-${VERSION}.tgz`),
    payloadText: "maxQueueDepth GitProcessQueueFullError LoopHealthMonitor utf16le",
    ...overrides,
  };
}

test("the constants name the real fixes", () => {
  assert.equal(UPSTREAM_0_11_2, "759532509");
  assert.equal(HEAP_FIX_COMMIT, "d282eb2ed");
  assert.equal(SCHEDULER_SOURCE_COMMIT, "98c30ca59bb42c8bd803f4ec4bc1716e61249633");
});

test("a release on the console line with both fixes in its payload passes", () => {
  assert.doesNotThrow(() => assertReleaseProvenance(manifest()));
});

test("the asset version is the tag's, never the packages' base version", () => {
  assert.equal(expectedAssetVersion("v0.11.2-cvu.3"), "0.11.2-cvu.3");
  assert.equal(expectedAssetVersion("v0.11.2-cvu.1-rc.1"), "0.11.2-cvu.1-rc.1");
});

test("a tag that does not name the console's base version refuses", () => {
  // The cvu.2 defect's tag was right; its payload was 0.10.3. A tag naming
  // 0.10.3 is the other half of the same wrong-line shape.
  assert.throws(
    () => assertReleaseProvenance(manifest({ tag: "v0.10.3-cvu.7" })),
    /built on 0\.11\.2/,
  );
});

test("assets named for another version refuse", () => {
  // Exactly the cvu.2 defect: a 0.11.2-cvu.2 tag over -0.10.3.tgz assets.
  const wrong = RELEASE_PACKAGES.map((name) => `getpaseo-${name}-0.10.3.tgz`);
  assert.throws(
    () => assertReleaseProvenance(manifest({ assetNames: wrong })),
    /do not include getpaseo-highlight-0\.11\.2-cvu\.3\.tgz/,
  );
});

test("a checksum input that is not an asset refuses", () => {
  assert.throws(
    () => assertReleaseProvenance(manifest({ checksumInputs: ["getpaseo-server-0.10.3.tgz"] })),
    /not a release asset/,
  );
});

test("a missing ancestor refuses, whichever one it is", () => {
  for (const missing of ["upstream-0.11.2", "heap-fix"]) {
    const kept = ["upstream-0.11.2", "heap-fix"].filter((key) => key !== missing);
    assert.throws(
      () => assertReleaseProvenance(manifest({ accountedAncestors: kept })),
      new RegExp(`does not carry ${missing}`),
    );
  }
});

test("a payload without the heap fix refuses however good its ancestry is", () => {
  // The point of checking the payload: right ancestors, leaking build.
  assert.throws(
    () =>
      assertReleaseProvenance(
        manifest({ payloadText: "maxQueueDepth GitProcessQueueFullError LoopHealthMonitor" }),
      ),
    /carries no utf16le: heapFix/,
  );
});

test("a payload without the scheduler bound refuses", () => {
  assert.throws(
    () => assertReleaseProvenance(manifest({ payloadText: "LoopHealthMonitor utf16le" })),
    /carries no maxQueueDepth: schedulerBound/,
  );
});

test("a payload without the instrumentation refuses", () => {
  assert.throws(
    () =>
      assertReleaseProvenance(
        manifest({ payloadText: "maxQueueDepth GitProcessQueueFullError utf16le" }),
      ),
    /carries no LoopHealthMonitor/,
  );
});

test("the command line passes a good manifest and refuses a bad one with its reason", () => {
  const script = new URL("./console-release-provenance.mjs", import.meta.url).pathname;
  const root = mkdtempSync(path.join(os.tmpdir(), "provenance-"));
  try {
    const good = path.join(root, "good.json");
    writeFileSync(good, JSON.stringify(manifest()));
    const out = execFileSync(process.execPath, [script, good], { encoding: "utf8" });
    assert.match(out, /carries upstream 0\.11\.2, the heap fix and the scheduler port/);

    const bad = path.join(root, "bad.json");
    writeFileSync(bad, JSON.stringify(manifest({ accountedAncestors: ["upstream-0.11.2"] })));
    assert.throws(
      () => execFileSync(process.execPath, [script, bad], { encoding: "utf8", stdio: "pipe" }),
      (error) => error.status === 1 && /does not carry heap-fix/.test(error.stderr),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
