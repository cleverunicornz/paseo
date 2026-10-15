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
} from "./check-managed-update-anchors.mjs";

// The two files as upstream 0.11.2 builds them, enough of each to carry the anchor. The
// real byte comparison is the workflow step's, against the fetched upstream tarball; this
// test proves the checker's rules on the same shape.
const UPSTREAM = {
  "session/daemon/npm-global-cli.js": `const PASEO_CLI_PACKAGE = "@getpaseo/cli";
export class DefaultNpmGlobalPaseoCli {
    installLatest(options = {}) {
        const prefixArgs = options.prefix ? ["--prefix", options.prefix] : [];
        return this.runCommand("npm", ["install", "-g", \`\${PASEO_CLI_PACKAGE}@latest\`, ...prefixArgs], {
            timeout: NPM_INSTALL_TIMEOUT_MS,
            maxBuffer: NPM_MAX_BUFFER_BYTES,
        });
    }
}
`,
  "websocket-server.js": `features: {
  daemonSelfUpdate: this.daemonRuntimeConfig?.desktopManaged !== true,
}
`,
};

/** A copy of upstream's files as the built server, and the same as upstream. */
function trees() {
  const root = mkdtempSync(path.join(os.tmpdir(), "anchors-"));
  const built = path.join(root, "built");
  const upstream = path.join(root, "upstream");
  for (const file of ANCHORED_FILES) {
    for (const dir of [built, upstream]) {
      const target = path.join(dir, file);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, UPSTREAM[file]);
    }
  }
  return { root, built, upstream };
}

test("a build that equals upstream passes", () => {
  const { root, built, upstream } = trees();
  try {
    checkManagedUpdateAnchors({ builtDir: built, upstreamDir: upstream });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a CLI-body change the consumer refuses fails the check", () => {
  // The round-1 coverage gap: the signature is intact, but the body moved, so the
  // consumer's own patch would refuse with "anchor found 0 times, expected 1".
  const { root, built, upstream } = trees();
  try {
    const cli = path.join(built, ANCHORED_FILES[0]);
    const text = readFileSync(cli, "utf8");
    assert.ok(text.includes("maxBuffer: NPM_MAX_BUFFER_BYTES"), "the body anchor is there");
    assert.ok(text.includes(ANCHORS[ANCHORED_FILES[0]]), "the signature is still there");
    writeFileSync(cli, text.replace("maxBuffer: NPM_MAX_BUFFER_BYTES", "maxBuffer: 1"));
    assert.throws(
      () => checkManagedUpdateAnchors({ builtDir: built, upstreamDir: upstream }),
      /differs from upstream 0\.11\.2/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a missing or doubled anchor fails the check", () => {
  const { root, built, upstream } = trees();
  try {
    const cli = path.join(built, ANCHORED_FILES[0]);
    writeFileSync(cli, readFileSync(cli, "utf8").replace(ANCHORS[ANCHORED_FILES[0]], "gone"));
    assert.throws(
      () => checkManagedUpdateAnchors({ builtDir: built, upstreamDir: upstream }),
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
      () => checkManagedUpdateAnchors({ builtDir: built, upstreamDir: upstream }),
      /present 2 times, expected 1/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a baked version fails the check", () => {
  const { root, built, upstream } = trees();
  try {
    const ws = path.join(built, ANCHORED_FILES[1]);
    writeFileSync(ws, `${readFileSync(ws, "utf8")}\nconst v = "0.11.2";\n`);
    assert.throws(
      () => checkManagedUpdateAnchors({ builtDir: built, upstreamDir: upstream }),
      /a baked version/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the command line runs the check and refuses with the reason", () => {
  const script = new URL("./check-managed-update-anchors.mjs", import.meta.url).pathname;
  const run = (...args) => execFileSync(process.execPath, [script, ...args], { encoding: "utf8" });
  const { root, built, upstream } = trees();
  try {
    assert.match(run(built, upstream), /match upstream 0\.11\.2 byte for byte/);
    assert.throws(
      () => run(built, path.join(root, "nowhere")),
      (error) => error.status === 1,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
