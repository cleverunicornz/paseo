import { execFileSync } from "node:child_process";
import { CONSOLE_REPOSITORY } from "./console-release-channel.mjs";
import { isMainModule } from "./is-main-module.mjs";

// Checkout fetches one commit without tags. Fetch only the requested tag from
// the same canonical repository that publishes/downloads the release. Neither
// origin, a branch with the same name, nor a cached local tag supplies identity.
export function resolvePublishedTag({ repository, tag, runCommit, cwd = process.cwd() }) {
  if (repository !== CONSOLE_REPOSITORY) {
    throw new Error(`The published tag must come from ${CONSOLE_REPOSITORY}`);
  }
  if (!/^v0\.11\.2-cvu\.[1-9][0-9]*$/.test(tag) || !/^[0-9a-f]{40}$/.test(runCommit)) {
    throw new Error("A console release tag and the run's full commit id are required");
  }
  const git = (...args) =>
    execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  const fetchedRef = "refs/console-qualification/published-tag";
  // An explicit refspec also refuses a missing remote tag even when a local
  // tag with that name exists. Force updates only this private scratch ref.
  git(
    "fetch",
    "--no-tags",
    "--no-recurse-submodules",
    "--depth=1",
    `https://github.com/${CONSOLE_REPOSITORY}`,
    `+refs/tags/${tag}:${fetchedRef}`,
  );
  const tagCommit = git("rev-parse", "--verify", `${fetchedRef}^{commit}`);
  if (tagCommit !== runCommit) {
    throw new Error(`The published tag's commit ${tagCommit} is not the qualified run's ${runCommit}`);
  }
  return tagCommit;
}

if (isMainModule(import.meta.url)) {
  try {
    const [repository, tag, runCommit] = process.argv.slice(2);
    console.log(resolvePublishedTag({ repository, tag, runCommit }));
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
