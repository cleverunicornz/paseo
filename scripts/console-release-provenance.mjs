import { readFileSync } from "node:fs";
import path from "node:path";
import { isMainModule } from "./is-main-module.mjs";

// The console release provenance gate (docs/console-release-checklist.md).
// The 2026-10-16 defect: v0.11.2-cvu.2's tag named the console line while its
// payload was a 0.10.3 build of the v2 line, with neither upstream 0.11.2 nor
// the console heap fix. Nothing pinned or deployed it. This check refuses that
// shape: what is published must come from the console's line and must carry the
// fixes the console runs with, in the built payload and not only in ancestry.

/** The commit upstream 0.11.2 was cut at; the console line's merge base with upstream. */
export const UPSTREAM_0_11_2 = "759532509";

/** The console heap fix: detach streamed suffixes and capped prefixes. */
export const HEAP_FIX_COMMIT = "d282eb2ed";

/** The validated scheduler-bound source (paseo PR #23). */
export const SCHEDULER_SOURCE_COMMIT = "98c30ca59bb42c8bd803f4ec4bc1716e61249633";

/**
 * Markers that must appear in the BUILT server, not merely in Git. Each is a
 * literal a payload carries only when the fix is really in it:
 *
 * - `maxQueueDepth` / `GitProcessQueueFullError` - the scheduler bound;
 * - `LoopHealthMonitor` - the loop-blocker instrumentation;
 * - `utf16le` in `agent-timeline-content.js` - the heap fix's UTF-16 detach.
 *   `slice(0, ...)` alone is what the leaking build had; the detach adds the
 *   round trip through `utf16le`.
 */
export const PAYLOAD_MARKERS = {
  schedulerBound: ["maxQueueDepth", "GitProcessQueueFullError"],
  loopInstrumentation: ["LoopHealthMonitor"],
  heapFix: ["utf16le"],
};

/** The seven workspace packages of one release, packed together. */
export const RELEASE_PACKAGES = ["highlight", "relay", "protocol", "client", "plugin", "server", "cli"];

/**
 * The version the release's assets must name: the tag's version without its
 * leading `v`. A release whose assets carry another version is the wrong-line
 * shape the guard exists for.
 */
export function expectedAssetVersion(tag) {
  return tag.replace(/^v/, "");
}

/**
 * The built payload must carry both fixes. This is the check that the tag
 * cannot fake: it reads the built server dist, not Git.
 *
 * It runs on every qualification of the line (a PR included), where the
 * packages still carry the base version `0.11.2` and no release tag exists, and
 * again on a release's own build.
 */
export function assertPayloadCarriesFixes(payloadText) {
  for (const [fix, markers] of Object.entries(PAYLOAD_MARKERS)) {
    for (const marker of markers) {
      if (!payloadText.includes(marker)) {
        throw new Error(`The built payload carries no ${marker}: ${fix} is not in the build`);
      }
    }
  }
}

/**
 * Check one release's published assets.
 *
 * `tag` is the release tag (`v0.11.2-cvu.3`); `sourceCommit` is the release's
 * `SOURCE_COMMIT` asset; `accountedAncestors` are the commits a clone proves are
 * ancestors of `sourceCommit` (`upstream-0.11.2`, `heap-fix`); `payloadText` is
 * the concatenated built server dist, and `checksumInputs` names the SHA256SUMS
 * entries. The scheduler port is proven by `payloadText`'s markers, because its
 * own commits cannot name themselves in a document committed with them.
 *
 * Every condition is a refusal with its reason; the caller never proceeds on a
 * release that fails one.
 */
export function assertReleaseProvenance({
  tag,
  sourceCommit,
  accountedAncestors,
  assetNames,
  checksumInputs,
  payloadText,
}) {
  const version = expectedAssetVersion(tag);
  if (!/^0\.11\.2-cvu\.[1-9][0-9]*$/.test(version)) {
    throw new Error(
      `The console release is built on 0.11.2, not ${JSON.stringify(version)} (tag ${tag})`,
    );
  }

  // The assets must be named for the tag's version. The cvu.2 defect packed
  // `-0.10.3.tgz` under a `0.11.2-cvu.2` name.
  for (const name of RELEASE_PACKAGES) {
    const wanted = `getpaseo-${name}-${version}.tgz`;
    if (!assetNames.includes(wanted)) {
      throw new Error(`The release's assets do not include ${wanted}`);
    }
  }

  // Every checksum input must be one of the assets it binds.
  for (const input of checksumInputs) {
    if (!assetNames.includes(input.trim())) {
      throw new Error(`SHA256SUMS names ${input.trim()}, which is not a release asset`);
    }
  }

  // The released commit must be on the console line and carry the heap fix.
  // The scheduler port's own commits are the pull request's; they cannot name
  // themselves here, so the port is proven by its payload markers below.
  for (const key of ["upstream-0.11.2", "heap-fix"]) {
    if (!accountedAncestors.includes(key)) {
      throw new Error(`The released commit does not carry ${key}`);
    }
  }

  // A tag is a claim; the payload is the evidence. Both fixes must be in it.
  assertPayloadCarriesFixes(payloadText);

  return { version, sourceCommit };
}

if (isMainModule(import.meta.url)) {
  // Usage: node console-release-provenance.mjs <manifest.json>
  // The manifest is written by the console CI's daemon job from what it built
  // and published, and re-run by a validator against the published assets.
  const [manifestPath] = process.argv.slice(2);
  try {
    if (!manifestPath) {
      throw new Error("usage: console-release-provenance.mjs <manifest.json>");
    }
    const manifest = JSON.parse(readFileSync(path.resolve(manifestPath), "utf8"));
    const result = assertReleaseProvenance(manifest);
    process.stdout.write(
      `The release ${manifest.tag} carries upstream 0.11.2, the heap fix and the scheduler port.\n`,
    );
    void result;
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  }
}
