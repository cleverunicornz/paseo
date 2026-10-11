import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { resolveInternalReleaseChannel } from "./internal-release-channel.mjs";

const version = "0.10.3";

function channel(ref, tag) {
  return resolveInternalReleaseChannel({ ref, tag, version });
}

test("internal/main publishes a release under any tag, as before", () => {
  assert.equal(channel("refs/heads/internal/main", "v0.10.3-cvu.7"), "release");
  assert.equal(channel("refs/heads/internal/main", "anything"), "release");
});

test("a candidate lane publishes a prerelease tagged v<version>-cvu.N-rc.M", () => {
  assert.equal(channel("refs/heads/candidate/v2", "v0.10.3-cvu.7-rc.1"), "prerelease");
  assert.equal(channel("refs/heads/candidate/v2", "v0.10.3-cvu.12-rc.10"), "prerelease");
  assert.equal(channel("refs/heads/candidate/next/lane", "v0.10.3-cvu.1-rc.1"), "prerelease");
});

test("a candidate lane refuses any other tag", () => {
  for (const tag of [
    "v0.10.3-cvu.7",
    "v0.11.2-cvu.7-rc.1",
    "0.10.3-cvu.7-rc.1",
    "v0.10.3-cvu.0-rc.1",
    "v0.10.3-cvu.7-rc.0",
    "v0.10.3-cvu.07-rc.1",
    "v0.10.3-cvu.7-rc.01",
    "v0.10.3-cvu.7-rc.1-x",
    "v0.10.3-cvu.7-rc.1 ",
    "v0.10.3-cvu.7-rc.",
    "",
  ]) {
    assert.throws(
      () => channel("refs/heads/candidate/v2", tag),
      /candidate prerelease tag must be v0\.10\.3-cvu\.N-rc\.M/,
      `tag ${JSON.stringify(tag)}`,
    );
  }
});

test("no other ref publishes", () => {
  for (const ref of [
    "refs/heads/main",
    "refs/heads/leaf/candidate-prereleases",
    "refs/heads/candidate",
    "refs/heads/candidate/",
    "refs/heads/internal/main-copy",
    "refs/tags/v0.10.3-cvu.7-rc.1",
    "refs/pull/14/merge",
  ]) {
    assert.throws(
      () => channel(ref, "v0.10.3-cvu.7-rc.1"),
      /publishes only from internal\/main or candidate\/\*\*/,
      ref,
    );
  }
});

test("the command line prints the channel, and refuses with the reason and a non-zero exit", () => {
  const script = new URL("./internal-release-channel.mjs", import.meta.url).pathname;
  const run = (...args) => execFileSync(process.execPath, [script, ...args], { encoding: "utf8" });
  assert.equal(run("refs/heads/candidate/v2", "v0.10.3-cvu.7-rc.1", version), "prerelease\n");
  assert.equal(run("refs/heads/internal/main", "v0.10.3-cvu.7", version), "release\n");
  assert.throws(
    () => run("refs/heads/candidate/v2", "v0.10.3-cvu.7", version),
    (error) =>
      error.status === 1 && /candidate prerelease tag must be/.test(String(error.stderr)),
  );
});
