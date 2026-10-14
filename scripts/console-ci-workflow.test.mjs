import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(
  new URL("../.github/workflows/console-ci.yml", import.meta.url),
  "utf8",
);

/** The `- name:` / `- uses:` steps of one job, in order, each with its full text. */
function jobSteps(source, jobName) {
  const lines = source.split("\n");
  const start = lines.findIndex((line) => line === `  ${jobName}:`);
  assert.ok(start >= 0, `job ${jobName}`);
  const end = lines.findIndex((line, index) => index > start && /^ {2}[a-z0-9-]+:$/.test(line));
  const body = lines.slice(start, end < 0 ? undefined : end);
  const steps = [];
  for (const line of body) {
    const match = /^ {6}- (?:name|uses): (.*)$/.exec(line);
    if (match) steps.push({ name: match[1], text: line });
    else if (steps.length > 0) steps.at(-1).text += `\n${line}`;
  }
  return steps;
}

const steps = jobSteps(workflow, "daemon");
const stepIndex = (name) => steps.findIndex((step) => step.name === name);
const step = (name) => {
  const found = steps[stepIndex(name)];
  assert.ok(found, `step ${name}`);
  return found;
};

test("pull requests into and pushes to the console line and its trunk both run", () => {
  const branches = "\\[console\\/main, candidate\\/console-heap-0\\.11\\.2\\]";
  assert.match(workflow, new RegExp(`pull_request:\\n(?: {4}#.*\\n)* {4}branches: ${branches}`));
  assert.match(workflow, new RegExp(`push:\\n(?: {4}#.*\\n)* {4}branches: ${branches}\\n`));
});

test("the release scripts are tested on every run", () => {
  const check = step("Check the release rules");
  assert.match(
    check.text,
    /node --test scripts\/console-release-channel\.test\.mjs scripts\/console-ci-workflow\.test\.mjs/,
  );
  assert.doesNotMatch(check.text, /\n {8}if:/);
});

test("a dispatched tag is checked against the release rule before anything is built", () => {
  const check = step("Check the release tag");
  assert.match(
    check.text,
    /if: github\.event_name == 'workflow_dispatch' && inputs\.release_tag != ''/,
  );
  assert.match(
    check.text,
    /node scripts\/console-release-channel\.mjs "\$GITHUB_REF" "\$RELEASE_TAG"/,
  );
  assert.ok(stepIndex("Check the release tag") < stepIndex("Install dependencies"));
});

test("the same seven packages and checksum files are packed for every release", () => {
  const pack = step("Pack release packages");
  assert.match(pack.text, /for package in highlight relay protocol client plugin server cli; do/);
  for (const file of ["SHA256SUMS", "SHA512SUMS", "SOURCE_COMMIT", "NODE_VERSION"]) {
    assert.match(pack.text, new RegExp(`> ${file}(\\n|$)`));
  }
});

test("a candidate lane publishes a prerelease; the trunk publishes a release", () => {
  const publish = step("Publish source-qualified release");
  assert.match(
    publish.text,
    /if: github\.event_name == 'workflow_dispatch' && inputs\.release_tag != ''/,
  );
  assert.doesNotMatch(publish.text, /test "\$GITHUB_REF" = refs\/heads\/internal\/main/);
  assert.match(
    publish.text,
    /channel="\$\(node scripts\/console-release-channel\.mjs "\$GITHUB_REF" "\$RELEASE_TAG" "\$version"\)"/,
  );
  assert.match(
    publish.text,
    /if \[ "\$channel" = prerelease \]; then prerelease=\(--prerelease\); fi/,
  );
  assert.match(
    publish.text,
    /gh release create "\$RELEASE_TAG" "\$RUNNER_TEMP\/paseo-release\/"\* --repo "\$GITHUB_REPOSITORY" --target "\$GITHUB_SHA" --title "\$RELEASE_TAG" "\$\{prerelease\[@\]\}"/,
  );
  assert.ok(stepIndex("Pack release packages") < stepIndex("Publish source-qualified release"));
});

test("the packed release installs the way the session image installs it, before anything is published", () => {
  const install = step("Install the release packages as the session image does");
  assert.match(install.text, /npm install --global --prefix "\$image" --no-audit --no-fund/);
  assert.match(install.text, /test "\$\("\$image\/bin\/paseo" --version\)" = "\$version"/);
  assert.ok(
    stepIndex("Pack release packages") <
      stepIndex("Install the release packages as the session image does"),
  );
  assert.ok(
    stepIndex("Install the release packages as the session image does") <
      stepIndex("Publish source-qualified release"),
  );
});

test("the managed-update anchors the image build edits survive the build", () => {
  // runner-images images/repo-pod/paseo-managed-update.mjs edits these exact anchors in the
  // built server and fails its image build if either is not found once. This job proves the
  // built output still carries them, on the runner that builds the release.
  const anchors = step("Check the managed-update anchors");
  assert.ok(stepIndex("Build daemon and CLI") < stepIndex("Check the managed-update anchors"));
  for (const anchor of [
    "installLatest(options = {})",
    "npm-global-cli.js",
    "daemonSelfUpdate: this.daemonRuntimeConfig?.desktopManaged !== true,",
    "websocket-server.js",
  ]) {
    assert.ok(anchors.text.includes(anchor), `anchor ${anchor}`);
  }
});

test("the server's unit suite runs unconditionally, and no Dockerfile compiles", () => {
  const unit = jobSteps(workflow, "server-unit");
  const run = unit.find((entry) => entry.name === "Run the server unit suite");
  assert.ok(run, "step Run the server unit suite");
  assert.match(run.text, /npm run test:unit --workspace=@getpaseo\/server/);
  assert.doesNotMatch(run.text, /\n {8}if:/);
});

test("no Dockerfile in the change compiles anything", () => {
  // This change adds no Dockerfile at all; the check is here so a later one cannot slip a
  // compiler into a Dockerfile under this workflow's name.
  assert.doesNotMatch(workflow, /docker build/i);
});
