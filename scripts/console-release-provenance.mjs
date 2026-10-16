import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isMainModule } from "./is-main-module.mjs";
import { readReleaseAssets } from "./release-assets.mjs";

// The console release provenance gate (docs/console-release-checklist.md).
// The 2026-10-16 defect: v0.11.2-cvu.2's tag named the console line while its
// payload was a 0.10.3 build of the v2 line, with neither upstream 0.11.2 nor
// the console heap fix. Nothing pinned or deployed it.
//
// The gate has two halves, and the r1 validation showed they must be separate:
//
//   - PREPUBLICATION identity. Before anything is published, the workflow's own
//     build must be on the console's line, named by the tag, and carry both
//     fixes as BEHAVIOR. A tag and a filename are claims; the built code's
//     behavior is the evidence.
//   - POSTPUBLICATION qualification. After publication, a downloaded release
//     must have every one of the seven packages at the tag's version inside its
//     own tarball, digests that match its `SHA256SUMS`/`SHA512SUMS`, a
//     `manifest_sha256` equal to the `SHA256SUMS` bytes, and a `SOURCE_COMMIT`
//     equal to the tag's commit.
//
// The r1 validator reverted the two heap-detach helpers one at a time and
// disabled the scheduler's bound while every marker string stayed in the tree:
// the old substring check passed all three mutants. So this gate no longer
// searches for strings. It RUNS the built payload through
// `scripts/console-payload-probes/*.mjs`, in child processes, against the built
// bytes themselves.

/** The commit upstream 0.11.2 was cut at; the console line's merge base with upstream. */
export const UPSTREAM_0_11_2 = "759532509";

/** The console heap fix: detach streamed suffixes and capped prefixes. */
export const HEAP_FIX_COMMIT = "d282eb2ed";

/** The validated scheduler-bound source (paseo PR #23). */
export const SCHEDULER_SOURCE_COMMIT = "98c30ca59bb42c8bd803f4ec4bc1716e61249633";

/**
 * The console line's own ported commits. These are the commits a pull request
 * onto `console/main` adds; unlike the heap fix they cannot be named by a
 * document committed in the same pull request, so the payload behavior proves
 * them and this list is what the checklist names for a human to resolve.
 */
export const PORT_COMMITS = {
  schedulerBound: "6e26eee129c9dbeb60be8f7324e353e84a52694a",
  incrementalReconciliation: "6b2a53a7b60bd46c4602853279d369ea9fbae0c0",
  loopInstrumentation: "8b5559630203c7f2dd616b5ea13cdba35d394e8b",
};

/** The seven workspace packages of one release, packed together. */
export const RELEASE_PACKAGES = [
  "highlight",
  "relay",
  "protocol",
  "client",
  "plugin",
  "server",
  "cli",
];

/** The checksum and identity files a release publishes beside its seven tarballs. */
export const RELEASE_METADATA_FILES = ["SHA256SUMS", "SHA512SUMS", "SOURCE_COMMIT", "NODE_VERSION"];

/** Every asset a release publishes, exactly: seven tarballs and four metadata files. */
export function expectedReleaseAssets(version) {
  return [
    ...RELEASE_PACKAGES.map((name) => `getpaseo-${name}-${version}.tgz`),
    ...RELEASE_METADATA_FILES,
  ];
}

/**
 * The probes that prove the built payload's behavior, each with the fix it
 * covers. Each runs in its own child process: the heap probes need
 * `--expose-gc`, and a probe's failure must name the fix without ending the
 * caller's process. `needsGc` selects those.
 */
export const PAYLOAD_PROBES = [
  { file: "scheduler-bound.mjs", fix: "schedulerBound", needsGc: false },
  { file: "capped-prefix-detach.mjs", fix: "heapFixCappedPrefix", needsGc: true },
  { file: "streamed-suffix-detach.mjs", fix: "heapFixStreamedSuffix", needsGc: true },
  { file: "loop-instrumentation.mjs", fix: "loopInstrumentation", needsGc: false },
];

const PROBE_DIR = fileURLToPath(new URL("./console-payload-probes/", import.meta.url));

/**
 * The version the release's assets must name: the tag's version without its
 * leading `v`. A release whose assets carry another version is the wrong-line
 * shape the guard exists for.
 */
export function expectedAssetVersion(tag) {
  return tag.replace(/^v/, "");
}

