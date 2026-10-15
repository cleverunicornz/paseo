import { readFileSync } from "node:fs";
import path from "node:path";
import { isMainModule } from "./is-main-module.mjs";

// runner-images images/repo-pod/paseo-managed-update.mjs edits two exact anchors in the
// built server and fails its image build if either is not found exactly once. Its CLI
// anchor is the whole `installLatest` body, not the signature, so a change anywhere inside
// that body — a different `maxBuffer`, say — makes the image build refuse. This check
// therefore requires byte-identity of both built files to upstream 0.11.2's, which covers
// every change the consumer would refuse and nothing the console's line is allowed to make.
export const ANCHORED_FILES = ["session/daemon/npm-global-cli.js", "websocket-server.js"];

// The anchor strings, as the consumer requires them, for the message when one is missing.
export const ANCHORS = {
  "session/daemon/npm-global-cli.js": "installLatest(options = {})",
  "websocket-server.js": "daemonSelfUpdate: this.daemonRuntimeConfig?.desktopManaged !== true,",
};

/**
 * Prove the built server keeps the anchors the image build edits, and keeps them as
 * upstream published them.
 *
 * `builtDir` is the built server's `dist/server/server`; `upstreamDir` is the same
 * directory as unpacked from the upstream `@getpaseo/server` tarball the runner-images pin
 * names. Both anchored files must be present once, carry no baked version, and equal
 * upstream's bytes.
 */
export function checkManagedUpdateAnchors({ builtDir, upstreamDir }) {
  for (const file of ANCHORED_FILES) {
    const built = readFileSync(path.join(builtDir, file), "utf8");
    const count = built.split(ANCHORS[file]).length - 1;
    if (count !== 1) {
      throw new Error(`${file}: the anchor is present ${count} times, expected 1`);
    }
    const version = built.match(/\b0\.11\.2\b/g);
    if (version) {
      throw new Error(
        `${file}: a baked version (${version.length}) — the console reads it at runtime`,
      );
    }
    const upstream = readFileSync(path.join(upstreamDir, file), "utf8");
    if (built !== upstream) {
      throw new Error(
        `${file}: differs from upstream 0.11.2, which the managed-update patch requires byte for byte`,
      );
    }
  }
}

if (isMainModule(import.meta.url)) {
  const [builtDir, upstreamDir] = process.argv.slice(2);
  try {
    if (!builtDir || !upstreamDir) {
      throw new Error("usage: check-managed-update-anchors.mjs <built dir> <upstream dir>");
    }
    checkManagedUpdateAnchors({ builtDir, upstreamDir });
    process.stdout.write("The managed-update anchors match upstream 0.11.2 byte for byte.\n");
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  }
}
