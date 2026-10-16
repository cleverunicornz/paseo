export class MissingCheckoutTargetError extends Error {
    constructor() {
        super('action "checkout" requires refName or checkoutSource');
        this.action = "checkout";
        this.name = "MissingCheckoutTargetError";
    }
}
export class UnsupportedForgeCheckoutTargetError extends Error {
    constructor(forge) {
        super(`Checkout from change request is not supported for ${forge} yet`);
        this.name = "UnsupportedForgeCheckoutTargetError";
        this.forge = forge;
    }
}
export class CheckoutSourceForgeMismatchError extends Error {
    constructor(params) {
        super(`Checkout source is for ${params.checkoutSourceForge}, but this workspace resolved to ${params.workspaceForge}`);
        this.name = "CheckoutSourceForgeMismatchError";
        this.checkoutSourceForge = params.checkoutSourceForge;
        this.workspaceForge = params.workspaceForge;
    }
}
export async function resolveWorktreeCreationIntent(input, repoRoot, deps) {
    if (input.action === "branch-off") {
        return {
            kind: "branch-off",
            baseBranch: input.refName?.trim() || (await resolveDefaultBranch(repoRoot, deps)),
            branchName: input.branchName ?? input.worktreeSlug ?? "worktree",
        };
    }
    if (input.action === "checkout") {
        const changeRequest = resolveInputChangeRequest(input);
        if (changeRequest) {
            assertCheckoutSourceMatchesResolvedForge(changeRequest, deps);
            return resolvePrCheckoutIntent({
                refName: input.refName,
                changeRequestNumber: changeRequest.number,
                repoRoot,
                deps,
            });
        }
        const branchName = input.refName?.trim();
        if (branchName) {
            return {
                kind: "checkout-branch",
                branchName,
            };
        }
        throw new MissingCheckoutTargetError();
    }
    const changeRequest = resolveInputChangeRequest(input);
    if (changeRequest) {
        assertCheckoutSourceMatchesResolvedForge(changeRequest, deps);
        return resolvePrCheckoutIntent({
            refName: input.refName,
            changeRequestNumber: changeRequest.number,
            repoRoot,
            deps,
        });
    }
    if (input.refName?.trim()) {
        return {
            kind: "branch-off",
            baseBranch: input.refName.trim(),
            branchName: input.branchName ?? input.worktreeSlug ?? "worktree",
        };
    }
    return {
        kind: "branch-off",
        baseBranch: await resolveDefaultBranch(repoRoot, deps),
        branchName: input.branchName ?? input.worktreeSlug ?? "worktree",
    };
}
function resolveInputChangeRequest(input) {
    if (input.checkoutSource) {
        return {
            number: input.checkoutSource.number,
            ...(input.checkoutSource.forge ? { forge: input.checkoutSource.forge } : {}),
            ...(input.checkoutSource.projectPath
                ? { projectPath: input.checkoutSource.projectPath }
                : {}),
        };
    }
    if (input.githubPrNumber !== undefined) {
        return { number: input.githubPrNumber };
    }
    return null;
}
function assertCheckoutSourceMatchesResolvedForge(source, deps) {
    if (source.forge && source.forge !== deps.forge) {
        throw new CheckoutSourceForgeMismatchError({
            checkoutSourceForge: source.forge,
            workspaceForge: deps.forge,
        });
    }
}
async function resolvePrCheckoutIntent(params) {
    const { deps } = params;
    const service = deps.forgeService;
    const checkoutTarget = await resolvePrCheckoutTarget(params);
    const headRef = await resolvePrHeadRef({
        refName: params.refName,
        changeRequestNumber: params.changeRequestNumber,
        checkoutTarget,
        repoRoot: params.repoRoot,
        deps,
    });
    const canCrossRepo = hasCheckoutRefs(checkoutTarget) || service.supportsCrossRepoCheckoutWithoutRefs === true;
    if (checkoutTarget.isCrossRepository && !canCrossRepo) {
        throw new UnsupportedForgeCheckoutTargetError(deps.forge);
    }
    const baseRefName = checkoutTarget.baseRefName.trim() || (await resolveDefaultBranch(params.repoRoot, deps));
    const defaultRefs = service.defaultCheckoutRefs?.({
        changeRequestNumber: params.changeRequestNumber,
        headRef,
    }) ?? [{ remoteName: "origin", remoteRef: `refs/heads/${headRef}` }];
    const localBranchName = service.buildPrLocalBranchName?.({ headRef, checkoutTarget });
    const crossRepository = resolveCrossRepositoryFields(checkoutTarget);
    const trackOriginHead = !checkoutTarget.isCrossRepository;
    return {
        kind: "checkout-change-request",
        forge: deps.forge,
        changeRequestNumber: params.changeRequestNumber,
        headRef,
        ...crossRepository,
        baseRefName,
        checkoutRefs: checkoutTarget.checkoutRefs ?? defaultRefs,
        ...(localBranchName && localBranchName !== headRef ? { localBranchName } : {}),
        ...(trackOriginHead ? { trackOriginHead } : {}),
    };
}
function resolveCrossRepositoryFields(target) {
    if (!target.isCrossRepository)
        return {};
    const headRepositoryOwner = target.headOwnerLogin?.trim() || undefined;
    const headRepository = resolveHeadRepository(target);
    const pushRemoteUrl = target.headRepositorySshUrl || target.headRepositoryUrl || undefined;
    return {
        ...(headRepositoryOwner ? { headRepositoryOwner } : {}),
        ...(headRepository ? { headRepository } : {}),
        ...(pushRemoteUrl ? { pushRemoteUrl } : {}),
    };
}
function resolveHeadRepository(target) {
    const url = target.headRepositoryUrl ?? target.headRepositorySshUrl;
    if (!url)
        return target.headOwnerLogin?.trim() || "unknown repository";
    const path = url
        .replace(/\.git$/, "")
        .split(/[/:]/)
        .filter(Boolean);
    const repository = path.at(-1);
    const owner = target.headOwnerLogin?.trim() || path.at(-2);
    return (owner && repository ? `${owner}/${repository}` : repository) ?? "unknown repository";
}
function hasCheckoutRefs(target) {
    return Array.isArray(target.checkoutRefs) && target.checkoutRefs.length > 0;
}
async function resolvePrCheckoutTarget(params) {
    return params.deps.forgeService.getPullRequestCheckoutTarget({
        cwd: params.repoRoot,
        number: params.changeRequestNumber,
    });
}
async function resolveDefaultBranch(repoRoot, deps) {
    const baseBranch = await deps.resolveDefaultBranch(repoRoot);
    if (!baseBranch) {
        throw new Error("Unable to resolve repository default branch");
    }
    return baseBranch;
}
async function resolvePrHeadRef(params) {
    const trimmedRefName = params.refName?.trim();
    if (trimmedRefName) {
        return trimmedRefName;
    }
    const checkoutTargetHeadRef = params.checkoutTarget.headRefName.trim();
    if (checkoutTargetHeadRef) {
        return checkoutTargetHeadRef;
    }
    return params.deps.forgeService.getPullRequestHeadRef({
        cwd: params.repoRoot,
        number: params.changeRequestNumber,
    });
}
//# sourceMappingURL=resolve-worktree-creation-intent.js.map