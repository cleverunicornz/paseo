import { isMainModule } from "./is-main-module.mjs";

// The console's release line (infra-v2 P-000269 H2): the daemon the console runs is
// upstream v0.11.2 with the fork's leak fix, released from this line alone.
export const CONSOLE_TRUNK_REF = "refs/heads/console/main";
export const CONSOLE_CANDIDATE_REF = "refs/heads/candidate/console-heap-0.11.2";

const COUNTER = "[1-9][0-9]*";

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Which kind of GitHub release the console line's CI publishes for a dispatched tag.
 *
 * The trunk `console/main` publishes a release, and only under `v<version>-cvu.N`.
 * The candidate lane `candidate/console-heap-0.11.2` publishes a prerelease, and only
 * under `v<version>-cvu.N-rc.M`. `<version>` is the packages' own version. Every other
 * ref, and every other tag shape, publishes nothing.
 */
export function resolveConsoleReleaseChannel({ ref, tag, version }) {
  if (ref === CONSOLE_TRUNK_REF) {
    const pattern = new RegExp(`^v${escapeRegExp(version)}-cvu\\.${COUNTER}$`);
    if (!pattern.test(tag)) {
      throw new Error(
        `The console trunk publishes v${version}-cvu.N (N from 1), not ${JSON.stringify(tag)}`,
      );
    }
    return "release";
  }

  if (ref === CONSOLE_CANDIDATE_REF) {
    const pattern = new RegExp(`^v${escapeRegExp(version)}-cvu\\.${COUNTER}-rc\\.${COUNTER}$`);
    if (!pattern.test(tag)) {
      throw new Error(
        `The console candidate lane publishes v${version}-cvu.N-rc.M (N and M from 1), not ${JSON.stringify(tag)}`,
      );
    }
    return "prerelease";
  }

  throw new Error(
    `The console release publishes only from console/main or candidate/console-heap-0.11.2, not ${ref}`,
  );
}

if (isMainModule(import.meta.url)) {
  const [ref, tag, version] = process.argv.slice(2);
  try {
    process.stdout.write(`${resolveConsoleReleaseChannel({ ref, tag, version })}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  }
}
