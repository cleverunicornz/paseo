import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { ANCHORED_FILES, ANCHORS } from "./check-managed-update-anchors.mjs";

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

/** The `  <job>:` block of one job, with its `runs-on`, `permissions` and `if`. */
function jobBody(source, jobName) {
  const lines = source.split("\n");
  const start = lines.findIndex((line) => line === `  ${jobName}:`);
  assert.ok(start >= 0, `job ${jobName}`);
  const end = lines.findIndex((line, index) => index > start && /^ {2}[a-z0-9-]+:$/.test(line));
  return lines.slice(start, end < 0 ? undefined : end).join("\n");
}

const steps = jobSteps(workflow, "daemon");
const stepIndex = (name) => steps.findIndex((step) => step.name === name);
const step = (name) => {
  const found = steps[stepIndex(name)];
  assert.ok(found, `step ${name}`);
  return found;
};

/** One step's text with runs of whitespace collapsed, for a stable command match. */
function flat(text) {
  return text.replace(/\s+/g, " ").trim();
}

test("pull requests into and pushes to the console line and its trunk both run", () => {
  const branches = "\\[console\\/main, candidate\\/console-heap-0\\.11\\.2\\]";
  assert.match(workflow, new RegExp(`pull_request:\\n(?: {4}#.*\\n)* {4}branches: ${branches}`));
  assert.match(workflow, new RegExp(`push:\\n(?: {4}#.*\\n)* {4}branches: ${branches}\\n`));
});

test("the release scripts are tested on every run", () => {
  const check = step("Check the release rules");
  assert.match(
    check.text,
    /node --test scripts\/console-release-channel\.test\.mjs scripts\/console-ci-workflow\.test\.mjs scripts\/check-managed-update-anchors\.test\.mjs/,
  );
  assert.doesNotMatch(check.text, /\n {8}if:/);
});

test("a dispatched tag is checked against the release rule before anything is built", () => {
  const check = step("Check the release tag");
  assert.match(
    check.text,
    /if: github\.event_name == 'workflow_dispatch' && inputs\.release_tag != ''/,
  );
  // The guard takes the repository, the ref, the tag and the packages' base version.
  assert.match(
    flat(check.text),
    /node scripts\/console-release-channel\.mjs guard \\ "\$GITHUB_REPOSITORY" "\$GITHUB_REF" "\$RELEASE_TAG" \\ "\$\(node -p 'require\("\.\/packages\/server\/package\.json"\)\.version'\)"/,
  );
  assert.ok(stepIndex("Check the release tag") < stepIndex("Install dependencies"));
  assert.ok(stepIndex("Check the release tag") < stepIndex("Build daemon and CLI"));
});

test("only the publish job carries the write token, and only after the guard", () => {
  // Qualification is read-only, at the workflow level and on the qualifying jobs.
  assert.match(workflow, /\npermissions:\n {2}contents: read\n/);
  assert.match(jobBody(workflow, "daemon"), /\n {4}permissions:\n {6}contents: read\n/);
  assert.match(jobBody(workflow, "server-unit"), /\n {4}permissions:\n {6}contents: read\n/);
  // The write token is the publish job's alone.
  assert.match(jobBody(workflow, "publish"), /\n {4}permissions:\n {6}contents: write\n/);
  const writes = [...workflow.matchAll(/contents: write/g)].length;
  assert.equal(writes, 1, "one contents: write in the whole workflow");
  // It runs only on a dispatch with a tag, and only after the build it republishes.
  const publish = jobBody(workflow, "publish");
  assert.match(
    publish,
    /if: github\.event_name == 'workflow_dispatch' && inputs\.release_tag != ''/,
  );
  assert.match(publish, /needs: daemon/);
  assert.match(publish, /gh release create/);
});

test("the daemon job never publishes; the publish job only publishes", () => {
  // The release command lives in the publish job, not in the build job.
  assert.doesNotMatch(workflow.split("  publish:")[0], /gh release create/);
  const publishSteps = jobSteps(workflow, "publish");
  const publishes = publishSteps.filter((entry) => /gh release create/.test(entry.text));
  assert.equal(publishes.length, 1);
});

test("the same seven packages and checksum files are packed for every release", () => {
  const pack = step("Pack release packages");
  assert.match(pack.text, /for package in highlight relay protocol client plugin server cli; do/);
  for (const file of ["SHA256SUMS", "SHA512SUMS", "SOURCE_COMMIT", "NODE_VERSION"]) {
    assert.match(pack.text, new RegExp(`> ${file}(\\n|$)`));
  }
});

test("the version rewrite takes the tag's version, and checks it against the tag", () => {
  const set = step("Set the release version");
  // The version comes from the tag, never from the packages, which still carry the base.
  assert.match(
    set.text,
    /version="\$\(node scripts\/console-release-channel\.mjs version "\$GITHUB_REF" "\$RELEASE_TAG"\)"/,
  );
  assert.match(set.text, /node scripts\/sync-workspace-versions\.mjs/);
  // After the rewrite the packed version is checked against the tag's version.
  assert.match(
    flat(set.text),
    /node scripts\/console-release-channel\.mjs packed-version \\ "\$RELEASE_TAG" "\$\(node -p 'require\("\.\/packages\/server\/package\.json"\)\.version'\)"/,
  );
  assert.ok(stepIndex("Set the release version") < stepIndex("Pack release packages"));
});

