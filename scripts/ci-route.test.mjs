import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";

const scriptPath = new URL("ci-route.mjs", import.meta.url).pathname;
const filtersPath = new URL("../.github/ci-paths.yml", import.meta.url).pathname;

function parse(stdout) {
  return Object.fromEntries(
    stdout
      .trim()
      .split("\n")
      .map((line) => line.split("=", 2)),
  );
}

function route(files) {
  const stdout = execFileSync(process.execPath, [scriptPath, "--event", "pull_request", "--filters", filtersPath], {
    encoding: "utf8",
    env: { ...process.env, CI_ROUTE_FILES: files.join("\n") },
  });
  return parse(stdout);
}

test("glob engine handles the syntax used by ci-paths.yml", () => {
  const routed = route([
    "packages/app/src/foo.ts",
    "packages/app/src/desktop/bar.ts",
    "packages/app/vite.config.ts",
    "packages/desktop/e2e/x.spec.ts",
    "packages/server/src/y.ts",
  ]);

  assert.equal(routed.app, "true", "packages/app/** matches any app file");
  assert.equal(routed.desktop, "true", "desktop e2e spec matches desktop contract");
  const desktopOnly = route(["packages/app/src/desktop/bridge.ts"]);
  assert.equal(desktopOnly.app, "true");
  assert.equal(desktopOnly.browser, "false", "packages/app/src/!(desktop)/** excludes the desktop subtree");
  assert.equal(desktopOnly.desktop, "true", "src/desktop belongs to the desktop contract");

  const supportFixture = route(["packages/app/e2e/support/fixtures/recording.ts"]);
  assert.equal(supportFixture.desktop, "true", "support fixtures belong to desktop");
  assert.equal(supportFixture.browser, "true", "support fixtures also belong to browser");
});

test("single-star globs do not cross directories", () => {
  assert.equal(route(["packages/app/vite.config.ts"]).browser, "true");
  assert.equal(route(["packages/app/deep/vite.config.ts"]).browser, "false");
});

test("pull requests with unrelated files route nothing", () => {
  const routed = route(["docker/base/Dockerfile"]);
  assert.equal(routed.routing, "false");
  assert.equal(routed.format, "false");
  assert.equal(routed.cli, "false");
});

test("workflow file changes hit the ci contract", () => {
  assert.equal(route([".github/workflows/ci.yml"]).ci, "true");
});

test("non-pull_request events route every contract", () => {
  const routed = parse(execFileSync(process.execPath, [scriptPath, "--event", "push"], { encoding: "utf8" }));
  for (const group of ["format", "quality", "server", "desktop", "app", "sdk", "browser", "relay", "cli"]) {
    assert.equal(routed[group], "true", `${group} routes on push`);
  }
});

test("ci workflow uses the in-repo router, not a third-party filter action", () => {
  const workflow = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
  assert.match(workflow, /scripts\/ci-route\.mjs/);
  assert.doesNotMatch(workflow, /dorny\/paths-filter/);
});
