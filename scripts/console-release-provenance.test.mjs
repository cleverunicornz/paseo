import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  assertPayloadCarriesFixes,
  assertPrepublicationProvenance,
  assertReleaseProvenance,
  expectedAssetVersion,
  expectedReleaseAssets,
  HEAP_FIX_COMMIT,
  PAYLOAD_PROBES,
  PORT_COMMITS,
  RELEASE_PACKAGES,
  SCHEDULER_SOURCE_COMMIT,
  UPSTREAM_0_11_2,
} from "./console-release-provenance.mjs";
import { parseChecksumFile, readPackedPackageJson, sha256, sha512 } from "./release-assets.mjs";

const VERSION = "0.11.2-cvu.3";
const TAG = `v${VERSION}`;
const TAG_COMMIT = "0ea6708c955772246fdfa5d79e81eecf83a61693";

/** A built-payload directory the probes can run against, or null when absent. */
const BUILT_SERVER = path.resolve("packages/server/dist/server");

function builtServerOrNull() {
  try {
    readFileSync(path.join(BUILT_SERVER, "utils/git-process-scheduler.js"));
    return BUILT_SERVER;
  } catch {
    return null;
  }
}

/** A `readReleaseAssets`-shaped object that satisfies every rule, one field at a time. */
function assets(overrides = {}) {
  const names = expectedReleaseAssets(VERSION);
  const packages = RELEASE_PACKAGES.map((name) => ({
    file: `getpaseo-${name}-${VERSION}.tgz`,
    name: `@getpaseo/${name}`,
    version: VERSION,
  }));
  const digests = new Map();
  const checksum256 = [];
  const checksum512 = [];
  for (const packed of packages) {
    const digest = `sha256-of-${packed.file}`;
    digests.set(packed.file, { sha256: digest, sha512: `sha512-of-${packed.file}` });
    checksum256.push({ digest, file: packed.file });
    checksum512.push({ digest: `sha512-of-${packed.file}`, file: packed.file });
  }
  digests.set("SHA256SUMS", { sha256: "manifest-bytes", sha512: "manifest-bytes-512" });
  digests.set("SHA512SUMS", { sha256: "sha512sums-bytes", sha512: "sha512sums-bytes-512" });
  return {
    tag: TAG,
    tagCommit: TAG_COMMIT,
    assets: {
      assetNames: names,
      packages,
      digests,
      checksum256,
      checksum512,
      manifestSha256: "manifest-bytes",
      sourceCommit: TAG_COMMIT,
      nodeVersion: process.version,
      ...overrides,
    },
    payloadObservations: [{ probe: "fixture" }],
  };
}

/** A `readReleaseAssets`-shaped object with one checksum entry mutated. */
function withChecksum(overrides) {
  const manifest = assets();
  const checksum256 = manifest.assets.checksum256.map((entry) => ({ ...entry }));
  Object.assign(checksum256[0], overrides);
  return { ...manifest, assets: { ...manifest.assets, checksum256 } };
}

test("the constants name the real fixes and the console line's ported commits", () => {
  assert.equal(UPSTREAM_0_11_2, "759532509");
  assert.equal(HEAP_FIX_COMMIT, "d282eb2ed");
  assert.equal(SCHEDULER_SOURCE_COMMIT, "98c30ca59bb42c8bd803f4ec4bc1716e61249633");
  // The three port commits the checklist names in full.
  assert.deepEqual(Object.keys(PORT_COMMITS).sort(), [
    "incrementalReconciliation",
    "loopInstrumentation",
    "schedulerBound",
  ]);
  for (const commit of Object.values(PORT_COMMITS)) {
    assert.match(commit, /^[0-9a-f]{40}$/);
  }
});

test("the asset version is the tag's, never the packages' base version", () => {
  assert.equal(expectedAssetVersion("v0.11.2-cvu.3"), "0.11.2-cvu.3");
  assert.equal(expectedAssetVersion("v0.11.2-cvu.1-rc.1"), "0.11.2-cvu.1-rc.1");
});

test("a correct release qualifies", () => {
  assert.doesNotThrow(() => assertReleaseProvenance(assets()));
});

