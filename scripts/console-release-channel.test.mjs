import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import {
  CONSOLE_CANDIDATE_REF,
  CONSOLE_TRUNK_REF,
  resolveConsoleReleaseChannel,
} from "./console-release-channel.mjs";

// The console line's packages carry upstream v0.11.2 (infra-v2 P-000269 H2).
const version = "0.11.2";

function channel(ref, tag) {
  return resolveConsoleReleaseChannel({ ref, tag, version });
}

test("the console trunk publishes a release under v<version>-cvu.N", () => {
  assert.equal(channel(CONSOLE_TRUNK_REF, "v0.11.2-cvu.1"), "release");
  assert.equal(channel(CONSOLE_TRUNK_REF, "v0.11.2-cvu.12"), "release");
});

test("the candidate lane publishes a prerelease under v<version>-cvu.N-rc.M", () => {
  assert.equal(channel(CONSOLE_CANDIDATE_REF, "v0.11.2-cvu.1-rc.1"), "prerelease");
  assert.equal(channel(CONSOLE_CANDIDATE_REF, "v0.11.2-cvu.7-rc.10"), "prerelease");
});

test("the trunk refuses every tag that is not v<version>-cvu.N", () => {
  for (const tag of [
    "v0.11.2-cvu.1-rc.1",
    "v0.11.2-cvu.1-rc.2",
    "v0.11.2-cvu.0",
    "v0.11.2-cvu.01",
    "v0.11.2",
    "v0.11.1-cvu.1",
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
      /The console trunk publishes v0\.11\.2-cvu\.N/,
      `tag ${JSON.stringify(tag)}`,
    );
  }
});

test("the candidate lane refuses every tag that is not v<version>-cvu.N-rc.M", () => {
  for (const tag of [
    "v0.11.2-cvu.1",
    "v0.11.2-cvu.1-rc.0",
    "v0.11.2-cvu.0-rc.1",
    "v0.11.2-cvu.01-rc.1",
    "v0.11.2-cvu.1-rc.01",
    "v0.11.2-cvu.1-rc.1-x",
    "v0.11.1-cvu.1-rc.1",
    "v0.11.2-rc.1",
    "0.11.2-cvu.1-rc.1",
    "v0.11.2-cvu.1-rc.1 ",
    "v0.11.2-cvu.1-rc.",
    "",
  ]) {
    assert.throws(
      () => channel(CONSOLE_CANDIDATE_REF, tag),
      /The console candidate lane publishes v0\.11\.2-cvu\.N-rc\.M/,
      `tag ${JSON.stringify(tag)}`,
    );
  }
});

test("the lane's own tag is refused on the trunk, and the trunk's on the lane", () => {
  // Every (ref, tag) pair beyond the two allowed ones refuses.
  assert.throws(
    () => channel(CONSOLE_TRUNK_REF, "v0.11.2-cvu.1-rc.1"),
    /The console trunk publishes/,
  );
  assert.throws(
    () => channel(CONSOLE_CANDIDATE_REF, "v0.11.2-cvu.1"),
    /The console candidate lane publishes/,
  );
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
    for (const tag of ["v0.11.2-cvu.1-rc.1", "v0.11.2-cvu.1", "anything"]) {
      assert.throws(
        () => channel(ref, tag),
        /The console release publishes only from console\/main or candidate\/console-heap-0\.11\.2/,
        `${ref} ${tag}`,
      );
    }
  }
});

test("the packages' own version gates the tag", () => {
  // A tag naming another version is not a tag for these packages.
  assert.throws(() => channel(CONSOLE_TRUNK_REF, "v0.11.3-cvu.1"), /not "v0\.11\.3-cvu\.1"/);
  assert.throws(
    () => channel(CONSOLE_CANDIDATE_REF, "v0.11.3-cvu.1-rc.1"),
    /not "v0\.11\.3-cvu\.1-rc\.1"/,
  );
});

test("the command line prints the channel, and refuses with the reason and a non-zero exit", () => {
  const script = new URL("./console-release-channel.mjs", import.meta.url).pathname;
  const run = (...args) => execFileSync(process.execPath, [script, ...args], { encoding: "utf8" });
  assert.equal(run(CONSOLE_CANDIDATE_REF, "v0.11.2-cvu.1-rc.1", version), "prerelease\n");
  assert.equal(run(CONSOLE_TRUNK_REF, "v0.11.2-cvu.1", version), "release\n");
  assert.throws(
    () => run(CONSOLE_CANDIDATE_REF, "v0.11.2-cvu.1", version),
    (error) => error.status === 1 && /console candidate lane publishes/.test(String(error.stderr)),
  );
  assert.throws(
    () => run("refs/heads/main", "v0.11.2-cvu.1", version),
    (error) => error.status === 1 && /publishes only from console\/main/.test(String(error.stderr)),
  );
});