/** The version the console release is built on: upstream 0.11.2, the console's base. */
const CONSOLE_BASE_VERSION = /^0\.11\.2-cvu\.[1-9][0-9]*$/;

/** A full 40-hex commit id, which `SOURCE_COMMIT` and the tag's commit must be. */
const FULL_COMMIT = /^[0-9a-f]{40}$/;

/**
 * Prove the built payload's behavior by running it.
 *
 * `builtServerDir` is the built server's `dist/server` (the directory carrying
 * `utils/` and `server/`). Each probe imports the built modules and asserts the
 * fix's behavior; a mutant that keeps every marker string but reverts the
 * behavior fails its probe. Returns the probes' observations.
 */
export function assertPayloadCarriesFixes(builtServerDir) {
  if (typeof builtServerDir !== "string" || builtServerDir === "") {
    throw new Error("assertPayloadCarriesFixes needs the built server's dist/server directory");
  }
  const observations = [];
  for (const probe of PAYLOAD_PROBES) {
    const args = [path.join(PROBE_DIR, probe.file), builtServerDir];
    if (probe.needsGc) args.unshift("--expose-gc");
    let stdout;
    try {
      stdout = execFileSync(process.execPath, args, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      const stderr = error && typeof error.stderr === "string" ? error.stderr.trim() : "";
      // The probe's own assertion is the useful line: name it, so a refusal
      // reads as "the cap still retains its source", not as a stack trace.
      const assertion = stderr
        .split("\n")
        .find((line) => /AssertionError|^Error:/.test(line.trim()));
      const detail = assertion?.trim() ?? stderr.split("\n").at(-1) ?? "";
      throw new Error(
        `The built payload does not behave as the ${probe.fix} fix requires: ${probe.file} failed${detail === "" ? "" : `: ${detail}`}`,
        { cause: error },
      );
    }
    const line = stdout.trim().split("\n").at(-1);
    if (!line) {
      throw new Error(`The ${probe.fix} probe produced no observation`);
    }
    observations.push(JSON.parse(line));
  }
  return observations;
}

/**
 * PREPUBLICATION: what the workflow built, before any release exists.
 *
 * The run's head commit, the tag's commit (`releaseCommit`, what
 * `--target`/`SOURCE_COMMIT` will name) and the built identity must agree; the
 * ancestry keys must be present; and the built payload must behave as both
 * fixes require.
 *
 * `builtServerDir` is the built `dist/server`. `runCommit` is the CI run's head
 * (null on a pull request, where no release is cut). `releaseCommit` is the
 * commit the release would name (null on a pull request).
 */
export function assertPrepublicationProvenance({
  tag,
  runCommit = null,
  releaseCommit = null,
  accountedAncestors,
  builtServerDir,
}) {
  const version = expectedAssetVersion(tag);
  if (!CONSOLE_BASE_VERSION.test(version)) {
    throw new Error(
      `The console release is built on 0.11.2, not ${JSON.stringify(version)} (tag ${tag})`,
    );
  }

  // The released commit must be on the console line and carry the heap fix.
  // The scheduler port's own commits are the pull request's; they cannot name
  // themselves here, so the port is proven by the payload's behavior below.
  for (const key of ["upstream-0.11.2", "heap-fix"]) {
    if (!accountedAncestors.includes(key)) {
      throw new Error(`The released commit does not carry ${key}`);
    }
  }

  if (releaseCommit !== null) {
    if (!FULL_COMMIT.test(releaseCommit)) {
      throw new Error(`The release names no commit: ${JSON.stringify(releaseCommit)}`);
    }
    if (runCommit !== null && runCommit !== releaseCommit) {
      throw new Error(
        `The run's head ${runCommit} is not the released commit ${releaseCommit}: the tag would name another commit`,
      );
    }
  }

  // A tag is a claim; the payload's behavior is the evidence. Both fixes must
  // really work in what was built.
  const observations = assertPayloadCarriesFixes(builtServerDir);

  return { version, releaseCommit, observations };
}

/**
 * Shared packed-byte checks before and after publication.
 *
 * Everything here comes from the files as downloaded: the embedded version of
 * each of the seven tarballs, the two checksum files' digests against the
 * tarballs' bytes, `manifest_sha256` against the `SHA256SUMS` bytes, and
 * `SOURCE_COMMIT` against the tag's commit.
 *
 * `assets` is the `readReleaseAssets` shape; `tagCommit` is the commit the tag
 * resolves to (`git rev-list -n 1 <tag>`), which `SOURCE_COMMIT` must equal.
 * `payloadObservations` is the behavior proof, run separately against the
 * server tarball's extracted `dist/server`, because behavior cannot be read out
 * of a tarball's names.
 */
export function assertPackedReleaseAssets({ tag, assets }) {
  const version = expectedAssetVersion(tag);
  if (!CONSOLE_BASE_VERSION.test(version)) {
    throw new Error(
      `The console release is built on 0.11.2, not ${JSON.stringify(version)} (tag ${tag})`,
    );
  }

  assertAssetSet(assets.assetNames, expectedReleaseAssets(version));
  const tarballs = assertPackedPackages(assets.packages, version);
  assertChecksumTables({
    checksum256: assets.checksum256,
    checksum512: assets.checksum512,
    tarballs,
    digests: assets.digests,
  });
  return { version };
}

/** Qualify downloaded bytes and retain their receipt; optional coupled pins must agree. */
export function assertReleaseProvenance({
  tag,
  tagCommit,
  runCommit,
  manifest_sha256,
  assets,
  payloadObservations,
}) {
  const { version } = assertPackedReleaseAssets({ tag, assets });
  assertManifestAndCommit({ assets, tagCommit });
  if (runCommit !== undefined && (!FULL_COMMIT.test(runCommit) || runCommit !== tagCommit)) {
    throw new Error(`The qualified run's commit ${runCommit} is not the tag's commit ${tagCommit}`);
  }
  if (manifest_sha256 !== undefined && manifest_sha256 !== assets.manifestSha256) {
    throw new Error("The supplied consumer manifest_sha256 is not the downloaded SHA256SUMS hash");
  }
  assertPayloadBehaviorProven(payloadObservations);

  return {
    tag,
    version,
    runCommit: runCommit ?? null,
    tagCommit,
    nodeVersion: assets.nodeVersion,
    sourceCommit: assets.sourceCommit,
    manifest_sha256: assets.manifestSha256,
    checksumFiles: Object.fromEntries(
      ["SHA256SUMS", "SHA512SUMS"].map((file) => [file, assets.digests.get(file)]),
    ),
    packages: assets.packages.map((packed) => ({ ...packed, ...assets.digests.get(packed.file) })),
    consumerManifestCompared: manifest_sha256 !== undefined,
    observations: payloadObservations,
  };
}

/** Exactly the expected assets: no missing file, no unexpected one. */
function assertAssetSet(published, expected) {
  const sortedPublished = [...published].sort();
  const sortedExpected = [...expected].sort();
  if (sortedPublished.join("\n") === sortedExpected.join("\n")) {
    return;
  }
  const missing = sortedExpected.filter((name) => !sortedPublished.includes(name));
  const extra = sortedPublished.filter((name) => !sortedExpected.includes(name));
  throw new Error(
    `The release publishes ${sortedPublished.length} assets, not its ${sortedExpected.length}: missing ${JSON.stringify(missing)}, unexpected ${JSON.stringify(extra)}`,
  );
}

/**
 * Each tarball's OWN embedded `package.json` carries the tag's version, and the
 * seven expected packages are all there. The names can be right while the
 * contents are another build: that is the renamed-copy control.
 */
function assertPackedPackages(packages, version) {
  if (packages.length !== RELEASE_PACKAGES.length) {
    throw new Error(
      `The release carries ${packages.length} packages, not ${RELEASE_PACKAGES.length}`,
    );
  }
  const tarballs = new Set();
  for (const name of RELEASE_PACKAGES) {
    const wanted = `@getpaseo/${name}`;
    const packed = packages.find((item) => item.name === wanted);
    if (!packed) {
      throw new Error(`The release's assets do not include the ${wanted} package`);
    }
    if (packed.version !== version) {
      throw new Error(
        `The packed ${wanted} is version ${JSON.stringify(packed.version)}, not the tag's ${JSON.stringify(version)}`,
      );
    }
    tarballs.add(packed.file);
  }
  return tarballs;
}

/** Both checksum tables cover exactly the tarballs, and match their bytes. */
function assertChecksumTables({ checksum256, checksum512, tarballs, digests }) {
  if (!checksum256 || checksum256.length === 0) {
    throw new Error("The release publishes no SHA256SUMS entries");
  }
  if (!checksum512 || checksum512.length === 0) {
    throw new Error("The release publishes no SHA512SUMS entries");
  }
  const expectedNames = [...tarballs].sort().join("\n");
  for (const [label, table, key] of [
    ["SHA256SUMS", checksum256, "sha256"],
    ["SHA512SUMS", checksum512, "sha512"],
  ]) {
    const names = table.map((entry) => entry.file).sort();
    if (names.join("\n") !== expectedNames) {
      throw new Error(
        `${label} names ${JSON.stringify(names)}, not the release's seven tarballs ${JSON.stringify([...tarballs].sort())}`,
      );
    }
    for (const entry of table) {
      const actual = digests.get(entry.file)?.[key];
      if (actual === undefined) {
        throw new Error(`${label} names ${entry.file}, which has no recorded digest`);
      }
      if (actual !== entry.digest) {
        throw new Error(
          `${label}'s ${entry.file} digest does not match the file: ${entry.digest} is not ${actual}`,
        );
      }
    }
  }
}

/** `manifest_sha256` is the SHA256SUMS bytes; SOURCE_COMMIT is the tag's commit. */
function assertManifestAndCommit({ assets, tagCommit }) {
  const sumsDigest = assets.digests.get("SHA256SUMS")?.sha256;
  if (!assets.manifestSha256) {
    throw new Error("The release publishes no SHA256SUMS to hash as manifest_sha256");
  }
  if (assets.manifestSha256 !== sumsDigest) {
    throw new Error(
      `manifest_sha256 ${assets.manifestSha256} is not the SHA256SUMS bytes ${sumsDigest}`,
    );
  }
  if (!FULL_COMMIT.test(assets.sourceCommit ?? "")) {
    throw new Error(
      `SOURCE_COMMIT is not a full commit id: ${JSON.stringify(assets.sourceCommit)}`,
    );
  }
  if (!FULL_COMMIT.test(tagCommit ?? "")) {
    throw new Error(`The tag resolves to no full commit id: ${JSON.stringify(tagCommit)}`);
  }
  if (assets.sourceCommit !== tagCommit) {
    throw new Error(
      `SOURCE_COMMIT ${assets.sourceCommit} is not the tag's commit ${tagCommit}: the run, the tag and SOURCE_COMMIT disagree`,
    );
  }
}

/** A downloaded release carries its own behavior proof, not the build's. */
function assertPayloadBehaviorProven(payloadObservations) {
  if (!Array.isArray(payloadObservations) || payloadObservations.length === 0) {
    throw new Error(
      "The release's payload behavior was not proven: a downloaded release needs its own behavioral qualification",
    );
  }
}

if (isMainModule(import.meta.url)) {
  // Usage: node console-release-provenance.mjs <manifest.json>
  //   prepublish:  { tag, runCommit, releaseCommit, accountedAncestors, builtServerDir }
  //   postpublish: { tag, tagCommit, releaseDir, payloadObservations, runCommit?, manifest_sha256? }
  //
  // The postpublish manifest names a DIRECTORY of downloaded assets, not a set
  // of digests: the gate reads each file's own bytes, so a manifest carrying
  // its own digests would be trusting the claim the gate exists to check.
  const [manifestPath] = process.argv.slice(2);
  try {
    if (!manifestPath) {
      throw new Error("usage: console-release-provenance.mjs <manifest.json>");
    }
    const manifest = JSON.parse(readFileSync(path.resolve(manifestPath), "utf8"));
    const isPostpublish = manifest.releaseDir !== undefined;
    const result = isPostpublish
      ? assertReleaseProvenance({
          tag: manifest.tag,
          tagCommit: manifest.tagCommit,
          runCommit: manifest.runCommit,
          manifest_sha256: manifest.manifest_sha256,
          assets: readReleaseAssets({
            releaseDir: manifest.releaseDir,
            expectedPackageNames: RELEASE_PACKAGES,
          }),
          payloadObservations: manifest.payloadObservations,
        })
      : assertPrepublicationProvenance(manifest);
    process.stdout.write(
      `The ${isPostpublish ? "published release" : "built payload"} ${manifest.tag} carries upstream 0.11.2, the heap fix and the scheduler port.\n`,
    );
    if (isPostpublish) process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  }
}
