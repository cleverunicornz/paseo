import { readFileSync } from "node:fs";
import path from "node:path";
import { isMainModule } from "./is-main-module.mjs";

// runner-images images/repo-pod/paseo-managed-update.mjs edits two exact anchors in the
// built server and fails its image build if either is not found exactly once. The check
// here must be exactly as strict as that consumer, no stricter: a rule stricter than the
// consumer refuses a fix the consumer accepts.
//
// The consumer's rule, per file, is that its `old` string is present exactly once (it
// replaces that string with its `new` one). The two files differ in what `old` is:
//
//   - session/daemon/npm-global-cli.js: `old` is the WHOLE `installLatest` body, so any
//     change inside that body (a different `maxBuffer`, say) would move the anchor and the
//     image build would refuse. Nothing in the console's line changes that body, and this
//     check keeps that true.
//   - websocket-server.js: `old` is a single line, `daemonSelfUpdate: ...`. The consumer
//     replaces only that line, so other content in the file is irrelevant to it. This
//     check requires that line present exactly once, not byte-identity: the console line's
//     loop-health instrumentation (infra-v2 P-000289 H3, PR #24) necessarily adds code to
//     this file, and the consumer's own patcher was verified to apply to that build.
export const ANCHORED_FILES = ["session/daemon/npm-global-cli.js", "websocket-server.js"];

// The consumer's `old` strings, as runner-images images/repo-pod/paseo-managed-update.mjs
// declares them, for the message when one is missing.
export const ANCHORS = {
  "session/daemon/npm-global-cli.js": `    installLatest(options = {}) {
        const prefixArgs = options.prefix ? ["--prefix", options.prefix] : [];
        return this.runCommand("npm", ["install", "-g", \`\${PASEO_CLI_PACKAGE}@latest\`, ...prefixArgs], {
            timeout: NPM_INSTALL_TIMEOUT_MS,
            maxBuffer: NPM_MAX_BUFFER_BYTES,
        });
    }`,
  "websocket-server.js": "daemonSelfUpdate: this.daemonRuntimeConfig?.desktopManaged !== true,",
};

// The signature the consumer's message names when the CLI body is missing.
export const CLI_SIGNATURE = "installLatest(options = {})";

/**
 * Prove the built server keeps the anchors the image build edits, exactly as the consumer
 * requires them.
 *
 * `builtDir` is the built server's `dist/server/server`. Each consumer anchor must be
 * present exactly once, and the file must carry no baked version (the console reads its
 * version at runtime; a baked one would make the image's own version check disagree).
 */
export function checkManagedUpdateAnchors({ builtDir }) {
  for (const file of ANCHORED_FILES) {
    const built = readFileSync(path.join(builtDir, file), "utf8");
    const count = built.split(ANCHORS[file]).length - 1;
    if (count !== 1) {
      const named = file === ANCHORED_FILES[0] ? ` (${CLI_SIGNATURE})` : "";
      throw new Error(`${file}${named}: the anchor is present ${count} times, expected 1`);
    }
    const version = built.match(/\b0\.11\.2\b/g);
    if (version) {
      throw new Error(
        `${file}: a baked version (${version.length}) — the console reads it at runtime`,
      );
    }
  }
}

if (isMainModule(import.meta.url)) {
  const [builtDir] = process.argv.slice(2);
  try {
    if (!builtDir) {
      throw new Error("usage: check-managed-update-anchors.mjs <built dir>");
    }
    checkManagedUpdateAnchors({ builtDir });
    process.stdout.write("The managed-update anchors are present exactly once each.\n");
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  }
}
