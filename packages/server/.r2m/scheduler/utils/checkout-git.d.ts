import type { CheckoutCommit } from "@getpaseo/protocol/messages";
import type { Logger } from "pino";
import type { ParsedDiffFile } from "../server/utils/diff-highlighter.js";
import type { ForgeAuthState, ForgeService, ForgeSpecificStatusFacts, PullRequestCheck as ForgePullRequestCheck, PullRequestMergeable } from "../services/forge-service.js";
import { type RunGitCommand } from "./run-git-command.js";
/**
 * Why a git mutation is forcing a workspace snapshot refresh. Shared between the
 * Session shell (which owns the refresh primitive) and the checkout subsystem
 * (which triggers most of these reasons after a write).
 */
export type GitMutationRefreshReason = "commit-changes" | "pull" | "push" | "merge-to-base" | "merge-from-base" | "merge-pr" | "enable-pr-auto-merge" | "disable-pr-auto-merge" | "create-pr" | "switch-branch" | "rename-branch" | "create-branch" | "stash-push" | "stash-pop" | "discard-changes" | "create-worktree";
interface CheckoutReadCacheOptions {
    force?: boolean;
    reason?: string;
}
interface PullRequestStatusLookupTarget {
    headRef: string;
    headSha?: string;
    headRepositoryOwner?: string;
}
export declare function __resetPullRequestStatusCacheForTests(): void;
export declare function __setPullRequestStatusCacheTtlForTests(ttlMs: number): void;
export declare function __resetCheckoutShortstatCacheForTests(): void;
export declare function __setCheckoutShortstatCacheTtlForTests(ttlMs: number): void;
export interface BranchSuggestion {
    name: string;
    committerDate: number;
    hasLocal: boolean;
    hasRemote: boolean;
    localAhead?: number;
    localBehind?: number;
}
export declare function listBranchSuggestions(cwd: string, options?: {
    query?: string;
    limit?: number;
}): Promise<BranchSuggestion[]>;
export interface LocalBranchCheckoutResolution {
    kind: "local";
    name: string;
}
export interface RemoteOnlyBranchCheckoutResolution {
    kind: "remote-only";
    name: string;
    remoteRef: string;
}
export interface NotFoundBranchCheckoutResolution {
    kind: "not-found";
}
export type BranchCheckoutResolution = LocalBranchCheckoutResolution | RemoteOnlyBranchCheckoutResolution | NotFoundBranchCheckoutResolution;
export declare function resolveBranchCheckout(cwd: string, name: string): Promise<BranchCheckoutResolution>;
export type BranchCheckoutSource = "local" | "remote";
export interface CheckoutExistingBranchResult {
    source: BranchCheckoutSource;
}
export interface CheckoutResolvedBranchInput {
    cwd: string;
    resolution: BranchCheckoutResolution;
    requestedBranch?: string;
}
export declare function checkoutResolvedBranch(input: CheckoutResolvedBranchInput): Promise<CheckoutExistingBranchResult>;
export declare class NotGitRepoError extends Error {
    readonly cwd: string;
    readonly code = "NOT_GIT_REPO";
    constructor(cwd: string);
}
export declare class MergeConflictError extends Error {
    readonly baseRef: string;
    readonly currentBranch: string;
    readonly conflictFiles: string[];
    constructor(options: {
        baseRef: string;
        currentBranch: string;
        conflictFiles: string[];
    });
}
export declare class MergeFromBaseConflictError extends Error {
    readonly baseRef: string;
    readonly currentBranch: string;
    readonly conflictFiles: string[];
    constructor(options: {
        baseRef: string;
        currentBranch: string;
        conflictFiles: string[];
    });
}
export interface AheadBehind {
    ahead: number;
    behind: number;
}
export interface CheckoutStatus {
    isGit: false;
}
export interface CheckoutStatusGitNonPaseo {
    isGit: true;
    repoRoot: string;
    mainRepoRoot: string | null;
    currentBranch: string | null;
    isDirty: boolean;
    baseRef: string | null;
    aheadBehind: AheadBehind | null;
    upstreamRef: string | null;
    aheadOfOrigin: number | null;
    behindOfOrigin: number | null;
    hasRemote: boolean;
    remoteUrl: string | null;
    isPaseoOwnedWorktree: false;
}
export interface CheckoutStatusGitPaseo {
    isGit: true;
    repoRoot: string;
    mainRepoRoot: string;
    currentBranch: string | null;
    isDirty: boolean;
    baseRef: string;
    aheadBehind: AheadBehind | null;
    upstreamRef: string | null;
    aheadOfOrigin: number | null;
    behindOfOrigin: number | null;
    hasRemote: boolean;
    remoteUrl: string | null;
    isPaseoOwnedWorktree: true;
}
export type CheckoutStatusGit = CheckoutStatusGitNonPaseo | CheckoutStatusGitPaseo;
export type CheckoutStatusResult = CheckoutStatus | CheckoutStatusGit;
export type CheckoutDiffResult = {
    diff: string;
    structured?: ParsedDiffFile[];
    diffTooLarge?: false;
} | {
    diff: "";
    structured: [];
    diffTooLarge: true;
};
export interface CheckoutDiffCompare {
    mode: "uncommitted" | "base";
    baseRef?: string;
    ignoreWhitespace?: boolean;
    includeStructured?: boolean;
}
export interface MergeToBaseOptions {
    baseRef?: string;
    mode?: "merge" | "squash";
    commitMessage?: string;
}
export interface MergeFromBaseOptions {
    baseRef?: string;
    requireCleanTarget?: boolean;
}
export interface CheckoutContext {
    paseoHome?: string;
    worktreesRoot?: string;
    logger?: Pick<Logger, "trace" | "warn">;
    facts?: CheckoutSnapshotFacts | null;
    runGitCommand?: RunGitCommand;
}
export type CheckoutSnapshotFacts = {
    isGit: false;
} | {
    isGit: true;
    worktreeRoot: string;
    currentBranch: string | null;
    remoteUrl: string | null;
    absoluteGitDir: string | null;
    gitCommonDir: string | null;
    paseoWorktree: PaseoWorktreeForCwd;
    storedBaseRef: string | null;
    resolvedBaseRef: string | null;
    mainRepoRoot: string | null;
    comparisonBaseRef: string | null;
    branchRemoteName: string | null;
    branchMergeRef: string | null;
    upstreamStatus: UpstreamStatus | null;
    pullRequestLookupTarget: PullRequestStatusLookupTarget | null;
};
export declare function getCurrentBranch(cwd: string, context?: CheckoutContext): Promise<string | null>;
export declare function getMainRepoRoot(cwd: string, context?: CheckoutContext): Promise<string>;
export interface GitWorktreeEntry {
    path: string;
    branchRef?: string;
    isBare?: boolean;
}
/** Check whether a path is under Paseo's worktree root. */
export declare function isPaseoWorktreePath(p: string, options?: {
    paseoHome?: string;
    worktreesRoot?: string;
}): boolean;
/** True when `child` is strictly inside `parent` (handles both `/` and `\`). */
export declare function isDescendantPath(child: string, parent: string): boolean;
export declare function parseWorktreeList(output: string): GitWorktreeEntry[];
export declare function localBranchExists(cwd: string, branchName: string): Promise<boolean>;
export declare function renameCurrentBranch(cwd: string, newName: string): Promise<{
    previousBranch: string | null;
    currentBranch: string | null;
}>;
type PaseoWorktreeForCwd = {
    isPaseoOwnedWorktree: false;
} | {
    isPaseoOwnedWorktree: true;
    worktreeRoot: string;
};
export declare function getOriginRemoteUrl(cwd: string, context?: CheckoutContext): Promise<string | null>;
export declare function hasOriginRemote(cwd: string): Promise<boolean>;
export declare function resolveAbsoluteGitDir(cwd: string, context?: CheckoutContext): Promise<string | null>;
export declare function resolveRepositoryDefaultBranch(repoRoot: string, context?: CheckoutContext): Promise<string | null>;
export interface UpstreamStatus {
    ref: string;
    aheadBehind: AheadBehind;
}
export declare function getCheckoutSnapshotFacts(cwd: string, context?: CheckoutContext): Promise<CheckoutSnapshotFacts>;
export declare const CHECKOUT_DIFF_MAX_STRUCTURED_BYTES: number;
export declare function getCheckoutStatus(cwd: string, context?: CheckoutContext): Promise<CheckoutStatusResult>;
export interface CheckoutCommitsResult {
    baseRef: string | null;
    commits: CheckoutCommit[];
}
export declare function listCheckoutCommits({ cwd, context, }: {
    cwd: string;
    context?: CheckoutContext;
}): Promise<CheckoutCommitsResult>;
/**
 * Fetches the unified diff of a single file as introduced by one commit and
 * parses it into the same {@link ParsedDiffFile} shape the diff subscription
 * emits (so the client can reuse its existing renderer).
 *
 * Compares merge commits to their first parent, matching the linear history shown
 * in the explorer. The text is parsed and highlighted by
 * {@link parseAndHighlightDiff} — the exact parser the diff subscription uses.
 * Returns `null` when the file is absent from the commit or the change is
 * binary-only (no textual hunks). Throws on git failure (e.g. an unknown sha),
 * which the caller maps to a typed checkout error.
 */
