import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import {
  assertConsoleRelease,
  assertPackedVersionMatchesTag,
  CONSOLE_CANDIDATE_REF,
  CONSOLE_REPOSITORY,
  CONSOLE_TRUNK_REF,
  consoleReleaseVersion,
  resolveConsoleReleaseChannel,
} from "./console-release-channel.mjs";

// The console line's packages carry upstream v0.11.2 (infra-v2 P-000269 H2).
const baseVersion = "0.11.2";
const candidateTag = "v0.11.2-cvu.1-rc.1";
const stableTag = "v0.11.2-cvu.1";

const channel = (ref, tag) => resolveConsoleReleaseChannel({ ref, tag });
const guard = (ref, tag) =>
  assertConsoleRelease({ repository: CONSOLE_REPOSITORY, ref, tag, baseVersion });
const packed = (tag, version) => assertPackedVersionMatchesTag({ tag, version });

test("the console trunk publishes a release under v<version>-cvu.N", () => {
  assert.equal(channel(CONSOLE_TRUNK_REF, "v0.11.2-cvu.1"), "release");
  assert.equal(channel(CONSOLE_TRUNK_REF, "v0.11.2-cvu.12"), "release");
});

test("the candidate lane publishes a prerelease under v<version>-cvu.N-rc.M", () => {
  assert.equal(channel(CONSOLE_CANDIDATE_REF, "v0.11.2-cvu.1-rc.1"), "prerelease");
  assert.equal(channel(CONSOLE_CANDIDATE_REF, "v0.11.2-cvu.7-rc.10"), "prerelease");
});

test("the tag's own version is the released version, on both refs", () => {
  // The base the packages carry is only the start of it: the tag names the release.
  assert.equal(consoleReleaseVersion({ ref: CONSOLE_TRUNK_REF, tag: stableTag }), "0.11.2-cvu.1");
  assert.equal(
    consoleReleaseVersion({ ref: CONSOLE_CANDIDATE_REF, tag: candidateTag }),
    "0.11.2-cvu.1-rc.1",
  );
});

test("the trunk refuses every tag that is not v<version>-cvu.N", () => {
  for (const tag of [
    candidateTag,
    "v0.11.2-cvu.1-rc.2",
    "v0.11.2-cvu.0",
    "v0.11.2-cvu.01",
    "v0.11.2",
    "0.11.2-cvu.1",
    "v0.11.2-cvu.1 ",
    " v0.11.2-cvu.1",
    "v0.11.2-cvu.1-x",
    "v0.11.2-cvu.",
    "v0.11.2-cvu.1.2",
    "",
  ]) {
    assert.throws(
      () => channel(CONSOLE_TRUNK_REF, tag),
      /The console release publishes v<version>-cvu\.N \(N from 1\)/,
      `tag ${JSON.stringify(tag)}`,
    );
  }
});

test("the candidate lane refuses every tag that is not v<version>-cvu.N-rc.M", () => {
  for (const tag of [
    stableTag,
    "v0.11.2-cvu.1-rc.0",
    "v0.11.2-cvu.0-rc.1",
    "v0.11.2-cvu.01-rc.1",
    "v0.11.2-cvu.1-rc.01",
    "v0.11.2-cvu.1-rc.1-x",
    "v0.11.2-rc.1",
    "0.11.2-cvu.1-rc.1",
    "v0.11.2-cvu.1-rc.1 ",
    "v0.11.2-cvu.1-rc.",
    "",
  ]) {
    assert.throws(
      () => channel(CONSOLE_CANDIDATE_REF, tag),
      /The console release publishes v<version>-cvu\.N-rc\.M \(N and M from 1\)/,
      `tag ${JSON.stringify(tag)}`,
    );
  }
});

test("no other ref publishes, whatever the tag", () => {
  for (const ref of [
    "refs/heads/main",
    "refs/heads/internal/main",
    "refs/heads/candidate/v2",
    "refs/heads/candidate/console-heap-0.11.3",
    "refs/heads/candidate/console-heap-0.11.2-next",
    "refs/heads/console/main-copy",
    "refs/heads/leaf/console-lane-publisher",
    "refs/tags/v0.11.2-cvu.1-rc.1",
    "refs/pull/20/merge",
  ]) {
    for (const tag of [candidateTag, stableTag, "anything"]) {
      assert.throws(
        () => channel(ref, tag),
        /The console release publishes only from console\/main or candidate\/console-heap-0\.11\.2/,
        `${ref} ${tag}`,
      );
    }
  }
});

test("the pre-build guard refuses a tag that is not built on the line's base version", () => {
  // Both valid pairs pass the guard, before anything is built.
  guard(CONSOLE_CANDIDATE_REF, candidateTag);
  guard(CONSOLE_TRUNK_REF, stableTag);
  guard(CONSOLE_TRUNK_REF, "v0.11.2-cvu.9");
  guard(CONSOLE_CANDIDATE_REF, "v0.11.2-cvu.9-rc.3");
  // Another base refuses: the line carries 0.11.2, and the rewrite would move it.
  for (const tag of ["v0.11.3-cvu.1", "v0.11.1-cvu.1", "v0.9.2-cvu.1", "v1.11.2-cvu.1"]) {
    assert.throws(
      () => guard(CONSOLE_TRUNK_REF, tag),
      /is built on base 0\.11\.2/,
      `tag ${JSON.stringify(tag)}`,
    );
  }
  assert.throws(
    () => guard(CONSOLE_CANDIDATE_REF, "v0.11.3-cvu.1-rc.1"),
    /is built on base 0\.11\.2/,
  );
  // The shape still gates it: a tag that does not match the ref never reaches the base.
  assert.throws(() => guard(CONSOLE_TRUNK_REF, candidateTag), /The console release publishes/);
});

