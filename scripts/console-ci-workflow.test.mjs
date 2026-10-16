import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ANCHORED_FILES, ANCHORS, CLI_SIGNATURE } from "./check-managed-update-anchors.mjs";
import { PORT_COMMITS, SCHEDULER_SOURCE_COMMIT } from "./console-release-provenance.mjs";

/** The full ids the checklist must name; the gate's own copies are prefixes. */
const UPSTREAM_0_11_2_FULL = "75953250959979b8f088bbca8dbd6ee61d0151b1";
const HEAP_FIX_COMMIT_FULL = "d282eb2edb418d6988f10837c826d652c1596c4f";

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

test("the managed-update anchors are checked by the consumer's own rule", () => {
  // runner-images images/repo-pod/paseo-managed-update.mjs replaces each of two exact
  // strings in the built server, failing if either is not present exactly once. The CLI
  // anchor is the whole installLatest body; the websocket anchor is one line. The checker
  // applies exactly that rule on the built files. The rules and their anchors live in the
  // checker, which has its own tests.
  const anchors = step("Check the managed-update anchors");
  assert.ok(stepIndex("Build daemon and CLI") < stepIndex("Check the managed-update anchors"));
  // The checker requires both files and both anchors, as the consumer does.
  assert.deepEqual(Object.keys(ANCHORS).sort(), ANCHORED_FILES.slice().sort());
  assert.ok(ANCHORS[ANCHORED_FILES[0]].includes(CLI_SIGNATURE));
  assert.ok(ANCHORS[ANCHORED_FILES[0]].includes("maxBuffer: NPM_MAX_BUFFER_BYTES"));
  assert.ok(
    Object.values(ANCHORS).includes(
      "daemonSelfUpdate: this.daemonRuntimeConfig?.desktopManaged !== true,",
    ),
  );
  // It checks the built server, not a fetched upstream tarball: byte-identity would refuse a
  // change to websocket-server.js that the consumer accepts (P-000289 H3 adds one).
  assert.match(
    flat(anchors.text),
    /node scripts\/check-managed-update-anchors\.mjs packages\/server\/dist\/server\/server/,
  );
  assert.doesNotMatch(anchors.text, /registry\.npmjs\.org/);
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
  // The payload check reads what was built, and runs after the build. It RUNS the
  // built code through the behavior probes: the r1 validator reverted the bound
  // and either heap helper with every marker string intact, and a substring
  // search accepted all three mutants.
  const payload = step("Check the built payload carries both fixes");
  assert.match(payload.text, /assertPayloadCarriesFixes\("packages\/server\/dist\/server"\)/);
  assert.ok(
    stepIndex("Build daemon and CLI") < stepIndex("Check the built payload carries both fixes"),
  );
  // The provenance script has its own tests in the release-rules step, and the
  // probes are not a marker list at all: no substring constants remain.
  const releaseRules = step("Check the release rules");
  assert.match(releaseRules.text, /scripts\/console-release-provenance\.test\.mjs/);
  assert.match(releaseRules.text, /scripts\/release-assets\.test\.mjs/);
  assert.doesNotMatch(workflow, /PAYLOAD_MARKERS/);
});

test("the prepublished identity is checked on the real packed assets", () => {
  // The r1 control: real 0.11.2 tarballs renamed to the tag's version passed the
  // old gate. This step reads each tarball's own embedded package.json, the
  // checksum tables against the tarballs' bytes, and SOURCE_COMMIT against the run.
  const identity = step("Check the release identity and its packed payload");
  assert.match(identity.text, /readReleaseAssets/);
  assert.match(identity.text, /assertPrepublicationProvenance/);
  assert.match(identity.text, /assertPackedReleaseAssets\(\{ tag, assets \}\)/);
  assert.match(identity.text, /assets\.sourceCommit, runCommit/);
  // It runs on a release dispatch, after the packs, before the upload.
  assert.match(identity.text, /if: github\.event_name == 'workflow_dispatch'/);
  assert.ok(
    stepIndex("Pack release packages") <
      stepIndex("Check the release identity and its packed payload"),
  );
});

test("the published release is qualified from its downloaded assets, read-only", () => {
  // POSTPUBLICATION: a downloaded release is the evidence. The job downloads the
  // release it just published, installs the tarballs as the image does, and runs
  // the probes against the INSTALLED server's dist, so the proof is of the
  // published bytes rather than of this run's build tree.
  const job = jobBody(workflow, "qualify-published");
  assert.match(job, /needs: publish/);
  assert.match(job, /permissions:\n {6}contents: read\n/);
  assert.doesNotMatch(job, /contents: write/);
  const download = jobSteps(workflow, "qualify-published").find((entry) =>
    /gh release download/.test(entry.text),
  );
  assert.ok(download, "step downloading the release");
  const qualify = jobSteps(workflow, "qualify-published").find((entry) =>
    /assertReleaseProvenance/.test(entry.text),
  );
  assert.ok(qualify, "step qualifying the release");
  assert.match(qualify.text, /installedRoot, "@getpaseo\/server\/dist\/server"/);
  assert.match(qualify.text, /assertPayloadCarriesFixes/);
  assert.match(qualify.text, /readReleaseAssets/);
  // The write token stays the publish job's alone; the qualifier only reads.
  assert.equal([...workflow.matchAll(/contents: write/g)].length, 1);
});

