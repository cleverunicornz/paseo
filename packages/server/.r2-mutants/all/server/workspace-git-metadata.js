import { basename } from "path";
import { createHash } from "node:crypto";
import { parseGitHubRemoteUrl } from "@getpaseo/protocol/git-remote";
import { slugify } from "../utils/worktree.js";
export function parseGitHubRepoFromRemote(remoteUrl) {
    return parseGitHubRemoteUrl(remoteUrl)?.repo ?? null;
}
export function parseGitHubRepoNameFromRemote(remoteUrl) {
    const githubRepo = parseGitHubRepoFromRemote(remoteUrl);
    if (!githubRepo) {
        return null;
    }
    return githubRepo.split("/").pop() || null;
}
export function deriveProjectSlug(cwd, remoteUrl = null) {
    const githubRepoName = remoteUrl ? parseGitHubRepoNameFromRemote(remoteUrl) : null;
    const sourceName = githubRepoName ?? basename(cwd);
    return slugify(sourceName) || "untitled";
}
export function deriveProjectServiceSlug(project) {
    const identity = createHash("sha256").update(project.projectId).digest("hex").slice(0, 8);
    return `${deriveProjectSlug(project.rootPath)}-${identity}`;
}
//# sourceMappingURL=workspace-git-metadata.js.map