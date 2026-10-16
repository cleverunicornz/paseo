import type pino from "pino";
import type { SessionDelivery } from "../owned-subscriptions/index.js";
import type { BranchSuggestionsRequest, CheckoutCommitsListRequest, CheckoutCommitFileDiffRequest, CheckoutRefreshRequest, CheckoutRenameBranchRequest, CheckoutStatusRequest, SessionInboundMessage, SessionOutboundMessage, SubscribeCheckoutDiffRequest, UnsubscribeCheckoutDiffRequest, ValidateBranchRequest } from "../../messages.js";
import type { CheckoutDiffSnapshotPayload, CheckoutDiffSubscription, CheckoutDiffSubscriptionRequest } from "../../checkout-diff-manager.js";
import type { WorkspaceGitRuntimeSnapshot, WorkspaceGitService } from "../../workspace-git-service.js";
import type { GitMutationService } from "../git-mutation/git-mutation-service.js";
import type { ForgeService } from "../../../services/forge-service.js";
import type { GitMetadataGenerator } from "./git-metadata-generator.js";
/**
 * The collaborators a checkout command reaches that are NOT part of the checkout
 * domain and stay owned by the Session shell: client emit, workspace-update
 * emission, the git branch-snapshot notifier, and the current-branch rename
 * primitive. CheckoutSession orchestrates them but does not own them. The
 * git-mutation primitives it performs (switch branch, force snapshot refresh) are
 * injected separately as `gitMutation`, since they are shared with worktree and
 * workspace creation.
 */
export interface CheckoutSessionHost {
    emit(msg: SessionOutboundMessage): void;
    emitWorkspaceUpdateForCwd(cwd: string): Promise<void>;
    handleWorkspaceGitBranchSnapshot(cwd: string, branchName: string | null): void;
    renameCurrentBranch(cwd: string, branch: string): Promise<{
        previousBranch: string | null;
        currentBranch: string | null;
    }>;
}
/**
 * The slice of CheckoutDiffManager that CheckoutSession needs: open a live diff
 * subscription, and nudge open subscriptions to recompute after a mutation. The
 * real CheckoutDiffManager satisfies this structurally; tests supply a fake.
 */