test("the tracked checklist names the full commits and requires the kit receipt", () => {
  // F4: the gate before the operator ask must name the real identity, in full,
  // and must require a receipt for the selected kit and the published payload.
  // Abbreviations and marker claims are what let cvu.2 through.
  const checklist = readFileSync(
    new URL("../docs/console-release-checklist.md", import.meta.url),
    "utf8",
  );
  for (const commit of [
    UPSTREAM_0_11_2_FULL,
    HEAP_FIX_COMMIT_FULL,
    PORT_COMMITS.schedulerBound,
    PORT_COMMITS.incrementalReconciliation,
    PORT_COMMITS.loopInstrumentation,
    SCHEDULER_SOURCE_COMMIT,
  ]) {
    assert.match(checklist, new RegExp(commit), `the checklist names ${commit} in full`);
  }
  // The receipt and the version binding are required before the ask.
  assert.match(checklist, /pct current/);
  assert.match(checklist, /kit sha/);
  assert.match(checklist, /receipt/i);
  // The payload rule is behavioral, and markers are explicitly not proof.
  assert.match(checklist, /behavior/i);
  assert.match(checklist, /marker string as proof/);
  // The two halves are separated, as F3 requires.
  assert.match(checklist, /Prepublication identity/);
  assert.match(checklist, /Postpublication qualification/);
});

// Execute the workflow's own shell/JavaScript, so release-only wiring is tested on PRs.
function runBlock(entry) {
  return entry.text.split("        run: |\n")[1].replace(/^ {10}/gm, "");
}

