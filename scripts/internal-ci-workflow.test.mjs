import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(
  new URL("../.github/workflows/internal-ci.yml", import.meta.url),
  "utf8",
);

/** The `- name:` / `- uses:` steps of one job, in order, each with its full text. */
function jobSteps(jobName) {
  const lines = workflow.split("\n");
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

const steps = jobSteps("daemon");
const stepIndex = (name) => steps.findIndex((step) => step.name === name);
const step = (name) => {
  const found = steps[stepIndex(name)];
  assert.ok(found, `step ${name}`);
  return found;
};

test("pull requests into internal/main and every candidate lane run; pushes only on internal/main", () => {
  assert.match(workflow, /pull_request:\n(?: {4}#.*\n)* {4}branches: \[internal\/main, "candidate\/\*\*"\]/);
  assert.match(workflow, /push:\n {4}branches: \[internal\/main\]\n/);
});

test("the release scripts are tested on every run", () => {
  const check = step("Check the release rules");
  assert.match(
    check.text,
    /node --test scripts\/internal-release-channel\.test\.mjs scripts\/internal-ci-workflow\.test\.mjs/,
  );
  assert.doesNotMatch(check.text, /\n {8}if:/);
});

test("a dispatched tag is checked against the release rule before anything is built", () => {
  const check = step("Check the release tag");
  assert.match(check.text, /if: github\.event_name == 'workflow_dispatch' && inputs\.release_tag != ''/);
  assert.match(check.text, /node scripts\/internal-release-channel\.mjs "\$GITHUB_REF" "\$RELEASE_TAG"/);
  assert.ok(stepIndex("Check the release tag") < stepIndex("Install dependencies"));
});

test("the same seven packages and checksum files are packed for every release", () => {
  const pack = step("Pack release packages");
  assert.match(pack.text, /for package in highlight relay protocol client plugin server cli; do/);
  for (const file of ["SHA256SUMS", "SHA512SUMS", "SOURCE_COMMIT", "NODE_VERSION"]) {
    assert.match(pack.text, new RegExp(`> ${file}(\\n|$)`));
  }
});

test("a candidate lane publishes a prerelease; internal/main publishes as before", () => {
  const publish = step("Publish source-qualified release");
  assert.match(publish.text, /if: github\.event_name == 'workflow_dispatch' && inputs\.release_tag != ''/);
  assert.doesNotMatch(publish.text, /test "\$GITHUB_REF" = refs\/heads\/internal\/main/);
  assert.match(
    publish.text,
    /channel="\$\(node scripts\/internal-release-channel\.mjs "\$GITHUB_REF" "\$RELEASE_TAG" "\$version"\)"/,
  );
  assert.match(publish.text, /if \[ "\$channel" = prerelease \]; then prerelease=\(--prerelease\); fi/);
  assert.match(
    publish.text,
    /gh release create "\$RELEASE_TAG" "\$RUNNER_TEMP\/paseo-release\/"\* --repo "\$GITHUB_REPOSITORY" --target "\$GITHUB_SHA" --title "\$RELEASE_TAG" "\$\{prerelease\[@\]\}"/,
  );
  assert.ok(stepIndex("Pack release packages") < stepIndex("Publish source-qualified release"));
});
