import { createNameId } from "mnemonic-id";
import { createWorktree, slugify, validateBranchSlug, } from "../utils/worktree.js";
import { resolveWorktreeCreationIntent, UnsupportedForgeCheckoutTargetError, } from "./resolve-worktree-creation-intent.js";
import { runWithGitCommandPriority } from "../utils/run-git-command.js";
export async function createWorktreeCore(input, deps) {
    return runWithGitCommandPriority("high", () => createWorktreeCoreWithPriority(input, deps));
}
async function createWorktreeCoreWithPriority(input, deps) {
    const repoRoot = await resolveWorktreeRepoRoot(input, deps.workspaceGitService);
    const requestedWorktreeSlug = input.worktreeSlug
        ? normalizeWorktreeSlug(input.worktreeSlug)
        : undefined;
    const requestedBranchName = input.branchName?.trim();
    let intentInput;
    if (input.action === "checkout") {
        intentInput = {
            action: "checkout",
            refName: input.refName,
            checkoutSource: input.checkoutSource,
            githubPrNumber: input.githubPrNumber,
            worktreeSlug: requestedWorktreeSlug,
        };
    }
    else if (input.checkoutSource !== undefined || input.githubPrNumber !== undefined) {
        intentInput = {
            checkoutSource: input.checkoutSource,
            githubPrNumber: input.githubPrNumber,
            refName: input.refName,
            worktreeSlug: requestedWorktreeSlug,
        };
    }
    else {
        const worktreeSlug = requestedWorktreeSlug ?? normalizeWorktreeSlug(createNameId());
        intentInput = {
            action: "branch-off",
            refName: input.refName,
            branchName: requestedBranchName,
            worktreeSlug,
        };
    }
    const forge = await resolveForge(repoRoot, deps, intentInput);
    const intent = await resolveWorktreeCreationIntent(intentInput, repoRoot, {
        forge: forge.forge,
        forgeService: forge.service,
        resolveDefaultBranch: (root) => resolveDefaultBranch(root, deps),
    });
    let normalizedSlug;
    switch (intent.kind) {
        case "branch-off": {
            normalizedSlug = requestedWorktreeSlug ?? normalizeWorktreeSlug(intent.branchName);
            break;
        }
        case "checkout-branch": {
            normalizedSlug = requestedWorktreeSlug ?? normalizeWorktreeSlug(intent.branchName);
            break;
        }
        case "checkout-change-request":
        case "checkout-github-pr": {
            normalizedSlug =
                requestedWorktreeSlug ?? normalizeWorktreeSlug(intent.localBranchName ?? intent.headRef);
            break;
        }
    }
    return {
        worktree: await createWorktree({
            cwd: repoRoot,
            worktreeSlug: normalizedSlug,
            source: intent,
            runSetup: input.runSetup ?? true,
            paseoHome: input.paseoHome,
            worktreesRoot: input.worktreesRoot,
        }),
        intent,
        repoRoot,
        created: true,
    };
}
async function resolveForge(repoRoot, deps, intentInput) {
    const resolution = await deps.workspaceGitService?.resolveForge(repoRoot);
    if (!resolution) {
        if (intentInput.checkoutSource?.forge && intentInput.checkoutSource.forge !== "github") {
            throw new UnsupportedForgeCheckoutTargetError(intentInput.checkoutSource.forge);
        }
        // No recognized remote: fall back to GitHub, the wire-default forge.
        return { forge: "github", service: deps.github };
    }
    return { forge: resolution.forge, service: resolution.service };
}
async function resolveDefaultBranch(repoRoot, deps) {
    const baseBranch = deps.resolveDefaultBranch
        ? await deps.resolveDefaultBranch(repoRoot)
        : await deps.workspaceGitService?.resolveDefaultBranch(repoRoot);
    if (!baseBranch) {
        throw new Error("Unable to resolve repository default branch");
    }
    return baseBranch;
}
export async function resolveWorktreeRepoRoot(input, workspaceGitService) {
    if (!workspaceGitService) {
        throw new Error("Create worktree requires WorkspaceGitService");
    }
    return workspaceGitService.resolveRepoRoot(input.cwd);
}
function validateWorktreeSlug(slug) {
    const validation = validateBranchSlug(slug);
    if (!validation.valid) {
        throw new Error(`Invalid worktree name: ${validation.error}`);
    }
    return slug;
}
function normalizeWorktreeSlug(value) {
    return validateWorktreeSlug(slugify(value));
}
//# sourceMappingURL=worktree-core.js.map