test("the pre-build guard refuses a release published from another repository", () => {
  const other = { ref: CONSOLE_TRUNK_REF, tag: stableTag, baseVersion };
  for (const repository of [
    "validator-example/paseo",
    "cleverunicornz/paseo-fork",
    "CLEVERUNICORNZ/PASEO",
    "",
  ]) {
    assert.throws(
      () => assertConsoleRelease({ ...other, repository }),
      /publishes from cleverunicornz\/paseo alone/,
      `repository ${JSON.stringify(repository)}`,
    );
  }
});

test("after the rewrite the packed version must be the tag's version", () => {
  // The rewrite's result: the full tag version, not the base it started from.
  packed(stableTag, "0.11.2-cvu.1");
  packed(candidateTag, "0.11.2-cvu.1-rc.1");
  // The base the packages carried before the rewrite is not the tag's version.
  assert.throws(
    () => packed(stableTag, baseVersion),
    /packs "0\.11\.2", not the tag's version "0\.11\.2-cvu\.1"/,
  );
  assert.throws(
    () => packed(candidateTag, baseVersion),
    /packs "0\.11\.2", not the tag's version "0\.11\.2-cvu\.1-rc\.1"/,
  );
  // A doubled suffix, the earlier defect, is not the tag's version either.
  assert.throws(
    () => packed(candidateTag, "0.11.2-cvu.1-rc.1-cvu.1-rc.1"),
    /packs "0\.11\.2-cvu\.1-rc\.1-cvu\.1-rc\.1"/,
  );
  assert.throws(() => packed(stableTag, "0.11.2-cvu.1-cvu.1"), /packs "0\.11\.2-cvu\.1-cvu\.1"/);
});

test("the command line runs the guard, the rewrite version, the packed check and the channel", () => {
  const script = new URL("./console-release-channel.mjs", import.meta.url).pathname;
  const run = (...args) => execFileSync(process.execPath, [script, ...args], { encoding: "utf8" });

  // The pre-build guard prints nothing and exits 0 for a valid pair, on both refs.
  assert.equal(
    run("guard", CONSOLE_REPOSITORY, CONSOLE_CANDIDATE_REF, candidateTag, baseVersion),
    "",
  );
  assert.equal(run("guard", CONSOLE_REPOSITORY, CONSOLE_TRUNK_REF, stableTag, baseVersion), "");
  assert.throws(
    () => run("guard", "validator-example/paseo", CONSOLE_TRUNK_REF, stableTag, baseVersion),
    (error) =>
      error.status === 1 && /publishes from cleverunicornz\/paseo alone/.test(String(error.stderr)),
  );
  assert.throws(
    () => run("guard", CONSOLE_REPOSITORY, CONSOLE_TRUNK_REF, "v0.11.3-cvu.1", baseVersion),
    (error) => error.status === 1 && /is built on base 0\.11\.2/.test(String(error.stderr)),
  );

  // The version the rewrite uses, from the tag.
  assert.equal(run("version", CONSOLE_CANDIDATE_REF, candidateTag), "0.11.2-cvu.1-rc.1\n");
  assert.equal(run("version", CONSOLE_TRUNK_REF, stableTag), "0.11.2-cvu.1\n");

  // The post-rewrite check, against the tag's version.
  assert.equal(run("packed-version", stableTag, "0.11.2-cvu.1"), "");
  assert.equal(run("packed-version", candidateTag, "0.11.2-cvu.1-rc.1"), "");
  assert.throws(
    () => run("packed-version", stableTag, baseVersion),
    (error) => error.status === 1 && /not the tag's version/.test(String(error.stderr)),
  );

  // The channel the publish step creates the release in.
  assert.equal(run("channel", CONSOLE_CANDIDATE_REF, candidateTag), "prerelease\n");
  assert.equal(run("channel", CONSOLE_TRUNK_REF, stableTag), "release\n");
  assert.throws(
    () => run("channel", CONSOLE_CANDIDATE_REF, stableTag),
    (error) => error.status === 1 && /v<version>-cvu\.N-rc\.M/.test(String(error.stderr)),
  );
  assert.throws(
    () => run("channel", "refs/heads/main", stableTag),
    (error) => error.status === 1 && /publishes only from console\/main/.test(String(error.stderr)),
  );

  // An unknown command refuses rather than guessing.
  assert.throws(
    () => run("publish", CONSOLE_TRUNK_REF, stableTag),
    (error) =>
      error.status === 1 &&
      /takes one of guard, version, packed-version, channel/.test(String(error.stderr)),
  );
});