export declare function getCommitFileDiff({ cwd, sha, path, }: {
    cwd: string;
    sha: string;
    path: string;
}): Promise<ParsedDiffFile | null>;
export interface CheckoutShortstat {
    additions: number;
    deletions: number;
}
export declare function getCheckoutShortstat(cwd: string, context?: CheckoutContext, options?: CheckoutReadCacheOptions): Promise<CheckoutShortstat | null>;
export interface CheckoutRefDerivedState {
    aheadBehind: AheadBehind | null;
    diffStat: CheckoutShortstat | null;
    upstreamStatus: UpstreamStatus | null;
}
export declare function getCheckoutRefDerivedState(cwd: string, facts: Extract<CheckoutSnapshotFacts, {
    isGit: true;
}>, current: Pick<CheckoutRefDerivedState, "aheadBehind" | "diffStat">, movedRemoteRefs: ReadonlySet<string>, context?: CheckoutContext): Promise<CheckoutRefDerivedState>;
export interface CheckoutWorktreeState {
    isDirty: boolean;
    diffStat: CheckoutShortstat | null;
}
export declare function getCheckoutWorktreeState(cwd: string, context: CheckoutContext): Promise<CheckoutWorktreeState>;
export declare function getCachedCheckoutShortstat(cwd: string): CheckoutShortstat | null | undefined;
export declare function warmCheckoutShortstatInBackground(cwd: string, context?: CheckoutContext, onComplete?: () => void): void;
export declare function getCheckoutDiff(cwd: string, compare: CheckoutDiffCompare, context?: CheckoutContext): Promise<CheckoutDiffResult>;
export declare function commitChanges(cwd: string, options: {
    message: string;
    addAll?: boolean;
}): Promise<void>;
export declare function commitAll(cwd: string, message: string): Promise<void>;
export declare function discardChanges(cwd: string, pathspecs: string[]): Promise<void>;
export declare function mergeToBase(cwd: string, options?: MergeToBaseOptions, context?: CheckoutContext): Promise<string>;
export declare function mergeFromBase(cwd: string, options?: MergeFromBaseOptions, context?: CheckoutContext): Promise<void>;
export declare function pullCurrentBranch(cwd: string, forgeService?: ForgeService): Promise<void>;
export declare function pushCurrentBranch(cwd: string, forgeService?: ForgeService): Promise<void>;
export interface CreatePullRequestOptions {
    title: string;
    body?: string;
    base?: string;
    head?: string;
    draft?: boolean;
}
export interface PullRequestStatus {
    number?: number;
    repoOwner?: string;
    repoName?: string;
    projectPath?: string;
    url: string;
    title: string;
    state: string;
    baseRefName: string;
    headRefName: string;
    isMerged: boolean;
    isDraft?: boolean;
    mergeable?: PullRequestMergeable;
    checks?: PullRequestCheck[];
    checksStatus?: ChecksStatus;
    reviewDecision?: ReviewDecision;
    forgeSpecific?: ForgeSpecificStatusFacts;
}
export interface PullRequestStatusResult {
    status: PullRequestStatus | null;
    /** Why forge features are (un)available — drives the onboarding callout. */
    authState: ForgeAuthState;
    /** Kept in sync with {@link authState} for back-compat; true iff authenticated. */
    githubFeaturesEnabled: boolean;
}
/** True for the CLI-missing / authentication errors of any supported forge. */
export declare function isForgeAuthError(error: unknown): boolean;
/**
 * Map a forge CLI failure to an auth state. A missing-CLI error means the user
 * must install the tool; anything else surfaced as an auth probe failure means
 * they must sign in.
 */
export declare function forgeAuthStateFromError(error: unknown): ForgeAuthState;
export type PullRequestCheck = ForgePullRequestCheck;
export type ChecksStatus = "none" | "pending" | "success" | "failure";
export type ReviewDecision = "approved" | "changes_requested" | "pending" | null;
export declare function createPullRequest(cwd: string, options: CreatePullRequestOptions, forgeService?: ForgeService, context?: CheckoutContext): Promise<{
    url: string;
    number: number;
}>;
export declare function getPullRequestStatus(cwd: string, forgeService?: ForgeService, options?: CheckoutReadCacheOptions, context?: CheckoutContext): Promise<PullRequestStatusResult>;
export {};
//# sourceMappingURL=checkout-git.d.ts.map