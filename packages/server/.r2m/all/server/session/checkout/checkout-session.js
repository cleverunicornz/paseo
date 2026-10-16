import { isAbsolute } from "node:path";
import { getErrorMessage } from "@getpaseo/protocol/error-utils";
import { getForgeDefinitionOrNeutral } from "@getpaseo/protocol/forge-manifest";
import { validateBranchSlug } from "@getpaseo/protocol/branch-slug";
import { toCheckoutError } from "../../checkout-git-utils.js";
import { buildCheckoutPrStatusPayloadFromSnapshot, buildCheckoutStatusPayloadFromSnapshot, } from "../../checkout/status-projection.js";
import { assertSafeGitRef } from "../../worktree-session.js";
import { commitChanges, createPullRequest, discardChanges, forgeAuthStateFromError, isForgeAuthError, mergeFromBase, mergeToBase, pullCurrentBranch, pushCurrentBranch, listCheckoutCommits, getCommitFileDiff, } from "../../../utils/checkout-git.js";
import { runGitCommand } from "../../../utils/run-git-command.js";
import { expandTilde } from "../../../utils/path.js";
class NoResolvedForgeServiceError extends Error {
    constructor(cwd) {
        super(`No supported forge remote is configured for ${cwd}`);
        this.authState = "no_remote";
        this.name = "NoResolvedForgeServiceError";
    }
}
function toLegacyGithubSearchItems(items) {
    return items.map((item) => {
        if (item.kind === "change_request") {
            return { ...item, kind: "pr" };
        }
        return { ...item, kind: "issue" };
    });
}
/**
 * A client's checkout view, both sides: the read & live-stream side (status
 * queries, branch validation/suggestions, manual refresh, live git-diff and
 * checkout-status subscriptions) and the command side (switch/rename/commit/
 * merge/pull/push/stash and the GitHub-PR operations).
 *
 * Command operations keep the live diff in sync by calling scheduleDiffRefresh()
 * and refresh the workspace git snapshot through gitMutation.notifyGitMutation(); the
 * workspace git observer streams branch changes through emitStatusUpdate().
 */