// --- F2: the behavior proof, not a marker search --------------------------

test("the payload gate runs behavioral probes whose reversions a marker search missed", () => {
  // The r1 validator's controls: the bound disabled and either heap-detach helper
  // reverted, each with every marker string still in the tree. Those tests live
  // in the probes; this one proves the gate is wired to run them, not to search.
  const built = builtServerOrNull();
  if (built === null) {
    // The probes need the compiled server, which only the daemon job builds.
    // Their rules are covered by `console-ci.yml`'s own step, which runs after
    // the build, and by the negative controls recorded with this pull request.
    return;
  }
  const observations = assertPayloadCarriesFixes(built);
  assert.deepEqual(
    observations.map((observation) => observation.probe).sort(),
    [...PAYLOAD_PROBES].map((probe) => probe.file.replace(/\.mjs$/, "")).sort(),
  );
});

test("the gate refuses a payload whose behavior was not proven", () => {
  for (const value of [[], null, undefined, "not-an-array"]) {
    const manifest = assets();
    assert.throws(
      () => assertReleaseProvenance({ ...manifest, payloadObservations: value }),
      /payload behavior was not proven/,
    );
  }
});

test("the gate names the fix and the probe when a behavior proof fails", () => {
  // A copy of the built server under the package tree, so the mutant's own
  // imports resolve exactly as the real build's do. This is the r1 "scheduler
  // disabled" control: the bound is removed while every marker string stays.
  const built = builtServerOrNull();
  if (built === null) return;
  const root = path.resolve("packages/server/.payload-gate-mutant");
  try {
    rmSync(root, { recursive: true, force: true });
    cpSync(built, root, { recursive: true });
    const scheduler = path.join(root, "utils/git-process-scheduler.js");
    const source = readFileSync(scheduler, "utf8");
    const marker = "if (isBackground && this.waiting >= this.policy.maxQueueDepth) {";
    assert.equal(
      source.split(marker).length - 1,
      1,
      "the compiled bound is where the probe expects it",
    );
    writeFileSync(scheduler, source.replace(marker, "if (false) {"));
    // Every marker the old gate searched for is still present.
    for (const token of ["maxQueueDepth", "GitProcessQueueFullError"]) {
      assert.ok(readFileSync(scheduler, "utf8").includes(token));
    }
    assert.throws(
      () => assertPayloadCarriesFixes(root),
      /schedulerBound fix requires: scheduler-bound\.mjs failed.*bound did not hold/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// --- F3: release identity and the coupled checksum inputs ------------------

test("a tag that does not name the console's base version refuses", () => {
  // The cvu.2 defect's tag was right; its payload was 0.10.3. A tag naming
  // 0.10.3 is the other half of the same wrong-line shape.
  assert.throws(
    () => assertReleaseProvenance({ ...assets(), tag: "v0.10.3-cvu.7" }),
    /built on 0\.11\.2/,
  );
});

test("assets named for another version refuse", () => {
  // Exactly the cvu.2 defect: a 0.11.2-cvu.2 tag over -0.10.3.tgz assets.
  const wrong = RELEASE_PACKAGES.map((name) => `getpaseo-${name}-0.10.3.tgz`);
  assert.throws(
    () => assertReleaseProvenance(assets({ assetNames: wrong })),
    /publishes 7 assets, not its 11/,
  );
});

test("the seven packages' OWN embedded versions must be the tag's, not merely their names", () => {
  // The r1 control: real 0.11.2 tarballs renamed to `-0.11.2-cvu.3.tgz`. The old
  // gate read only names and accepted them.
  const manifest = assets();
  const renamed = manifest.assets.packages.map((packed) => ({
    ...packed,
    version: "0.11.2",
  }));
  assert.throws(
    () =>
      assertReleaseProvenance({ ...manifest, assets: { ...manifest.assets, packages: renamed } }),
    /packed @getpaseo\/highlight is version "0\.11\.2", not the tag's "0\.11\.2-cvu\.3"/,
  );
});

test("a release missing a package, or carrying one twice, refuses", () => {
  const manifest = assets();
  const onlyOne = manifest.assets.packages.slice(0, 1);
  assert.throws(
    () =>
      assertReleaseProvenance({ ...manifest, assets: { ...manifest.assets, packages: onlyOne } }),
    /carries 1 packages, not 7/,
  );
});

test("an empty or short checksum table refuses", () => {
  assert.throws(
    () => assertReleaseProvenance(assets({ checksum256: [] })),
    /no SHA256SUMS entries/,
  );
  assert.throws(
    () => assertReleaseProvenance(assets({ checksum512: [] })),
    /no SHA512SUMS entries/,
  );
  assert.throws(
    () =>
      assertReleaseProvenance(
        assets({
          checksum256: [{ digest: "a".repeat(64), file: "getpaseo-cli-0.11.2-cvu.3.tgz" }],
        }),
      ),
    /not the release's seven tarballs/,
  );
});

test("a checksum digest that is not the file's own bytes refuses", () => {
  assert.throws(
    () => assertReleaseProvenance(withChecksum({ digest: "0".repeat(64) })),
    /SHA256SUMS's .* digest does not match the file/,
  );
  const manifest = assets();
  const checksum512 = manifest.assets.checksum512.map((entry) => ({ ...entry }));
  checksum512[0].digest = "0".repeat(128);
  assert.throws(
    () =>
      assertReleaseProvenance({
        ...manifest,
        assets: { ...manifest.assets, checksum512 },
      }),
    /SHA512SUMS's .* digest does not match the file/,
  );
});

test("a manifest_sha256 that is not the SHA256SUMS bytes refuses", () => {
  assert.throws(
    () => assertReleaseProvenance(assets({ manifestSha256: "0".repeat(64) })),
    /manifest_sha256 .* is not the SHA256SUMS bytes/,
  );
});

test("a SOURCE_COMMIT that disagrees with the tag's commit refuses", () => {
  assert.throws(
    () =>
      assertReleaseProvenance(assets({ sourceCommit: "3333333333333333333333333333333333333333" })),
    /SOURCE_COMMIT .* is not the tag's commit/,
  );
  assert.throws(
    () => assertReleaseProvenance(assets({ sourceCommit: "not-a-commit" })),
    /SOURCE_COMMIT is not a full commit id/,
  );
  assert.throws(
    () => assertReleaseProvenance({ ...assets(), tagCommit: "abc" }),
    /tag resolves to no full commit id/,
  );
});

// --- The prepublication half ---------------------------------------------

test("prepublication refuses a run whose head is not the released commit", () => {
  const built = builtServerOrNull();
  assert.throws(
    () =>
      assertPrepublicationProvenance({
        tag: TAG,
        runCommit: "a".repeat(40),
        releaseCommit: "b".repeat(40),
        accountedAncestors: ["upstream-0.11.2", "heap-fix"],
        builtServerDir: built,
      }),
    /is not the released commit/,
  );
});

test("prepublication refuses a missing ancestor, whichever one it is", () => {
  const built = builtServerOrNull();
  for (const missing of ["upstream-0.11.2", "heap-fix"]) {
    const kept = ["upstream-0.11.2", "heap-fix"].filter((key) => key !== missing);
    assert.throws(
      () =>
        assertPrepublicationProvenance({
          tag: TAG,
          runCommit: TAG_COMMIT,
          releaseCommit: TAG_COMMIT,
          accountedAncestors: kept,
          builtServerDir: built,
        }),
      new RegExp(`does not carry ${missing}`),
    );
  }
});

test("prepublication refuses a tag naming another base version", () => {
  assert.throws(
    () =>
      assertPrepublicationProvenance({
        tag: "v0.10.3-cvu.7",
        runCommit: TAG_COMMIT,
        releaseCommit: TAG_COMMIT,
        accountedAncestors: ["upstream-0.11.2", "heap-fix"],
        builtServerDir: builtServerOrNull(),
      }),
    /built on 0\.11\.2/,
  );
});

// --- Reading real release assets ------------------------------------------

test("a real tarball's embedded package.json is read, not its file name", () => {
  // `npm pack` a package whose name and version are known, then read them back
  // out of the bytes. A renamed copy keeps the version its contents carry.
  const root = mkdtempSync(path.join(os.tmpdir(), "packed-asset-"));
  try {
    const packageDir = path.join(root, "package");
    mkdirSync(packageDir, { recursive: true });
    writeFileSync(
      path.join(packageDir, "package.json"),
      JSON.stringify({ name: "@getpaseo/probe", version: "1.2.3" }),
    );
    execFileSync("npm", ["pack", "--pack-destination", root], { cwd: packageDir, stdio: "pipe" });
    const tarball = path.join(root, "getpaseo-probe-1.2.3.tgz");
    const packed = readPackedPackageJson(readFileSync(tarball));
    assert.deepEqual(packed, { name: "@getpaseo/probe", version: "1.2.3" });

    // Renaming the file does not change what it carries.
    const renamed = path.join(root, "getpaseo-probe-9.9.9.tgz");
    cpSync(tarball, renamed);
    assert.equal(readPackedPackageJson(readFileSync(renamed)).version, "1.2.3");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the digests are the file's own bytes", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "digest-asset-"));
  try {
    const file = path.join(root, "asset.txt");
    writeFileSync(file, "the release's bytes\n");
    const bytes = readFileSync(file);
    assert.equal(sha256(bytes), createHash("sha256").update(bytes).digest("hex"));
    assert.equal(sha512(bytes), createHash("sha512").update(bytes).digest("hex"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a malformed checksum line refuses rather than being skipped", () => {
  assert.throws(() => parseChecksumFile("not a checksum line\n"), /checksum line is malformed/);
  assert.deepEqual(parseChecksumFile("a".repeat(64) + "  getpaseo-cli-0.11.2-cvu.3.tgz\n"), [
    { digest: "a".repeat(64), file: "getpaseo-cli-0.11.2-cvu.3.tgz" },
  ]);
});

test("the command line refuses a wrong release and names the reason", () => {
  // The postpublish command line reads a directory of REAL assets, so its
  // manifest names the directory rather than carrying digests: a Map does not
  // survive JSON, and a manifest of digests would be the very thing the gate
  // must not trust.
  const script = new URL("./console-release-provenance.mjs", import.meta.url).pathname;
  const root = mkdtempSync(path.join(os.tmpdir(), "provenance-"));
  try {
    const good = path.join(root, "good.json");
    writeFileSync(
      good,
      JSON.stringify({
        tag: TAG,
        tagCommit: TAG_COMMIT,
        releaseDir: root,
        payloadObservations: [{ probe: "fixture" }],
      }),
    );
    assert.throws(
      () => execFileSync(process.execPath, [script, good], { encoding: "utf8", stdio: "pipe" }),
      (error) => error.status === 1 && /publishes 1 assets, not its 11/.test(error.stderr),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});


test("the release receipt retains all seven byte identities and both checksum file hashes", () => {
  const input = assets();
  const result = assertReleaseProvenance(input);
  assert.equal(result.manifest_sha256, input.assets.manifestSha256);
  assert.equal(result.sourceCommit, input.tagCommit);
  assert.equal(result.consumerManifestCompared, false);
  assert.equal(result.packages.length, 7);
  for (const packed of result.packages) {
    assert.deepEqual(packed, { ...input.assets.packages.find((item) => item.file === packed.file), ...input.assets.digests.get(packed.file) });
  }
  assert.deepEqual(result.checksumFiles, Object.fromEntries(["SHA256SUMS", "SHA512SUMS"].map((file) => [file, input.assets.digests.get(file)])));
  assert.equal(assertReleaseProvenance({ ...input, runCommit: TAG_COMMIT, manifest_sha256: input.assets.manifestSha256 }).consumerManifestCompared, true);
});

test("supplied coupled run and manifest identities cannot be silently ignored", () => {
  const input = assets();
  for (const runCommit of ["1".repeat(40), "3555fc1", null, ""]) {
    assert.throws(() => assertReleaseProvenance({ ...input, runCommit }), /qualified run's commit/);
  }
  for (const manifest_sha256 of ["0".repeat(64), null, ""]) {
    assert.throws(() => assertReleaseProvenance({ ...input, manifest_sha256 }), /consumer manifest_sha256/);
  }
});
