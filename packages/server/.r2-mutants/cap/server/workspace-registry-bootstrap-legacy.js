import { resolve } from "node:path";
import { parseGitRevParsePath } from "../utils/git-rev-parse-path.js";
import { createRealpathAwarePathMatcher, getRealpathAwareRelativePath } from "../utils/path.js";
import { deriveProjectKey, deriveProjectGroupingDisplayName } from "./project-key.js";
import { deriveProjectKind, deriveWorkspaceDisplayName, deriveWorkspaceKind, } from "./workspace-registry-model.js";
export function classifyDirectoryForProjectMembership(input) {
    const cwd = resolve(input.cwd);
    const checkout = { ...input.checkout, cwd };
    const projectKey = deriveProjectKey({
        rootPath: cwd,
        remoteUrl: checkout.remoteUrl,
        worktreeRoot: checkout.worktreeRoot,
        mainRepoRoot: checkout.mainRepoRoot,
        serverId: input.serverId,
    });
    const projectRootPath = deriveProjectRootPath({ cwd, checkout });
    return {
        cwd,
        checkout,
        workspaceDirectoryKey: deriveWorkspaceDirectoryKey(cwd, checkout),
        workspaceKind: deriveWorkspaceKind(checkout),
        workspaceDisplayName: deriveWorkspaceDisplayName({ cwd, checkout }),
        // Legacy registry bootstrap historically used the grouping identity as the
        // host-local project ID. Preserve that ID shape while keeping the new,
        // canonical cross-host identity in projectKey.
        projectId: projectKey.startsWith("remote:") ? projectKey : projectRootPath,
        projectKey,
        projectName: deriveProjectGroupingDisplayName({
            rootPath: cwd,
            remoteUrl: checkout.remoteUrl,
            worktreeRoot: checkout.worktreeRoot,
        }),
        projectRootPath,
        projectKind: deriveProjectKind(checkout),
    };
}
function deriveWorkspaceDirectoryKey(cwd, checkout) {
    const worktreeRoot = checkout.worktreeRoot ? parseGitRevParsePath(checkout.worktreeRoot) : null;
    const selectedRoot = resolve(cwd);
    return worktreeRoot && createRealpathAwarePathMatcher(worktreeRoot)(selectedRoot)
        ? worktreeRoot
        : selectedRoot;
}
function deriveProjectRootPath(input) {
    if (!input.checkout.isGit || !input.checkout.mainRepoRoot)
        return input.cwd;
    const worktreeRoot = input.checkout.worktreeRoot
        ? parseGitRevParsePath(input.checkout.worktreeRoot)
        : null;
    if (!worktreeRoot)
        return input.checkout.mainRepoRoot;
    const selectedPath = getRealpathAwareRelativePath(worktreeRoot, input.cwd);
    return selectedPath
        ? resolve(input.checkout.mainRepoRoot, selectedPath)
        : input.checkout.mainRepoRoot;
}
//# sourceMappingURL=workspace-registry-bootstrap-legacy.js.map