test("the packed release installs the way the session image installs it, before anything is published", () => {
  const install = step("Install the release packages as the session image does");
  assert.match(install.text, /npm install --global --prefix "\$image" --no-audit --no-fund/);
  assert.match(install.text, /test "\$\("\$image\/bin\/paseo" --version\)" = "\$version"/);
  assert.ok(
    stepIndex("Pack release packages") <
      stepIndex("Install the release packages as the session image does"),
  );
});

test("the managed-update anchors are checked against upstream's own bytes", () => {
  // runner-images images/repo-pod/paseo-managed-update.mjs edits two exact anchors in the
  // built server and fails its image build if either is not found once, or if the CLI body
  // around its anchor has moved. So this job compares both built files to the upstream
  // tarball the runner-images pin names, not just the anchor strings. The rules and their
  // anchors live in the checker, which has its own tests.
  const anchors = step("Check the managed-update anchors");
  assert.ok(stepIndex("Build daemon and CLI") < stepIndex("Check the managed-update anchors"));
  // The checker requires both files and both anchors, as the consumer does.
  assert.deepEqual(Object.keys(ANCHORS).sort(), ANCHORED_FILES.slice().sort());
  for (const anchor of [
    "installLatest(options = {})",
    "daemonSelfUpdate: this.daemonRuntimeConfig?.desktopManaged !== true,",
  ]) {
    assert.ok(Object.values(ANCHORS).includes(anchor), `anchor ${anchor}`);
  }
  // It fetches upstream's tarball, checks its pinned sha256, and runs the checker.
  assert.match(anchors.text, /registry\.npmjs\.org\/@getpaseo\/server\/-\/server-0\.11\.2\.tgz/);
  assert.match(anchors.text, /7a727fcbb8f96ff044d4a60526af8b0f6adce2c827dc74b4bd75677e97798a50/);
  assert.match(anchors.text, /sha256sum --check/);
  assert.match(
    flat(anchors.text),
    /node scripts\/check-managed-update-anchors\.mjs "\$server" "\$upstream\/package\/dist\/server\/server"/,
  );
});

test("the server's unit suite runs on the smallest test set, and no Dockerfile compiles", () => {
  const unit = jobSteps(workflow, "server-unit");
  const run = unit.find((entry) => entry.name === "Run the server unit suite");
  assert.ok(run, "step Run the server unit suite");
  assert.match(run.text, /npm run test:unit --workspace=@getpaseo\/server/);
  assert.doesNotMatch(run.text, /\n {8}if:/);
  // The ladder's first rung: the test sets are automation-test-*, never build-native.
  assert.match(
    jobBody(workflow, "server-unit"),
    /runs-on: \{ group: ci, labels: automation-test-s \}/,
  );
  assert.doesNotMatch(jobBody(workflow, "server-unit"), /build-native/);
  // The whole workflow runs no test job on a build set.
  assert.doesNotMatch(jobBody(workflow, "daemon"), /automation-test/);
});

test("no Dockerfile in the change compiles anything", () => {
  // This change adds no Dockerfile at all; the check is here so a later one cannot slip a
  // compiler into a Dockerfile under this workflow's name.
  assert.doesNotMatch(workflow, /docker build/i);
});

test("the console line's ancestry and its built payload are both checked", () => {
  // The 2026-10-16 v0.11.2-cvu.2 defect: the tag named the console line, the payload was a
  // 0.10.3 v2-line build. Both halves must be refused before a release is consumed.
  const ancestry = step("Check the console release ancestry");
  for (const commit of ["759532509", "d282eb2ed"]) {
    assert.match(ancestry.text, new RegExp(`git merge-base --is-ancestor ${commit} HEAD`));
  }
  // The ancestry check names commits by SHA, so the clone must carry them as
  // objects: a shallow checkout fails with "Not a valid object name" (run
  // 38845067423).
  assert.match(
    jobBody(workflow, "daemon"),
    /uses: actions\/checkout@[0-9a-f]+\n\s+with:\n(?:\s+#.*\n)*\s+fetch-depth: 0/,
  );
  // The payload check reads what was built, and runs after the build.
  const payload = step("Check the built payload carries both fixes");
  assert.match(payload.text, /packages\/server\/dist\/server\/server/);
  assert.match(payload.text, /assertPayloadCarriesFixes/);
  assert.ok(
    stepIndex("Build daemon and CLI") < stepIndex("Check the built payload carries both fixes"),
  );
  // The provenance script has its own tests in the release-rules step.
  assert.match(
    step("Check the release rules").text,
    /scripts\/console-release-provenance\.test\.mjs/,
  );
});
