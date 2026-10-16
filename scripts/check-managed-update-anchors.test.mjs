import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  ANCHORED_FILES,
  ANCHORS,
  checkManagedUpdateAnchors,
  CLI_SIGNATURE,
} from "./check-managed-update-anchors.mjs";

// The two files as upstream 0.11.2 builds them, enough of each to carry the consumer's
// anchor. The checker proves the consumer's own rule (each `old` string present exactly
// once) on the same shape.
const UPSTREAM = {
  "session/daemon/npm-global-cli.js": `const PASEO_CLI_PACKAGE = "@getpaseo/cli";
export class DefaultNpmGlobalPaseoCli {
${ANCHORS["session/daemon/npm-global-cli.js"]}
}
`,
  "websocket-server.js": `features: {
  ${ANCHORS["websocket-server.js"]}
}
`,
};

/** A built tree carrying upstream's files. */
function trees() {
  const root = mkdtempSync(path.join(os.tmpdir(), "anchors-"));
  const built = path.join(root, "built");
  for (const file of ANCHORED_FILES) {
    const target = path.join(built, file);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, UPSTREAM[file]);
  }
  return { root, built };
}

test("the anchors are exactly the consumer's old strings", () => {
  // The CLI anchor is the whole installLatest body, which the consumer replaces; a change
  // anywhere inside it moves the anchor. The websocket anchor is one line.
  assert.ok(ANCHORS[ANCHORED_FILES[0]].trimStart().startsWith(CLI_SIGNATURE));
  assert.ok(ANCHORS[ANCHORED_FILES[0]].includes("maxBuffer: NPM_MAX_BUFFER_BYTES"));
  assert.equal(
    ANCHORS[ANCHORED_FILES[1]],
    "daemonSelfUpdate: this.daemonRuntimeConfig?.desktopManaged !== true,",
  );
});

test("a build carrying both anchors once passes", () => {
  const { root, built } = trees();
  try {
    checkManagedUpdateAnchors({ builtDir: built });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a CLI-body change the consumer refuses fails the check", () => {
  // The signature is intact, but the body moved, so the consumer's own patch would refuse
  // with "anchor found 0 times, expected 1".
  const { root, built } = trees();
  try {
    const cli = path.join(built, ANCHORED_FILES[0]);
    const text = readFileSync(cli, "utf8");
    assert.ok(text.includes("maxBuffer: NPM_MAX_BUFFER_BYTES"), "the body anchor is there");
    assert.ok(text.includes(CLI_SIGNATURE), "the signature is still there");
    writeFileSync(cli, text.replace("maxBuffer: NPM_MAX_BUFFER_BYTES", "maxBuffer: 1"));
    assert.throws(
      () => checkManagedUpdateAnchors({ builtDir: built }),
      /present 0 times, expected 1/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a missing or doubled anchor fails the check", () => {
  const { root, built } = trees();
  try {
    const cli = path.join(built, ANCHORED_FILES[0]);
    writeFileSync(cli, readFileSync(cli, "utf8").replace(CLI_SIGNATURE, "gone"));
    assert.throws(
      () => checkManagedUpdateAnchors({ builtDir: built }),
      /present 0 times, expected 1/,
    );
    // Restore, then double the websocket anchor.
    writeFileSync(cli, UPSTREAM[ANCHORED_FILES[0]]);
    const ws = path.join(built, ANCHORED_FILES[1]);
    const wsText = readFileSync(ws, "utf8");
    writeFileSync(
      ws,
      wsText.replace(
        ANCHORS[ANCHORED_FILES[1]],
        `${ANCHORS[ANCHORED_FILES[1]]} ${ANCHORS[ANCHORED_FILES[1]]}`,
      ),
    );
    assert.throws(
      () => checkManagedUpdateAnchors({ builtDir: built }),
      /present 2 times, expected 1/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a baked version fails the check", () => {
  const { root, built } = trees();
  try {
    const ws = path.join(built, ANCHORED_FILES[1]);
    writeFileSync(ws, `${readFileSync(ws, "utf8")}\nconst v = "0.11.2";\n`);
    assert.throws(() => checkManagedUpdateAnchors({ builtDir: built }), /a baked version/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the websocket anchor is accepted among a build's own changes", () => {
  // The console line's loop-health instrumentation (P-000289 H3) adds code to
  // websocket-server.js. The consumer replaces one line of that file, so other content is
  // irrelevant to it; the checker must accept what the consumer accepts, or it refuses a
  // fix the consumer takes. Byte-identity here was stricter than the consumer.
  const { root, built } = trees();
  try {
    const ws = path.join(built, ANCHORED_FILES[1]);
    const text = readFileSync(ws, "utf8");
    writeFileSync(
      ws,
      text.replace(
        "features: {",
        "import { LoopHealthMonitor } from './loop-health.js';\n\nfeatures: {",
      ),
    );
    assert.doesNotThrow(() => checkManagedUpdateAnchors({ builtDir: built }));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the command line runs the check and refuses with the reason", () => {
  const script = new URL("./check-managed-update-anchors.mjs", import.meta.url).pathname;
  const run = (dir) => execFileSync(process.execPath, [script, dir], { encoding: "utf8" });
  const { root, built } = trees();
  try {
    assert.match(run(built), /present exactly once each/);
    const cli = path.join(built, ANCHORED_FILES[0]);
    writeFileSync(cli, "nothing here");
    assert.throws(
      () => run(built),
      (error) => error.status === 1,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
