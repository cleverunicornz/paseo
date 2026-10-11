import { isMainModule } from "./is-main-module.mjs";

const COUNTER = "[1-9][0-9]*";

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Which kind of GitHub release internal-ci publishes for a dispatched tag.
 * internal/main publishes a release, as it always has. A candidate lane
 * (candidate/**) publishes a prerelease, and only under
 * `v<version>-cvu.N-rc.M`, where `<version>` is the packages' own version.
 * Every other ref publishes nothing.
 */
export function resolveInternalReleaseChannel({ ref, tag, version }) {
  if (ref === "refs/heads/internal/main") return "release";
  if (/^refs\/heads\/candidate\/.+/.test(ref)) {
    const pattern = new RegExp(`^v${escapeRegExp(version)}-cvu\\.${COUNTER}-rc\\.${COUNTER}$`);
    if (!pattern.test(tag)) {
      throw new Error(
        `A candidate prerelease tag must be v${version}-cvu.N-rc.M (N and M from 1), not ${JSON.stringify(tag)}`,
      );
    }
    return "prerelease";
  }
  throw new Error(`internal-ci publishes only from internal/main or candidate/**, not ${ref}`);
}

if (isMainModule(import.meta.url)) {
  const [ref, tag, version] = process.argv.slice(2);
  try {
    process.stdout.write(`${resolveInternalReleaseChannel({ ref, tag, version })}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  }
}
