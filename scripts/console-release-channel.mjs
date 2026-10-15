import { isMainModule } from "./is-main-module.mjs";

// The console's release line (infra-v2 P-000269 H2): the daemon the console runs is
// upstream v0.11.2 with the fork's leak fix, released from this line alone.
export const CONSOLE_TRUNK_REF = "refs/heads/console/main";
export const CONSOLE_CANDIDATE_REF = "refs/heads/candidate/console-heap-0.11.2";
export const CONSOLE_REPOSITORY = "cleverunicornz/paseo";

const COUNTER = "[1-9][0-9]*";
// The capture is the whole version the tag names, `0.11.2-cvu.1-rc.1` included.
const TRUNK_TAG = `^v(.+-cvu\\.${COUNTER})$`;
const CANDIDATE_TAG = `^v(.+-cvu\\.${COUNTER}-rc\\.${COUNTER})$`;

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function refShape(ref) {
  if (ref === CONSOLE_TRUNK_REF)
    return { channel: "release", pattern: TRUNK_TAG, wanted: "v<version>-cvu.N (N from 1)" };
  if (ref === CONSOLE_CANDIDATE_REF)
    return {
      channel: "prerelease",
      pattern: CANDIDATE_TAG,
      wanted: "v<version>-cvu.N-rc.M (N and M from 1)",
    };
  return undefined;
}

/**
 * The version a dispatched tag names, or a refusal.
 *
 * The tag is the released version: `v<version>-cvu.N-rc.M` on the candidate lane,
 * `v<version>-cvu.N` on the trunk. The ref alone decides which shape is allowed. Every
 * other ref, and every tag that does not match its ref's shape, refuses.
 */
export function consoleReleaseVersion({ ref, tag }) {
  const shape = refShape(ref);
  if (!shape) {
    throw new Error(
      `The console release publishes only from console/main or candidate/console-heap-0.11.2, not ${ref}`,
    );
  }
  const match = new RegExp(shape.pattern).exec(tag);
  if (!match) {
    throw new Error(`The console release publishes ${shape.wanted}, not ${JSON.stringify(tag)}`);
  }
  return match[1];
}

/**
 * The pre-build guard: refuse anything but this repository, these refs, these tag shapes
 * and this base version, before a dependency is installed or a package is built.
 *
 * `baseVersion` is the version the packages carry at the dispatched commit (`0.11.2`).
 * The tag's version must be that base with a `-cvu.N` suffix, so a tag naming another
 * base cannot rewrite the line onto a different upstream.
 */
export function assertConsoleRelease({ repository, ref, tag, baseVersion }) {
  if (repository !== CONSOLE_REPOSITORY) {
    throw new Error(
      `The console release publishes from ${CONSOLE_REPOSITORY} alone, not ${JSON.stringify(repository)}`,
    );
  }
  const version = consoleReleaseVersion({ ref, tag });
  const pattern = new RegExp(`^${escapeRegExp(baseVersion)}-cvu\\.${COUNTER}(-rc\\.${COUNTER})?$`);
  if (!pattern.test(version)) {
    throw new Error(
      `The console release is built on base ${baseVersion}, not ${JSON.stringify(version)}`,
    );
  }
}

/**
 * Which kind of GitHub release the console line's CI publishes for a dispatched tag.
 *
 * The trunk publishes a release; the candidate lane publishes a prerelease. The ref and
 * the tag's shape gate it; the pre-build guard has already checked the base version.
 */
export function resolveConsoleReleaseChannel({ ref, tag }) {
  consoleReleaseVersion({ ref, tag });
  return refShape(ref).channel;
}

/**
 * After the rewrite, the packed version must be the tag's version.
 *
 * The rewrite sets every package to the tag's version; this proves it landed. It compares
 * against the tag's own version, never the base version the packages carried before the
 * rewrite, and never a version with a second `-cvu.N` suffix appended.
 */
export function assertPackedVersionMatchesTag({ tag, version }) {
  const expected = tag.replace(/^v/, "");
  if (version !== expected) {
    throw new Error(
      `The console release packs ${JSON.stringify(version)}, not the tag's version ${JSON.stringify(expected)}`,
    );
  }
}

if (isMainModule(import.meta.url)) {
  const [command, ...args] = process.argv.slice(2);
  const commands = {
    // The pre-build guard: repository, ref, tag shape and base version.
    guard: ([repository, ref, tag, baseVersion]) =>
      assertConsoleRelease({ repository, ref, tag, baseVersion }),
    // The version the packages are rewritten to, from the tag alone.
    version: ([ref, tag]) => process.stdout.write(`${consoleReleaseVersion({ ref, tag })}\n`),
    // After the rewrite: the packed version must be the tag's version.
    "packed-version": ([tag, version]) => assertPackedVersionMatchesTag({ tag, version }),
    // The channel the publish step creates the release in.
    channel: ([ref, tag]) =>
      process.stdout.write(`${resolveConsoleReleaseChannel({ ref, tag })}\n`),
  };
  try {
    const run = commands[command];
    if (!run) {
      throw new Error(
        `The console release channel takes one of ${Object.keys(commands).join(", ")}, not ${JSON.stringify(command)}`,
      );
    }
    run(args);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  }
}