export interface CheckoutDiffSubscriber {
    read(params: Omit<CheckoutDiffSubscriptionRequest, "signal">): Promise<CheckoutDiffSnapshotPayload>;
    subscribe(params: CheckoutDiffSubscriptionRequest, listener: (snapshot: CheckoutDiffSnapshotPayload) => void): Promise<CheckoutDiffSubscription>;
    scheduleRefreshForCwd(cwd: string): void;
}
export interface CheckoutSessionOptions {
    host: CheckoutSessionHost;
    gitMutation: Pick<GitMutationService, "checkoutExistingBranch" | "notifyGitMutation">;
    workspaceGitService: WorkspaceGitService;
    github: ForgeService;
    checkoutDiffManager: CheckoutDiffSubscriber;
    gitMetadataGenerator: GitMetadataGenerator;
    paseoHome: string;
    worktreesRoot: string | undefined;
    logger: pino.Logger;
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
export declare class CheckoutSession {
    private static readonly PASEO_STASH_PREFIX;
    private readonly host;
    private readonly gitMutation;
    private readonly workspaceGitService;
    private readonly github;
    private readonly checkoutDiffManager;
    private readonly gitMetadataGenerator;
    private readonly paseoHome;
    private readonly worktreesRoot;
    private readonly logger;
    private readonly statusUpdateFingerprints;
    constructor(options: CheckoutSessionOptions);
    private resolveForgeService;
    private requireForgeService;
    private resolveForgeIdForError;
    private resolveAuthStateForError;
    /**
     * Combines resolveForgeIdForError + resolveAuthStateForError into a single
     * resolveForge(cwd) call for the (common) case where the failure isn't a
     * NoResolvedForgeServiceError — both helpers otherwise resolve the same cwd
     * independently in the same error path.
     */
    private resolveForgeContextForError;
    handleStatusRequest(msg: CheckoutStatusRequest): Promise<void>;
    handleCommitsListRequest(msg: CheckoutCommitsListRequest): Promise<void>;
    handleCommitFileDiffRequest(msg: CheckoutCommitFileDiffRequest): Promise<void>;
    handleValidateBranchRequest(msg: ValidateBranchRequest): Promise<void>;
    handleBranchSuggestionsRequest(msg: BranchSuggestionsRequest): Promise<void>;
    handleReadDiffRequest(msg: Extract<SessionInboundMessage, {
        type: "checkout.diff.get.request";
    }>): Promise<void>;
    handleSubscribeDiffRequest(msg: SubscribeCheckoutDiffRequest, ownership: SessionDelivery): Promise<void>;
    handleUnsubscribeDiffRequest(msg: UnsubscribeCheckoutDiffRequest, ownership: SessionDelivery): Promise<void>;
    handleRefreshRequest(msg: CheckoutRefreshRequest): Promise<void>;
    emitStatusUpdate(cwd: string, snapshot: WorkspaceGitRuntimeSnapshot): void;
    /**
     * Notify the live diff subscriptions that the working tree at `cwd` changed.
     * Called by the command handlers below after they mutate the repository.
     */
    private scheduleDiffRefresh;
    handleCheckoutSwitchBranchRequest(msg: Extract<SessionInboundMessage, {
        type: "checkout_switch_branch_request";
    }>): Promise<void>;
    handleCheckoutRenameBranchRequest(msg: CheckoutRenameBranchRequest): Promise<void>;
    handleCheckoutDiscardChangesRequest(msg: Extract<SessionInboundMessage, {
        type: "checkout.discard_changes.request";
    }>): Promise<void>;
    handleStashSaveRequest(msg: Extract<SessionInboundMessage, {
        type: "stash_save_request";
    }>): Promise<void>;
    handleStashPopRequest(msg: Extract<SessionInboundMessage, {
        type: "stash_pop_request";
    }>): Promise<void>;
    handleStashListRequest(msg: Extract<SessionInboundMessage, {
        type: "stash_list_request";
    }>): Promise<void>;
    handleCheckoutCommitRequest(msg: Extract<SessionInboundMessage, {
        type: "checkout_commit_request";
    }>): Promise<void>;
    handleCheckoutMergeRequest(msg: Extract<SessionInboundMessage, {
        type: "checkout_merge_request";
    }>): Promise<void>;
    handleCheckoutMergeFromBaseRequest(msg: Extract<SessionInboundMessage, {
        type: "checkout_merge_from_base_request";
    }>): Promise<void>;
    handleCheckoutPullRequest(msg: Extract<SessionInboundMessage, {
        type: "checkout_pull_request";
    }>): Promise<void>;
    handleCheckoutPushRequest(msg: Extract<SessionInboundMessage, {
        type: "checkout_push_request";
    }>): Promise<void>;
    handleCheckoutPrCreateRequest(msg: Extract<SessionInboundMessage, {
        type: "checkout_pr_create_request";
    }>): Promise<void>;
    handleCheckoutPrMergeRequest(msg: Extract<SessionInboundMessage, {
        type: "checkout_pr_merge_request";
    }>): Promise<void>;
    handleCheckoutForgeSetAutoMergeRequest(msg: Extract<SessionInboundMessage, {
        type: "checkout.forge.set_auto_merge.request" | "checkout.github.set_auto_merge.request";
    }>): Promise<void>;
    private resolveCurrentPullRequest;
    handleCheckoutPrStatusRequest(msg: Extract<SessionInboundMessage, {
        type: "checkout_pr_status_request";
    }>): Promise<void>;
    handlePullRequestTimelineRequest(msg: Extract<SessionInboundMessage, {
        type: "pull_request_timeline_request";
    }>): Promise<void>;
    handleCheckoutForgeGetCheckDetailsRequest(msg: Extract<SessionInboundMessage, {
        type: "checkout.forge.get_check_details.request" | "checkout.github.get_check_details.request";
    }>): Promise<void>;
    handleForgeSearchRequest(msg: Extract<SessionInboundMessage, {
        type: "forge.search.request" | "github_search_request";
    }>): Promise<void>;
    cleanup(): void;
}
//# sourceMappingURL=checkout-session.d.ts.map