export class CheckoutSession {
    constructor(options) {
        this.statusUpdateFingerprints = new Map();
        this.host = options.host;
        this.gitMutation = options.gitMutation;
        this.workspaceGitService = options.workspaceGitService;
        this.github = options.github;
        this.checkoutDiffManager = options.checkoutDiffManager;
        this.gitMetadataGenerator = options.gitMetadataGenerator;
        this.paseoHome = options.paseoHome;
        this.worktreesRoot = options.worktreesRoot;
        this.logger = options.logger;
    }
    async resolveForgeService(cwd) {
        const resolution = await this.workspaceGitService.resolveForge(cwd);
        if (!resolution) {
            return null;
        }
        return { forge: resolution.forge, service: resolution.service };
    }
    async requireForgeService(cwd) {
        const resolution = await this.resolveForgeService(cwd);
        if (!resolution) {
            throw new NoResolvedForgeServiceError(cwd);
        }
        return resolution;
    }
    async resolveForgeIdForError(cwd) {
        try {
            return (await this.workspaceGitService.resolveForge(cwd))?.forge ?? "github";
        }
        catch {
            return "github";
        }
    }
    async resolveAuthStateForError(cwd, error) {
        if (error instanceof NoResolvedForgeServiceError) {
            return error.authState;
        }
        try {
            return (await this.workspaceGitService.resolveForge(cwd)) ? "error" : "no_remote";
        }
        catch {
            return "error";
        }
    }
    /**
     * Combines resolveForgeIdForError + resolveAuthStateForError into a single
     * resolveForge(cwd) call for the (common) case where the failure isn't a
     * NoResolvedForgeServiceError — both helpers otherwise resolve the same cwd
     * independently in the same error path.
     */
    async resolveForgeContextForError(cwd, error) {
        if (error instanceof NoResolvedForgeServiceError) {
            return { forge: await this.resolveForgeIdForError(cwd), authState: error.authState };
        }
        try {
            const resolution = await this.workspaceGitService.resolveForge(cwd);
            return {
                forge: resolution?.forge ?? "github",
                authState: resolution ? "error" : "no_remote",
            };
        }
        catch {
            return { forge: "github", authState: "error" };
        }
    }
    async handleStatusRequest(msg) {
        const { cwd, requestId } = msg;
        const resolvedCwd = expandTilde(cwd);
        try {
            const snapshot = await this.workspaceGitService.getSnapshot(resolvedCwd);
            this.host.emit({
                type: "checkout_status_response",
                payload: buildCheckoutStatusPayloadFromSnapshot({
                    cwd,
                    requestId,
                    snapshot,
                }),
            });
        }
        catch (error) {
            this.host.emit({
                type: "checkout_status_response",
                payload: {
                    cwd,
                    isGit: false,
                    repoRoot: null,
                    currentBranch: null,
                    isDirty: null,
                    baseRef: null,
                    aheadBehind: null,
                    aheadOfOrigin: null,
                    behindOfOrigin: null,
                    hasRemote: false,
                    remoteUrl: null,
                    isPaseoOwnedWorktree: false,
                    error: toCheckoutError(error),
                    requestId,
                },
            });
        }
    }
    async handleCommitsListRequest(msg) {
        const { cwd, requestId } = msg;
        try {
            const { baseRef, commits } = await listCheckoutCommits({
                cwd: expandTilde(cwd),
                context: { paseoHome: this.paseoHome, worktreesRoot: this.worktreesRoot },
            });
            this.host.emit({
                type: "checkout.commits.list.response",
                payload: { cwd, baseRef, commits, error: null, requestId },
            });
        }
        catch (error) {
            this.host.emit({
                type: "checkout.commits.list.response",
                payload: { cwd, baseRef: null, commits: [], error: toCheckoutError(error), requestId },
            });
        }
    }
    async handleCommitFileDiffRequest(msg) {
        const { cwd, sha, path, requestId } = msg;
        try {
            assertSafeGitRef(sha, "commit");
            if (path.length === 0 || isAbsolute(path) || path.split(/[\\/]/).includes("..")) {
                throw new Error(`Invalid path: ${path}`);
            }
            const file = await getCommitFileDiff({ cwd: expandTilde(cwd), sha, path });
            this.host.emit({
                type: "checkout.commits.file_diff.response",
                payload: { cwd, sha, path, file, error: null, requestId },
            });
        }
        catch (error) {
            this.host.emit({
                type: "checkout.commits.file_diff.response",
                payload: { cwd, sha, path, file: null, error: toCheckoutError(error), requestId },
            });
        }
    }
    async handleValidateBranchRequest(msg) {
        const { cwd, branchName, requestId } = msg;
        try {
            const resolvedCwd = expandTilde(cwd);
            assertSafeGitRef(branchName, "branch");
            const resolution = await this.workspaceGitService.validateBranchRef(resolvedCwd, branchName);
            switch (resolution.kind) {
                case "local":
                    this.host.emit({
                        type: "validate_branch_response",
                        payload: {
                            exists: true,
                            resolvedRef: resolution.name,
                            isRemote: false,
                            error: null,
                            requestId,
                        },
                    });
                    return;
                case "remote-only":
                    this.host.emit({
                        type: "validate_branch_response",
                        payload: {
                            exists: true,
                            resolvedRef: resolution.remoteRef,
                            isRemote: true,
                            error: null,
                            requestId,
                        },
                    });
                    return;
                case "not-found":
                    this.host.emit({
                        type: "validate_branch_response",
                        payload: {
                            exists: false,
                            resolvedRef: null,
                            isRemote: false,
                            error: null,
                            requestId,
                        },
                    });
                    return;
                default: {
                    const exhaustiveCheck = resolution;
                    throw new Error(`Unhandled branch resolution: ${getErrorMessage(exhaustiveCheck)}`);
                }
            }
        }
        catch (error) {
            this.host.emit({
                type: "validate_branch_response",
                payload: {
                    exists: false,
                    resolvedRef: null,
                    isRemote: false,
                    error: error instanceof Error ? error.message : String(error),
                    requestId,
                },
            });
        }
    }
    async handleBranchSuggestionsRequest(msg) {
        const { cwd, query, limit, requestId } = msg;
        try {
            const resolvedCwd = expandTilde(cwd);
            const branchDetails = await this.workspaceGitService.suggestBranchesForCwd(resolvedCwd, {
                query,
                limit,
            });
            this.host.emit({
                type: "branch_suggestions_response",
                payload: {
                    branches: branchDetails.map((branch) => branch.name),
                    branchDetails,
                    error: null,
                    requestId,
                },
            });
        }
        catch (error) {
            this.host.emit({
                type: "branch_suggestions_response",
                payload: {
                    branches: [],
                    branchDetails: [],
                    error: error instanceof Error ? error.message : String(error),
                    requestId,
                },
            });
        }
    }
    async handleReadDiffRequest(msg) {
        const snapshot = await this.checkoutDiffManager.read({
            cwd: expandTilde(msg.cwd),
            compare: msg.compare,
        });
        this.host.emit({
            type: "checkout.diff.get.response",
            payload: { ...snapshot, requestId: msg.requestId },
        });
    }
    async handleSubscribeDiffRequest(msg, ownership) {
        let bootstrap;
        const owner = ownership.begin("diffs", msg.subscriptionId, async () => {
            await bootstrap?.then((subscription) => subscription.unsubscribe(), () => undefined);
        }, `diff:${msg.subscriptionId}`);
        let ready = false;
        let pending = null;
        const emitSnapshot = (snapshot) => owner.emit({
            type: "checkout_diff_update",
            payload: { ...snapshot, subscriptionId: owner.responseId },
        });
        try {
            bootstrap = this.checkoutDiffManager.subscribe({ cwd: expandTilde(msg.cwd), compare: msg.compare, signal: owner.signal }, (snapshot) => {
                if (owner.signal.aborted)
                    return;
                if (ready)
                    emitSnapshot(snapshot);
                else
                    pending = snapshot;
            });
            const subscription = await bootstrap;
            if (owner.signal.aborted) {
                subscription.unsubscribe();
                return;
            }
            this.host.emit({
                type: "subscribe_checkout_diff_response",
                payload: {
                    ...subscription.initial,
                    subscriptionId: owner.responseId,
                    requestId: msg.requestId,
                },
            });
            ready = true;
            if (pending)
                emitSnapshot(pending);
        }
        catch (error) {
            await owner.release();
            throw error;
        }
    }
    async handleUnsubscribeDiffRequest(msg, ownership) {
        await ownership.release(msg.subscriptionId);
    }
    async handleRefreshRequest(msg) {
        const { cwd, requestId } = msg;
        const resolvedCwd = expandTilde(cwd);
        try {
            (await this.resolveForgeService(resolvedCwd))?.service.invalidate({ cwd: resolvedCwd });
            await this.workspaceGitService.getSnapshot(resolvedCwd, {
                force: true,
                includeForge: true,
                reason: "manual-refresh",
            });
            this.checkoutDiffManager.scheduleRefreshForCwd(resolvedCwd);
            this.host.emit({
                type: "checkout.refresh.response",
                payload: {
                    cwd,
                    success: true,
                    error: null,
                    requestId,
                },
            });
        }
        catch (error) {
            this.host.emit({
                type: "checkout.refresh.response",
                payload: {
                    cwd,
                    success: false,
                    error: toCheckoutError(error),
                    requestId,
                },
            });
        }
    }
    emitStatusUpdate(cwd, snapshot) {
        try {
            const requestId = `subscription:${cwd}`;
            const payload = {
                ...buildCheckoutStatusPayloadFromSnapshot({
                    cwd,
                    requestId,
                    snapshot,
                }),
                prStatus: buildCheckoutPrStatusPayloadFromSnapshot({
                    cwd,
                    requestId,
                    snapshot,
                }),
            };
            const fingerprint = JSON.stringify(payload);
            if (this.statusUpdateFingerprints.get(cwd) === fingerprint)
                return;
            this.statusUpdateFingerprints.set(cwd, fingerprint);
            this.host.emit({
                type: "checkout_status_update",
                payload,
            });
        }
        catch (error) {
            this.logger.warn({ err: error, cwd }, "Failed to emit workspace checkout status update");
        }
    }
    /**
     * Notify the live diff subscriptions that the working tree at `cwd` changed.
     * Called by the command handlers below after they mutate the repository.
     */
    scheduleDiffRefresh(cwd) {
        this.checkoutDiffManager.scheduleRefreshForCwd(cwd);
    }
    // ---------------------------------------------------------------------------
    // Command operations (writes) and GitHub-PR operations
    // ---------------------------------------------------------------------------
    async handleCheckoutSwitchBranchRequest(msg) {
        const { cwd, branch, requestId } = msg;
        try {
            const checkoutResult = await this.gitMutation.checkoutExistingBranch(cwd, branch);
            this.scheduleDiffRefresh(cwd);
            // Push a workspace_update immediately so the sidebar/header reflect
            // the new branch name without waiting for the background git watcher.
            await this.host.emitWorkspaceUpdateForCwd(cwd);
            this.host.emit({
                type: "checkout_switch_branch_response",
                payload: {
                    cwd,
                    success: true,
                    branch,
                    source: checkoutResult.source,
                    error: null,
                    requestId,
                },
            });
        }
        catch (error) {
            this.host.emit({
                type: "checkout_switch_branch_response",
                payload: {
                    cwd,
                    success: false,
                    branch,
                    error: toCheckoutError(error),
                    requestId,
                },
            });
        }
    }
    async handleCheckoutRenameBranchRequest(msg) {
        const { cwd, branch, requestId } = msg;
        const validation = validateBranchSlug(branch);
        if (!validation.valid) {
            this.host.emit({
                type: "checkout.rename_branch.response",
                payload: {
                    cwd,
                    success: false,
                    currentBranch: null,
                    error: toCheckoutError(new Error(validation.error ?? "Invalid branch name")),
                    requestId,
                },
            });
            return;
        }
        try {
            const result = await this.host.renameCurrentBranch(cwd, branch);
            await this.gitMutation.notifyGitMutation(cwd, "rename-branch", { invalidateForge: true });
            this.scheduleDiffRefresh(cwd);
            this.host.handleWorkspaceGitBranchSnapshot(cwd, result.currentBranch);
            // Branch is a git fact derived per-descriptor from each workspace's own
            // live git snapshot (id → cwd); the reconciliation pass re-persists the
            // `branch` field per workspace from its own cwd. No cwd → ids fan-out here.
            // Push a workspace_update immediately so the sidebar/header reflect
            // the new branch name without waiting for the background git watcher.
            await this.host.emitWorkspaceUpdateForCwd(cwd);
            this.host.emit({
                type: "checkout.rename_branch.response",
                payload: {
                    cwd,
                    success: true,
                    currentBranch: result.currentBranch,
                    error: null,
                    requestId,
                },
            });
        }
        catch (error) {
            this.host.emit({
                type: "checkout.rename_branch.response",
                payload: {
                    cwd,
                    success: false,
                    currentBranch: null,
                    error: toCheckoutError(error),
                    requestId,
                },
            });
        }
    }
    async handleCheckoutDiscardChangesRequest(msg) {
        const { cwd, paths, requestId } = msg;
        try {
            await discardChanges(cwd, paths);
            await this.gitMutation.notifyGitMutation(cwd, "discard-changes");
            this.scheduleDiffRefresh(cwd);
            this.host.emit({
                type: "checkout.discard_changes.response",
                payload: { cwd, success: true, error: null, requestId },
            });
        }
        catch (error) {
            this.host.emit({
                type: "checkout.discard_changes.response",
                payload: { cwd, success: false, error: toCheckoutError(error), requestId },
            });
        }
    }
    async handleStashSaveRequest(msg) {
        const { cwd, requestId } = msg;
        try {
            const branchLabel = msg.branch?.trim() ?? "";
            const message = branchLabel
                ? `${CheckoutSession.PASEO_STASH_PREFIX} ${branchLabel}`
                : `${CheckoutSession.PASEO_STASH_PREFIX} unnamed`;
            await runGitCommand(["stash", "push", "--include-untracked", "-m", message], {
                cwd,
                timeout: 120000,
            });
            await this.gitMutation.notifyGitMutation(cwd, "stash-push");
            this.scheduleDiffRefresh(cwd);
            this.host.emit({
                type: "stash_save_response",
                payload: { cwd, success: true, error: null, requestId },
            });
        }
        catch (error) {
            this.host.emit({
                type: "stash_save_response",
                payload: { cwd, success: false, error: toCheckoutError(error), requestId },
            });
        }
    }
    async handleStashPopRequest(msg) {
        const { cwd, stashIndex, requestId } = msg;
        try {
            await runGitCommand(["stash", "pop", `stash@{${stashIndex}}`], {
                cwd,
                timeout: 120000,
            });
            await this.gitMutation.notifyGitMutation(cwd, "stash-pop");
            this.scheduleDiffRefresh(cwd);
            this.host.emit({
                type: "stash_pop_response",
                payload: { cwd, success: true, error: null, requestId },
            });
        }
        catch (error) {
            this.host.emit({
                type: "stash_pop_response",
                payload: { cwd, success: false, error: toCheckoutError(error), requestId },
            });
        }
    }
    async handleStashListRequest(msg) {
        const { cwd, requestId } = msg;
        const paseoOnly = msg.paseoOnly !== false;
        try {
            const entries = await this.workspaceGitService.listStashes(cwd, { paseoOnly });
            this.host.emit({
                type: "stash_list_response",
                payload: { cwd, entries, error: null, requestId },
            });
        }
        catch (error) {
            this.host.emit({
                type: "stash_list_response",
                payload: { cwd, entries: [], error: toCheckoutError(error), requestId },
            });
        }
    }
    async handleCheckoutCommitRequest(msg) {
        const { cwd, requestId } = msg;
        try {
            let message = msg.message?.trim() ?? "";
            if (!message) {
                message = await this.gitMetadataGenerator.generateCommitMessage(cwd);
            }
            if (!message) {
                throw new Error("Commit message is required");
            }
            await commitChanges(cwd, {
                message,
                addAll: msg.addAll ?? true,
            });
            await this.gitMutation.notifyGitMutation(cwd, "commit-changes");
            this.scheduleDiffRefresh(cwd);
            this.host.emit({
                type: "checkout_commit_response",
                payload: {
                    cwd,
                    success: true,
                    error: null,
                    requestId,
                },
            });
        }
        catch (error) {
            this.host.emit({
                type: "checkout_commit_response",
                payload: {
                    cwd,
                    success: false,
                    error: toCheckoutError(error),
                    requestId,
                },
            });
        }
    }
    async handleCheckoutMergeRequest(msg) {
        const { cwd, requestId } = msg;
        try {
            const snapshot = await this.workspaceGitService.getSnapshot(cwd);
            if (!snapshot.git.isGit) {
                throw new Error(`Not a git repository: ${cwd}`);
            }
            if (msg.requireCleanTarget) {
                if (snapshot.git.isDirty) {
                    throw new Error("Working directory has uncommitted changes.");
                }
            }
            let baseRef = msg.baseRef ?? snapshot.git.baseRef;
            if (!baseRef) {
                throw new Error("Base branch is required for merge");
            }
            if (baseRef.startsWith("origin/")) {
                baseRef = baseRef.slice("origin/".length);
            }
            const mutatedCwd = await mergeToBase(cwd, {
                baseRef,
                mode: msg.strategy === "squash" ? "squash" : "merge",
            }, { paseoHome: this.paseoHome, worktreesRoot: this.worktreesRoot });
            await Promise.all([
                this.gitMutation.notifyGitMutation(mutatedCwd, "merge-to-base", { invalidateForge: true }),
                ...(mutatedCwd !== cwd ? [this.gitMutation.notifyGitMutation(cwd, "merge-to-base")] : []),
            ]);
            this.scheduleDiffRefresh(cwd);
            this.host.emit({
                type: "checkout_merge_response",
                payload: {
                    cwd,
                    success: true,
                    error: null,
                    requestId,
                },
            });
        }
        catch (error) {
            this.host.emit({
                type: "checkout_merge_response",
                payload: {
                    cwd,
                    success: false,
                    error: toCheckoutError(error),
                    requestId,
                },
            });
        }
    }
    async handleCheckoutMergeFromBaseRequest(msg) {
        const { cwd, requestId } = msg;
        try {
            if (msg.requireCleanTarget ?? true) {
                const snapshot = await this.workspaceGitService.getSnapshot(cwd);
                if (snapshot.git.isDirty) {
                    throw new Error("Working directory has uncommitted changes.");
                }
            }
            await mergeFromBase(cwd, {
                baseRef: msg.baseRef,
                requireCleanTarget: msg.requireCleanTarget ?? true,
            }, { paseoHome: this.paseoHome, worktreesRoot: this.worktreesRoot });
            await this.gitMutation.notifyGitMutation(cwd, "merge-from-base", { invalidateForge: true });
            this.scheduleDiffRefresh(cwd);
            this.host.emit({
                type: "checkout_merge_from_base_response",
                payload: {
                    cwd,
                    success: true,
                    error: null,
                    requestId,
                },
            });
        }
        catch (error) {
            this.host.emit({
                type: "checkout_merge_from_base_response",
                payload: {
                    cwd,
                    success: false,
                    error: toCheckoutError(error),
                    requestId,
                },
            });
        }
    }
    async handleCheckoutPullRequest(msg) {
        const { cwd, requestId } = msg;
        try {
            await pullCurrentBranch(cwd);
            await this.gitMutation.notifyGitMutation(cwd, "pull", { invalidateForge: true });
            this.scheduleDiffRefresh(cwd);
            this.host.emit({
                type: "checkout_pull_response",
                payload: {
                    cwd,
                    success: true,
                    error: null,
                    requestId,
                },
            });
        }
        catch (error) {
            this.host.emit({
                type: "checkout_pull_response",
                payload: {
                    cwd,
                    success: false,
                    error: toCheckoutError(error),
                    requestId,
                },
            });
        }
    }
    async handleCheckoutPushRequest(msg) {
        const { cwd, requestId } = msg;
        try {
            await pushCurrentBranch(cwd);
            await this.gitMutation.notifyGitMutation(cwd, "push", { invalidateForge: true });
            this.host.emit({
                type: "checkout_push_response",
                payload: {
                    cwd,
                    success: true,
                    error: null,
                    requestId,
                },
            });
        }
        catch (error) {
            this.host.emit({
                type: "checkout_push_response",
                payload: {
                    cwd,
                    success: false,
                    error: toCheckoutError(error),
                    requestId,
                },
            });
        }
    }
    async handleCheckoutPrCreateRequest(msg) {
        const { cwd, requestId } = msg;
        try {
            let title = msg.title?.trim() ?? "";
            let body = msg.body?.trim() ?? "";
            if (!title || !body) {
                const generated = await this.gitMetadataGenerator.generatePullRequestText(cwd, msg.baseRef);
                if (!title)
                    title = generated.title;
                if (!body)
                    body = generated.body;
            }
            const { service } = await this.requireForgeService(cwd);
            const result = await createPullRequest(cwd, {
                title,
                body,
                base: msg.baseRef,
            }, service, { paseoHome: this.paseoHome, worktreesRoot: this.worktreesRoot });
            await this.gitMutation.notifyGitMutation(cwd, "create-pr", { invalidateForge: true });
            this.host.emit({
                type: "checkout_pr_create_response",
                payload: {
                    cwd,
                    url: result.url ?? null,
                    number: result.number ?? null,
                    error: null,
                    requestId,
                },
            });
        }
        catch (error) {
            this.host.emit({
                type: "checkout_pr_create_response",
                payload: {
                    cwd,
                    url: null,
                    number: null,
                    error: toCheckoutError(error),
                    requestId,
                },
            });
        }
    }
    async handleCheckoutPrMergeRequest(msg) {
        const { cwd, requestId } = msg;
        try {
            const pullRequest = await this.resolveCurrentPullRequest(cwd, "merge", {
                force: true,
                includeForge: true,
                reason: "merge-pr-validation",
            });
            const { service } = await this.requireForgeService(cwd);
            await service.mergePullRequest({
                cwd,
                prNumber: pullRequest.number,
                mergeMethod: msg.mergeMethod,
                status: pullRequest,
            });
            await this.gitMutation.notifyGitMutation(cwd, "merge-pr", { invalidateForge: true });
            this.host.emit({
                type: "checkout_pr_merge_response",
                payload: {
                    cwd,
                    success: true,
                    error: null,
                    requestId,
                },
            });
        }
        catch (error) {
            this.host.emit({
                type: "checkout_pr_merge_response",
                payload: {
                    cwd,
                    success: false,
                    error: toCheckoutError(error),
                    requestId,
                },
            });
        }
    }
    async handleCheckoutForgeSetAutoMergeRequest(msg) {
        const { cwd, requestId } = msg;
        const responseType = msg.type === "checkout.forge.set_auto_merge.request"
            ? "checkout.forge.set_auto_merge.response"
            : "checkout.github.set_auto_merge.response";
        try {
            const pullRequest = await this.resolveCurrentPullRequest(cwd, "auto-merge", {
                force: true,
                includeForge: true,
                reason: "auto-merge-validation",
            });
            const { service } = await this.requireForgeService(cwd);
            if (msg.enabled) {
                const mergeMethod = msg.mergeMethod;
                if (!mergeMethod) {
                    throw new Error("mergeMethod is required when enabling auto-merge");
                }
                await service.enablePullRequestAutoMerge({
                    cwd,
                    prNumber: pullRequest.number,
                    mergeMethod,
                    status: pullRequest,
                });
            }
            else {
                if (msg.mergeMethod) {
                    throw new Error("mergeMethod is not allowed when disabling auto-merge");
                }
                await service.disablePullRequestAutoMerge({
                    cwd,
                    prNumber: pullRequest.number,
                    status: pullRequest,
                });
            }
            await this.gitMutation.notifyGitMutation(cwd, msg.enabled ? "enable-pr-auto-merge" : "disable-pr-auto-merge", {
                invalidateForge: true,
            });
            this.host.emit({
                type: responseType,
                payload: {
                    cwd,
                    enabled: msg.enabled,
                    success: true,
                    error: null,
                    requestId,
                },
            });
        }
        catch (error) {
            this.host.emit({
                type: responseType,
                payload: {
                    cwd,
                    enabled: msg.enabled,
                    success: false,
                    error: toCheckoutError(error),
                    requestId,
                },
            });
        }
    }
    async resolveCurrentPullRequest(cwd, operation, options) {
        const snapshot = await this.workspaceGitService.getSnapshot(cwd, options);
        const pullRequest = snapshot.forge.pullRequest;
        if (!pullRequest || typeof pullRequest.number !== "number") {
            throw new Error(`Unable to determine current change request number for ${operation}`);
        }
        return { ...pullRequest, number: pullRequest.number };
    }
    async handleCheckoutPrStatusRequest(msg) {
        const { cwd, requestId } = msg;
        try {
            const snapshot = await this.workspaceGitService.getSnapshot(cwd);
            this.host.emit({
                type: "checkout_pr_status_response",
                payload: buildCheckoutPrStatusPayloadFromSnapshot({
                    cwd,
                    requestId,
                    snapshot,
                }),
            });
        }
        catch (error) {
            const { forge, authState } = await this.resolveForgeContextForError(cwd, error);
            this.host.emit({
                type: "checkout_pr_status_response",
                payload: {
                    cwd,
                    status: null,
                    githubFeaturesEnabled: authState === "authenticated" || authState === "error",
                    authState,
                    forge,
                    error: toCheckoutError(error),
                    requestId,
                },
            });
        }
    }
    async handlePullRequestTimelineRequest(msg) {
        const { cwd, prNumber, repoOwner, repoName, requestId } = msg;
        if (!isValidPullRequestTimelineIdentity({ prNumber, repoOwner, repoName })) {
            this.host.emit({
                type: "pull_request_timeline_response",
                payload: {
                    cwd,
                    prNumber,
                    items: [],
                    truncated: false,
                    error: {
                        kind: "unknown",
                        message: "Pull request timeline request has invalid PR identity",
                    },
                    requestId,
                    githubFeaturesEnabled: true,
                },
            });
            return;
        }
        const resolvedForge = await this.resolveForgeService(cwd);
        if (!resolvedForge) {
            this.host.emit({
                type: "pull_request_timeline_response",
                payload: {
                    cwd,
                    prNumber,
                    items: [],
                    truncated: false,
                    error: {
                        kind: "unknown",
                        message: "No supported forge remote is configured for this workspace",
                    },
                    requestId,
                    githubFeaturesEnabled: false,
                    authState: "no_remote",
                },
            });
            return;
        }
        const { forge, service } = resolvedForge;
        // A throwing auth probe (authProbeCanThrow) yields the precise kind; a
        // false return can't distinguish cli_missing from unauthenticated, so
        // authState is omitted rather than guessed.
        let featuresEnabled;
        let probeAuthState;
        try {
            featuresEnabled = await service.isAuthenticated({ cwd });
        }
        catch (error) {
            featuresEnabled = false;
            probeAuthState = forgeAuthStateFromError(error);
        }
        if (!featuresEnabled) {
            this.host.emit({
                type: "pull_request_timeline_response",
                payload: {
                    cwd,
                    prNumber,
                    items: [],
                    truncated: false,
                    error: {
                        kind: "unknown",
                        message: `${getForgeDefinitionOrNeutral(forge).displayName} CLI is unavailable or not authenticated`,
                    },
                    requestId,
                    githubFeaturesEnabled: false,
                    ...(probeAuthState ? { authState: probeAuthState } : {}),
                },
            });
            return;
        }
        try {
            const timeline = await service.getPullRequestTimeline({
                cwd,
                prNumber,
                repoOwner,
                repoName,
            });
            this.host.emit({
                type: "pull_request_timeline_response",
                payload: {
                    cwd,
                    prNumber: timeline.prNumber,
                    items: timeline.items.map(toPullRequestTimelinePayloadItem),
                    truncated: timeline.truncated,
                    error: timeline.error,
                    requestId,
                    githubFeaturesEnabled: true,
                },
            });
        }
        catch (error) {
            this.host.emit({
                type: "pull_request_timeline_response",
                payload: {
                    cwd,
                    prNumber,
                    items: [],
                    truncated: false,
                    error: {
                        kind: "unknown",
                        message: error instanceof Error ? error.message : String(error),
                    },
                    requestId,
                    // A non-auth failure (timeout, API error) must keep reading as
                    // "features enabled" for old clients that only understand the
                    // boolean, or they render an auth blank instead of this error.
                    githubFeaturesEnabled: !isForgeAuthError(error),
                    authState: isForgeAuthError(error) ? forgeAuthStateFromError(error) : "error",
                },
            });
        }
    }
    async handleCheckoutForgeGetCheckDetailsRequest(msg) {
        const { cwd, repoOwner, repoName, checkRunId, workflowRunId, changeRequestNumber, requestId } = msg;
        const responseType = msg.type === "checkout.forge.get_check_details.request"
            ? "checkout.forge.get_check_details.response"
            : "checkout.github.get_check_details.response";
        try {
            // The payload schema keeps checkRunId and workflowRunId optional (a Gitea
            // Actions run has no check-run id; forge adapters may also route by
            // changeRequestNumber),
            // but a request that addresses no check at all is not actionable — reject
            // it here with a clear message instead of failing deep in an adapter. The
            // schema itself cannot enforce this: it is a discriminated-union member, so
            // a refine would turn it into a ZodEffects and break the union.
            if (checkRunId === undefined && workflowRunId === undefined) {
                throw new Error("Check details request must address a check by checkRunId or workflowRunId");
            }
            const { service } = await this.requireForgeService(cwd);
            const details = await service.getCheckDetails({
                cwd,
                repoOwner,
                repoName,
                checkRunId,
                workflowRunId,
                changeRequestNumber,
            });
            this.host.emit({
                type: responseType,
                payload: {
                    cwd,
                    success: true,
                    details,
                    error: null,
                    requestId,
                },
            });
        }
        catch (error) {
            this.host.emit({
                type: responseType,
                payload: {
                    cwd,
                    success: false,
                    details: null,
                    error: {
                        code: "UNKNOWN",
                        message: error instanceof Error ? error.message : String(error),
                    },
                    requestId,
                },
            });
        }
    }
    async handleForgeSearchRequest(msg) {
        const { cwd, query, limit, kinds, requestId } = msg;
        try {
            const resolvedCwd = expandTilde(cwd);
            // COMPAT(githubSearchRpc): the legacy github_search RPC is GitHub by
            // definition; forge.search.* shipped in v0.2.0-beta.1 and resolves the
            // cwd's forge. Remove after 2027-01-17 once the supported client floor
            // is >= v0.2.0.
            const resolvedForge = msg.type === "github_search_request"
                ? { forge: "github", service: this.github }
                : await this.resolveForgeService(resolvedCwd);
            if (!resolvedForge) {
                if (msg.type === "github_search_request") {
                    this.host.emit({
                        type: "github_search_response",
                        payload: {
                            items: [],
                            featuresEnabled: false,
                            authState: "no_remote",
                            githubFeaturesEnabled: false,
                            error: null,
                            requestId,
                        },
                    });
                    return;
                }
                this.host.emit({
                    type: "forge.search.response",
                    payload: {
                        items: [],
                        authState: "no_remote",
                        error: null,
                        requestId,
                    },
                });
                return;
            }
            const { forge, service } = resolvedForge;
            const result = await service.searchIssuesAndPrs({
                cwd: resolvedCwd,
                query,
                limit,
                kinds,
            });
            const items = result.items.map((item) => Object.assign({}, item, { forge: item.forge ?? forge }));
            if (msg.type === "github_search_request") {
                const featuresEnabled = result.featuresEnabled ?? result.githubFeaturesEnabled ?? true;
                const authState = result.authState ?? (featuresEnabled ? "authenticated" : "unauthenticated");
                this.host.emit({
                    type: "github_search_response",
                    payload: {
                        items: toLegacyGithubSearchItems(items),
                        featuresEnabled,
                        authState,
                        githubFeaturesEnabled: featuresEnabled,
                        error: null,
                        requestId,
                    },
                });
                return;
            }
            this.host.emit({
                type: "forge.search.response",
                payload: {
                    items,
                    authState: result.authState,
                    error: null,
                    requestId,
                },
            });
        }
        catch (error) {
            const resolvedCwd = expandTilde(cwd);
            const authState = await this.resolveAuthStateForError(resolvedCwd, error);
            if (msg.type === "github_search_request") {
                this.host.emit({
                    type: "github_search_response",
                    payload: {
                        items: [],
                        featuresEnabled: false,
                        authState,
                        githubFeaturesEnabled: false,
                        error: error instanceof Error ? error.message : String(error),
                        requestId,
                    },
                });
                return;
            }
            this.host.emit({
                type: "forge.search.response",
                payload: {
                    items: [],
                    authState,
                    error: error instanceof Error ? error.message : String(error),
                    requestId,
                },
            });
        }
    }
    cleanup() {
        this.statusUpdateFingerprints.clear();
    }
}
CheckoutSession.PASEO_STASH_PREFIX = "paseo-auto-stash:";
function isValidPullRequestTimelineIdentity(options) {
    if (!Number.isInteger(options.prNumber) || options.prNumber <= 0) {
        return false;
    }
    return isValidGitHubRepoSegment(options.repoOwner) && isValidGitHubRepoSegment(options.repoName);
}
function isValidGitHubRepoSegment(value) {
    return /^[A-Za-z0-9._-]+$/.test(value);
}
function toPullRequestTimelinePayloadItem(item) {
    return item;
}
//# sourceMappingURL=checkout-session.js.map