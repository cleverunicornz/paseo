import type pino from "pino";
import type { ProjectCheckoutLitePayload } from "@getpaseo/protocol/messages";
import { type BranchCheckoutResolution, type BranchSuggestion, type CheckoutDiffCompare, type CheckoutDiffResult, getCheckoutDiff, getCheckoutRefDerivedState, getCheckoutSnapshotFacts, getCheckoutShortstat, getCheckoutStatus, getCheckoutWorktreeState, getPullRequestStatus, listBranchSuggestions, resolveRepositoryDefaultBranch, resolveBranchCheckout } from "../utils/checkout-git.js";
import type { ForgeAuthState, ForgeService, ForgeSpecificStatusFacts, PullRequestCheck, PullRequestMergeable } from "../services/forge-service.js";
import { type ForgeResolution } from "../services/forge-resolver.js";
import { runGitCommand, type RunGitCommand } from "../utils/run-git-command.js";
import { listPaseoWorktrees, type PaseoWorktreeInfo } from "../utils/worktree.js";
import { type WorkspaceGitFetchResult, type WorkspaceGitFetchObserver } from "./workspace-git-fetch.js";
import { type FileObserverDiagnostics, type FileObserver, type SubscribeToFileChanges } from "./file-observer/index.js";
import { createWatcherLivenessCanary } from "./watcher-liveness-canary.js";
export declare const WORKSPACE_GIT_OBSERVATION_REENSURE_INTERVAL_MS = 60000;
export declare const WORKSPACE_GIT_REFRESH_CONCURRENCY = 4;
export declare const WORKSPACE_GIT_OBSERVATION_SETUP_CONCURRENCY = 2;
export declare const WORKSPACE_GIT_WATCHER_SUBSCRIBE_TIMEOUT_MS = 10000;
export declare function getWorkspaceGitObservationReensurePhaseMs(cwd: string): number;
export declare const getWorkspaceGitSelfHealPhaseMs: typeof getWorkspaceGitObservationReensurePhaseMs;
export interface WorkspaceGitRuntimeSnapshot {
    cwd: string;
    git: {
        isGit: boolean;
        repoRoot: string | null;
        mainRepoRoot: string | null;
        currentBranch: string | null;
        remoteUrl: string | null;
        isPaseoOwnedWorktree: boolean;
        isDirty: boolean | null;
        baseRef: string | null;
        aheadBehind: {
            ahead: number;
            behind: number;
        } | null;
        upstreamRef: string | null;
        aheadOfOrigin: number | null;
        behindOfOrigin: number | null;
        hasRemote: boolean;
        diffStat: {
            additions: number;
            deletions: number;
        } | null;
    };
    forge: {
        featuresEnabled: boolean;
        authState: ForgeAuthState;
        /**
         * Forge resolved for this workspace from its remote — including the per-host
         * probe, so self-managed GitLab hosts (no "gitlab" in the name) are labeled
         * correctly. The wire projection prefers this over the bare name heuristic.
         */
        forge?: string;
        pullRequest: {
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
            checksStatus?: "none" | "pending" | "success" | "failure";
            reviewDecision?: "approved" | "changes_requested" | "pending" | null;
            forgeSpecific?: ForgeSpecificStatusFacts;
        } | null;
        error: {
            message: string;
        } | null;
    };
}
export interface WorkspaceGitService {
    registerWorkspace(params: {
        cwd: string;
    }, listener: WorkspaceGitListener): WorkspaceGitSubscription;
    onSnapshotUpdated(listener: WorkspaceGitSnapshotUpdatedListener): WorkspaceGitSubscription;
    peekSnapshot(cwd: string): WorkspaceGitRuntimeSnapshot | null;
    peekCachedCheckout(cwd: string): ProjectCheckoutLitePayload | null;
    getCheckout(cwd: string): Promise<ProjectCheckoutLitePayload>;
    getSnapshot(cwd: string, options?: WorkspaceGitSnapshotOptions): Promise<WorkspaceGitRuntimeSnapshot>;
    resolveForge(cwd: string): Promise<ForgeResolution | null>;
    getCheckoutDiff(cwd: string, options: CheckoutDiffCompare, readOptions?: WorkspaceGitReadOptions): Promise<CheckoutDiffResult>;
    validateBranchRef(cwd: string, ref: string, options?: WorkspaceGitReadOptions): Promise<WorkspaceGitBranchValidationResult>;
    hasLocalBranch(cwd: string, branch: string, options?: WorkspaceGitReadOptions): Promise<boolean>;
    suggestBranchesForCwd(cwd: string, options?: WorkspaceGitBranchSuggestionsOptions, readOptions?: WorkspaceGitReadOptions): Promise<WorkspaceGitBranchSuggestion[]>;
    listStashes(cwd: string, options?: WorkspaceGitStashListOptions, readOptions?: WorkspaceGitReadOptions): Promise<WorkspaceGitStashEntry[]>;
    listWorktrees(cwdOrRepoRoot: string, options?: WorkspaceGitReadOptions): Promise<WorkspaceGitWorktreeInfo[]>;
    getProjectSlug(cwd: string, options?: WorkspaceGitReadOptions): Promise<string>;
    resolveRepoRoot(cwd: string, options?: WorkspaceGitReadOptions): Promise<string>;
    resolveDefaultBranch(cwdOrRepoRoot: string, options?: WorkspaceGitReadOptions): Promise<string>;
    resolveRepoRemoteUrl(cwd: string, options?: WorkspaceGitReadOptions): Promise<string | null>;
    refresh(cwd: string, options?: {
        priority?: "normal" | "high";
    }): Promise<void>;
    requestWorkingTreeWatch(cwd: string, onChange: () => void): Promise<{
        repoRoot: string | null;
        unsubscribe: () => void;
    }>;
    scheduleRefreshForCwd(cwd: string): void;
    onWorkspaceStateMayHaveChanged(cwd: string): void;
    invalidateForge(cwd: string): void;
    getMetrics(): WorkspaceGitServiceMetrics;
    dispose(): Promise<void>;
}
export interface WorkspaceGitServiceMetrics {
    workspaceTargetCount: number;
    workspaceListenerCount: number;
    repositoryTargetCount: number;
    repositoryWorkspaceLinkCount: number;
    workingTreeWatchTargetCount: number;
    workingTreeWatchListenerCount: number;
    workspaceObservationSetupInFlightCount: number;
    workingTreeWatchSetupInFlightCount: number;
    workspaceRefreshInFlightCount: number;
    workspaceRefreshQueuedCount: number;
    workspaceRefreshAdmissionActiveCount: number;
    workspaceRefreshAdmissionPendingCount: number;
    workspaceObservationSetupAdmissionActiveCount: number;
    workspaceObservationSetupAdmissionPendingCount: number;
    fetchInFlightCount: number;
    snapshotUpdatedListenerCount: number;
    watcherErrorCallbackCount: number;
    fileObserver: FileObserverDiagnostics;
}
export type WorkspaceGitListener = (snapshot: WorkspaceGitRuntimeSnapshot) => void;
export type WorkspaceGitSnapshotUpdatedListener = (snapshot: WorkspaceGitRuntimeSnapshot) => void;
export interface WorkspaceGitSubscription {
    unsubscribe: () => void;
}
export type WorkspaceGitReadOptions = {
    force?: false;
    reason?: string;
} | {
    force: true;
    reason: string;
};
export interface WorkspaceGitBranchSuggestionsOptions {
    query?: string;
    limit?: number;
}
export interface WorkspaceGitStashListOptions {
    paseoOnly?: boolean;
}
export interface WorkspaceGitStashEntry {
    index: number;
    message: string;
    branch: string | null;
    isPaseo: boolean;
}
export type WorkspaceGitBranchValidationResult = BranchCheckoutResolution;
export type WorkspaceGitBranchSuggestion = BranchSuggestion;
export type WorkspaceGitWorktreeInfo = PaseoWorktreeInfo;
export type WorkspaceGitSnapshotOptions = {
    force?: false;
    includeForge?: boolean;
    reason?: string;
} | {
    force: true;
    includeForge?: boolean;
    reason: string;
};
interface WorkspaceGitServiceDependencies {
    subscribe: SubscribeToFileChanges;
    getCheckoutSnapshotFacts: typeof getCheckoutSnapshotFacts;
    getCheckoutRefDerivedState: typeof getCheckoutRefDerivedState;
    getCheckoutStatus: typeof getCheckoutStatus;
    getCheckoutShortstat: typeof getCheckoutShortstat;
    getCheckoutWorktreeState: typeof getCheckoutWorktreeState;
    getCheckoutDiff: typeof getCheckoutDiff;
    getPullRequestStatus: typeof getPullRequestStatus;
    resolveBranchCheckout: typeof resolveBranchCheckout;
    resolveRepositoryDefaultBranch: typeof resolveRepositoryDefaultBranch;
    listBranchSuggestions: typeof listBranchSuggestions;
    listPaseoWorktrees: typeof listPaseoWorktrees;
    /**
     * Adapter instances to bind by forge id instead of building from the registry
     * — the injection seam for the daemon's shared GitHub adapter and for test
     * fakes. Any forge not listed here is built (and cached once) by the registry.
     */
    forgeOverrides?: Record<string, ForgeService>;
    resolveAbsoluteGitDir: (cwd: string) => Promise<string | null>;
    hasOriginRemote: (cwd: string) => Promise<boolean>;
    runGitFetch: (cwd: string, observer: WorkspaceGitFetchObserver, runGitCommand: RunGitCommand) => Promise<WorkspaceGitFetchResult>;
    runGitCommand: typeof runGitCommand;
    getWorkspaceGitSelfHealPhaseMs: typeof getWorkspaceGitObservationReensurePhaseMs;
    createWatcherLivenessCanary: typeof createWatcherLivenessCanary;
    now: () => Date;
}
interface WorkspaceGitServiceOptions {
    logger: pino.Logger;
    paseoHome: string;
    worktreesRoot?: string;
    fileObserver?: FileObserver;
    deps?: Partial<WorkspaceGitServiceDependencies>;
}
export declare class WorkspaceGitServiceImpl implements WorkspaceGitService {
    private readonly logger;
    private readonly paseoHome;
    private readonly worktreesRoot;
    private readonly fileObserver;
    private readonly deps;
    private readonly forgeResolver;
    private readonly workspaceRefreshLimit;
    private readonly workspaceObservationSetupLimit;
    private readonly disposeController;
    private disposed;
    private disposePromise;
    private readonly snapshotUpdatedListeners;
    private readonly workspaceTargets;
    private readonly repoTargets;
    private readonly workingTreeWatchTargets;
    private readonly workingTreeWatchSetups;
    private readonly workingTreeWatchResolutions;
    private readonly workingTreeWatchAliases;
    /**
     * The last lite checkout per cwd, served without Git to a reconciliation
     * sweep or a client status request. It is service-level, not per target, so a
     * directory that was never observed still warms and a closed target's entry
     * is retired by its own invalidation, not by the target's lifetime.
     *
     * Only the read holding a slot's current identity can publish. An evicted
     * slot refuses all its outstanding reads, with no per-cwd tombstones outside
     * this bounded cache.
     */
    private readonly checkoutCache;
    private readonly branchValidationCache;
    private readonly localBranchCache;
    private readonly branchSuggestionsCache;
    private readonly stashListCache;
    private readonly worktreeListCache;
    private readonly defaultBranchCache;
    private readonly checkoutDiffCache;
    private watcherErrorCallbackCount;
    constructor(options: WorkspaceGitServiceOptions);
    resolveForge(cwd: string): Promise<ForgeResolution | null>;
    registerWorkspace(params: {
        cwd: string;
    }, listener: WorkspaceGitListener): WorkspaceGitSubscription;
    onSnapshotUpdated(listener: WorkspaceGitSnapshotUpdatedListener): WorkspaceGitSubscription;
    getMetrics(): WorkspaceGitServiceMetrics;
    getSnapshot(cwd: string, options?: WorkspaceGitSnapshotOptions): Promise<WorkspaceGitRuntimeSnapshot>;
    getCheckout(cwd: string): Promise<ProjectCheckoutLitePayload>;
    peekSnapshot(cwd: string): WorkspaceGitRuntimeSnapshot | null;
    /**
     * The last completed lite checkout for a warmed workspace, or null when there
     * is none (no target, or invalidated since the last refresh). Reads nothing
     * from Git, so a whole-estate sweep costs no processes beyond the refreshes
     * the workspace's own events already schedule.
     */
    peekCachedCheckout(cwd: string): ProjectCheckoutLitePayload | null;
    getCheckoutDiff(cwd: string, options: CheckoutDiffCompare, readOptions?: WorkspaceGitReadOptions): Promise<CheckoutDiffResult>;
    private normalizeCheckoutDiffOptions;
    private invalidateCheckoutDiffCache;
    validateBranchRef(cwd: string, ref: string, options?: WorkspaceGitReadOptions): Promise<WorkspaceGitBranchValidationResult>;
    hasLocalBranch(cwd: string, branch: string, options?: WorkspaceGitReadOptions): Promise<boolean>;
    suggestBranchesForCwd(cwd: string, options?: WorkspaceGitBranchSuggestionsOptions, readOptions?: WorkspaceGitReadOptions): Promise<WorkspaceGitBranchSuggestion[]>;
    listStashes(cwd: string, options?: WorkspaceGitStashListOptions, readOptions?: WorkspaceGitReadOptions): Promise<WorkspaceGitStashEntry[]>;
    listWorktrees(cwdOrRepoRoot: string, options?: WorkspaceGitReadOptions): Promise<WorkspaceGitWorktreeInfo[]>;
    resolveRepoRoot(cwd: string, options?: WorkspaceGitReadOptions): Promise<string>;
    resolveDefaultBranch(cwdOrRepoRoot: string, options?: WorkspaceGitReadOptions): Promise<string>;
    getProjectSlug(cwd: string, options?: WorkspaceGitReadOptions): Promise<string>;
    resolveRepoRemoteUrl(cwd: string, options?: WorkspaceGitReadOptions): Promise<string | null>;
    refresh(cwd: string, _options?: {
        priority?: "normal" | "high";
    }): Promise<void>;
    requestWorkingTreeWatch(cwd: string, onChange: () => void): Promise<{
        repoRoot: string | null;
        unsubscribe: () => void;
    }>;
    scheduleRefreshForCwd(cwd: string): void;
    onWorkspaceStateMayHaveChanged(cwd: string): void;
    /**
     * Drop the resolved forge adapter's cached state for a cwd. Goes through the
     * resolver so it targets the same adapter instance the poller reads — used by
     * git mutations to force a fresh forge status on the next refresh.
     */
    invalidateForge(cwd: string): void;
    dispose(): Promise<void>;
    private assertNotDisposed;
    private ensureWorkspaceTarget;
    private readAuxiliaryCache;
    private ensureAuxiliaryCacheEntry;
    private ensureWorkingTreeWatchTarget;
    private resolveWorkingTreeWatchTarget;
    private rememberWorkingTreeWatchAlias;
    private createWorkspaceTarget;
    private scheduleInitialWorkspaceRefresh;
    private scheduleWorkspaceObservationSetup;
    private setupWorkspaceObservation;
    private getFactsForObservation;
    private loadCheckoutFacts;
    private isActiveObservedWorkspaceTarget;
    private createWorkingTreeWatchTarget;
    private subscribeWithDeadline;
    private unsubscribeWatcherSubscription;
    private workingTreeIgnoreList;
    private startWorkingTreeSubscription;
    private degradedPollDelayMs;
    private refreshDegradedPollTarget;
    private startWorkingTreeWatchFallback;
    private degradeWorkingTreeWatch;
    /**
     * Advances the recovery backoff ladder and returns the delay to wait
     * before the next attempt. `attemptCount` only resets to 0 here, and only
     * when the subscription being replaced was established long enough ago to
     * have proven itself durable (>= `WATCH_RECOVERY_MAX_DELAY_MS`) — otherwise
     * a filesystem that accepts `subscribe()` but errors immediately on every
     * attempt (SMB/NFS, Docker virtiofs, some FUSE) would reset the ladder to 0
     * on every cycle and the backoff would never engage. Shared by the
     * working-tree and repo-metadata recovery paths so both apply the same
     * rule.
     */
    private advanceWatchRecoveryLadder;
    private scheduleWorkingTreeWatchRecovery;
    private recoverWorkingTreeWatch;
    private promoteWorkingTreeWatchTarget;
    /**
     * `git ls-files` reports ignored directories only once they exist, so the
     * ignore set must be re-read when new directory topology appears — not only
     * when the rules change. Keyed on `dirname` because FSEvents coalescing makes
     * the directory's own creation event unreliable; a file inside it proves it
     * exists either way.
     */
    private noteWorkingTreeDirectories;
    /**
     * `knownDirectories` only ever grows in the loop above — nothing
     * previously dropped an entry once its directory was deleted from disk,
     * so a long-lived daemon over a tree that creates and deletes directories
     * (build output, temp dirs, a churning dependency tree) would accumulate
     * tombstones for the life of the target and slow every future
     * `pruneKnownDirectories` pass along with it. `FileChange` events arrive
     * for files too, and a delete of `dir/file.txt` does not mean `dir` is
     * gone, so this only acts once the deleted path is itself confirmed a
     * known directory — a cheap `Set.has()` first, so the common case (a file
     * delete) costs one lookup and returns, same as the fast path this method
     * feeds into. A directory delete does not guarantee a delete event for
     * everything beneath it (coalescing, an `rm -rf` of a populated tree), so
     * once a deleted path is confirmed known, this drops the whole known
     * subtree the same way `pruneKnownDirectories` drops a newly ignored one —
     * the deleted path is the containment root here instead of an ignored
     * root.
     */
    private removeDeletedKnownDirectories;
    /**
     * See `WORKING_TREE_KNOWN_DIRECTORIES_MAX` for why clearing on overflow is
     * always safe. Runs only when this batch discovered at least one new
     * directory, since that is the only way `knownDirectories` grows.
     */
    private enforceKnownDirectoriesCap;
    private scheduleWorkingTreeIgnoreRefresh;
    /**
     * String-prefix containment, not `isRealpathInsideRoot`: every entry on
     * both sides is a plain path built from `target.watchPath` by this same
     * class (`dirname(event.path)` for `knownDirectories`, `resolve(watchPath,
     * ...)` for `ignoredDirectories` in `loadIgnoredDirs`) — no realpath
     * divergence to reconcile, per the same reasoning as
     * `noteWorkingTreeDirectories`. Normalizing each ignored root once up front
     * instead of recomputing per pair turns a 30k-known x 40-ignored scan from
     * ~26s of synchronous realpath syscalls into a bounded number of cheap
     * string comparisons.
     *
     * Case-folding still needs to happen for a Windows-looking root, same as
     * `isPathInsideRoot`/`isRealpathInsideRoot` in `../utils/path.js` — a
     * case-insensitive filesystem can report a known directory whose case
     * diverges from the git-reported ignored root. Since both sides derive
     * from the single `target.watchPath` for this target, whether to fold is
     * one decision for the whole call (`looksLikeDefiniteWindowsPath`
     * reused from `../utils/path.js`, not reimplemented here), not a per-pair
     * one — so it costs nothing beyond the already-precomputed prefixes.
     */
    private pruneKnownDirectories;
    /**
     * Undoes the "mark known" side effect of `noteWorkingTreeDirectories` for
     * every directory discovered since the last refresh that actually
     * completed, because this refresh did not — it fell back to the previous
     * ignore set (see `loadIgnoredDirs`). Leaving them in `knownDirectories`
     * would make the steady-state Set-lookup fast path in
     * `noteWorkingTreeDirectories` skip them forever, even though this refresh
     * never determined whether they are ignored. Removing them here re-arms
     * discovery: the next event under any of them is treated as unseen again,
     * so `noteWorkingTreeDirectories` schedules another refresh attempt.
     */
    private rearmPendingKnownDirectories;
    private hasRelevantWorkingTreeEvent;
    private refreshWorkingTreeIgnoredDirectories;
    private replaceWorkingTreeIgnoredDirectories;
    private haveSamePaths;
    private notifyWorkingTreeChanged;
    private notifyWorkingTreeConsumers;
    private scheduleWorkingTreeRefreshes;
    private getWorkingTreeWatchTargetForWorkspace;
    private resolveCheckoutWatchRoot;
    private resolveWorkspaceGitRefsRoot;
    private ensureRepoTarget;
    private startRepoMetadataObservation;
    private degradeRepoMetadataWatch;
    private scheduleRepoMetadataWatchRecovery;
    private recoverRepoMetadataWatch;
    private routeRepoMetadataEvents;
    private refreshWorkingTreeIgnoresFromRepoMetadataEvents;
    private isFetchRemoteMetadataEvent;
    private routeRepoMetadataEvent;
    private routePrivateGitDirEvent;
    private routeMainCheckoutMetadata;
    private routeLocalBranchRef;
    private routeRemoteBranchRef;
    private addWorkspaceMetadataRefresh;
    private scheduleRepoMetadataRefresh;
    private startRepoMetadataFallback;
    private scheduleWorkspaceRefresh;
    private startWorkspaceSubscriptionTimers;
    private updateForgePrStatusPollForTarget;
    private retainGenericForgePrStatusPoll;
    private resolveForgePrStatusPollTarget;
    private stopForgePrStatusPollForTarget;
    /**
     * `previous` is what the caller should get back on failure. `runGitCommand`
     * rejects on any non-zero exit or timeout, and a timeout is plausible under
     * exactly the churn storm this ignore-refresh path targets. Returning an
     * empty set on failure would read to the caller as "nothing is ignored" —
     * indistinguishable from a real, freshly-computed empty result — and
     * `replaceWorkingTreeIgnoredDirectories` treats its return value as
     * authoritative, replacing `target.ignoredDirectories` and re-ingesting
     * every directory that was previously ignored. Returning the previous set
     * instead means a failed refresh leaves the watcher's ignore state
     * unchanged rather than un-ignoring the entire dependency tree.
     *
     * `failed` lets the caller distinguish "ran fresh and happened to match
     * `previous`" from "the git command itself failed" — the two are
     * indistinguishable by comparing sets alone, but `replaceWorkingTreeIgnoredDirectories`
     * needs to know which one happened to decide whether directories newly
     * marked known since the last refresh can be trusted or must be re-armed.
     */
    private loadIgnoredDirs;
    private refreshWorkspaceTarget;
    private requestWorkspaceSnapshot;
    private normalizeRefreshRequest;
    private shouldThrottleNonForcedRefresh;
    private buildScheduledRefreshRequest;
    private mergeRefreshRequests;
    private runWorkspaceRefreshLoop;
    private refreshSnapshot;
    /**
     * Publish the lite checkout derived from the freshest facts this read
     * established, so a later reconciliation sweep - or a client status request -
     * can read it without Git. The identity captured when the read began must
     * still be current: invalidation, eviction or a newer read retires it.
     */
    private publishCachedCheckout;
    /**
     * Reserve this read's publication identity before it starts. Preserve a warm
     * value during a refresh, but retire every older read's right to publish.
     */
    private reserveCheckoutGeneration;
    private checkoutLiteFromRuntimeGit;
    /**
     * Retire the cached checkout for a cwd and any read in flight behind it. The
     * next read goes live; a read that began before this call cannot publish. The
     * slot's identity is never reused, even if eviction removes the slot before
     * the read resolves. This also holds for cwds with no workspace target.
     */
    private invalidateCachedCheckout;
    private refreshRefDerivedSnapshot;
    private refreshWorktreeSnapshot;
    private refreshGitSnapshot;
    private refreshForgeSnapshot;
    private combineSnapshot;
    private getForgePrStatusPollKey;
    private rememberForgePrStatusSnapshot;
    private rememberSnapshot;
    private runRepoFetch;
    private applyRepoFetchResult;
    private flushBufferedFetchMetadataEvents;
    private flushFetchMetadataEvents;
    private removeWorkspaceListener;
    private removeWorkspaceTarget;
    private removeWorkingTreeWatchListener;
    private removeWorkspaceWorkingTreeLink;
    private closeWorkingTreeWatchTargetIfUnused;
    private closeWorkspaceTarget;
    private closeWorkingTreeWatchTarget;
    private closeRepoTarget;
}
export {};
//# sourceMappingURL=workspace-git-service.d.ts.map