test("published-tag resolution works in checkout's shallow no-tags shape and binds its source", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "published-tag-"));
  const source = path.join(root, "source");
  const checkout = path.join(root, "checkout");
  const git = (cwd, ...args) =>
    execFileSync("git", args, { cwd, encoding: "utf8", stdio: "pipe" }).trim();
  try {
    mkdirSync(source);
    mkdirSync(checkout);
    git(source, "init");
    git(source, "config", "user.name", "Release fixture");
    git(source, "config", "user.email", "release@example.invalid");
    writeFileSync(path.join(source, "file"), "one");
    git(source, "add", "file");
    git(source, "-c", "core.hooksPath=/dev/null", "commit", "-m", "first fixture");
    const first = git(source, "rev-parse", "HEAD");
    git(source, "tag", "v0.11.2-cvu.3");
    writeFileSync(path.join(source, "file"), "two");
    git(source, "-c", "core.hooksPath=/dev/null", "commit", "-am", "second fixture");
    const second = git(source, "rev-parse", "HEAD");
    git(source, "tag", "-a", "v0.11.2-cvu.4", "-m", "annotated fixture");
    git(checkout, "init");
    git(
      checkout,
      "-c",
      "protocol.version=2",
      "fetch",
      "--no-tags",
      "--prune",
      "--no-recurse-submodules",
      "--depth=1",
      `file://${source}`,
      `+${first}:refs/remotes/origin/console/main`,
    );
    git(checkout, "-c", "core.hooksPath=/dev/null", "checkout", "--detach", first);
    assert.equal(git(checkout, "rev-parse", "--is-shallow-repository"), "true");
    assert.equal(git(checkout, "tag", "--list"), "");
    // Only the exact canonical repository URL is redirected into our local fixture.
    // origin deliberately names the wrong repository; a cached local tag is untrusted too.
    git(checkout, "remote", "add", "origin", "https://github.com/other/paseo");
    git(
      checkout,
      "config",
      `url.file://${source}.insteadOf`,
      "https://github.com/cleverunicornz/paseo",
    );
    mkdirSync(path.join(checkout, "scripts"));
    for (const file of [
      "resolve-published-tag.mjs",
      "console-release-channel.mjs",
      "is-main-module.mjs",
    ]) {
      cpSync(path.resolve("scripts", file), path.join(checkout, "scripts", file));
    }
    const qualify = jobSteps(workflow, "qualify-published").find(
      (entry) => entry.name === "Qualify the published release",
    );
    const prefix = runBlock(qualify).split("# Install the seven downloaded tarballs")[0];
    const run = (tag, commit = first, repository = "cleverunicornz/paseo") =>
      spawnSync("bash", ["-c", `${prefix}\nprintf '%s\n' "$tag_commit"`], {
        cwd: checkout,
        encoding: "utf8",
        env: {
          ...process.env,
          GITHUB_REPOSITORY: repository,
          RELEASE_TAG: tag,
          GITHUB_SHA: commit,
          RUNNER_TEMP: root,
        },
      });
    const good = run("v0.11.2-cvu.3");
    assert.equal(good.status, 0, good.stderr);
    assert.equal(good.stdout.trim(), first);
    git(checkout, "fetch", "--no-tags", "--depth=1", `file://${source}`, second);
    git(checkout, "tag", "v0.11.2-cvu.3", second); // wrong local tag must never supply identity
    assert.equal(run("v0.11.2-cvu.3").stdout.trim(), first);
    assert.notEqual(run("v0.11.2-cvu.3", second).status, 0, "wrong run commit refuses");
    assert.notEqual(
      run("v0.11.2-cvu.3", first, "other/paseo").status,
      0,
      "wrong repository refuses",
    );
    git(checkout, "tag", "v0.11.2-cvu.5", first);
    assert.notEqual(run("v0.11.2-cvu.5").status, 0, "local-only tag refuses");
    const annotated = run("v0.11.2-cvu.4", second);
    assert.equal(annotated.status, 0, annotated.stderr);
    assert.equal(annotated.stdout.trim(), second);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the actual prepublish invocation refuses incomplete checksum coverage in either table", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "prepublish-coverage-"));
  const releaseDir = path.join(root, "release");
  const packageDir = path.join(root, "package");
  mkdirSync(releaseDir);
  mkdirSync(packageDir);
  const names = ["highlight", "relay", "protocol", "client", "plugin", "server", "cli"];
  const sums = { SHA256SUMS: [], SHA512SUMS: [] };
  try {
    for (const name of names) {
      const file = `getpaseo-${name}-0.11.2-cvu.3.tgz`;
      writeFileSync(
        path.join(packageDir, "package.json"),
        JSON.stringify({ name: `@getpaseo/${name}`, version: "0.11.2-cvu.3" }),
      );
      execFileSync("tar", ["-czf", path.join(releaseDir, file), "package/package.json"], {
        cwd: root,
      });
      for (const [table, algorithm] of [
        ["SHA256SUMS", "sha256"],
        ["SHA512SUMS", "sha512"],
      ]) {
        sums[table].push(
          `${createHash(algorithm)
            .update(readFileSync(path.join(releaseDir, file)))
            .digest("hex")}  ${file}`,
        );
      }
    }
    for (const table of Object.keys(sums))
      writeFileSync(path.join(releaseDir, table), sums[table].join("\n") + "\n");
    const commit = "3555fc13558c354a39a33458af28dbb509bae597";
    writeFileSync(path.join(releaseDir, "SOURCE_COMMIT"), commit + "\n");
    writeFileSync(path.join(releaseDir, "NODE_VERSION"), process.version + "\n");
    const block = runBlock(step("Check the release identity and its packed payload")).match(
      /<<'JS'\n([\s\S]*?)\nJS/,
    )[1];
    const run = () =>
      spawnSync(
        process.execPath,
        ["--input-type=module", "-", releaseDir, "v0.11.2-cvu.3", commit],
        { cwd: process.cwd(), input: block, encoding: "utf8" },
      );
    for (const table of Object.keys(sums)) {
      for (const shape of ["duplicate", "missing", "extra", "malformed", "wrong-digest"]) {
        const lines = sums[table];
        const altered = {
          duplicate: Array(7).fill(lines[0]),
          missing: lines.slice(1),
          extra: [...lines, lines[0]],
          malformed: ["not a checksum", ...lines.slice(1)],
          "wrong-digest": [
            lines[0].replace(/^[0-9a-f]+/, "0".repeat(table === "SHA256SUMS" ? 64 : 128)),
            ...lines.slice(1),
          ],
        }[shape];
        writeFileSync(path.join(releaseDir, table), altered.join("\n") + "\n");
        const result = run();
        assert.notEqual(result.status, 0, `${table} ${shape} accepted`);
        assert.match(
          result.stderr,
          /seven tarballs|checksum line is malformed|digest does not match|entries/,
          result.stderr,
        );
        writeFileSync(path.join(releaseDir, table), lines.join("\n") + "\n");
      }
    }
    // The identity must pass. Before compilation, the existing behavioral probe is the
    // only expected refusal; after compilation, the entire workflow invocation must pass.
    const good = run();
    if (good.status !== 0) assert.match(good.stderr, /built payload does not behave/, good.stderr);
    else assert.match(good.stdout, /packs the tag's version/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
