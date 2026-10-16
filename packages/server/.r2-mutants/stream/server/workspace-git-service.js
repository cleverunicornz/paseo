import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { LRUCache } from "lru-cache";
import { CheckoutDiffCache } from "./checkout-diff-cache.js";
import pLimit from "p-limit";
import { parseGitRemoteLocation } from "@getpaseo/protocol/git-remote";
import { getCheckoutDiff, getCheckoutRefDerivedState, getCheckoutSnapshotFacts, getCheckoutShortstat, getCheckoutStatus, getCheckoutWorktreeState, getPullRequestStatus, forgeAuthStateFromError, hasOriginRemote, listBranchSuggestions, resolveRepositoryDefaultBranch, resolveBranchCheckout, resolveAbsoluteGitDir, } from "../utils/checkout-git.js";
import { createForgeService } from "../services/forge-registry.js";
import { createForgeResolver, } from "../services/forge-resolver.js";
import { parseGitRevParsePath } from "../utils/git-rev-parse-path.js";
import { createRealpathAwarePathMatcher, getRealpathAwareRelativePath, isPathInsideRoot, isRealpathInsideRoot, looksLikeDefiniteWindowsPath, } from "../utils/path.js";
import { createRunGitCommand, runGitCommand, } from "../utils/run-git-command.js";
import { branchNameFromRef } from "../utils/worktree-metadata.js";
import { listPaseoWorktrees } from "../utils/worktree.js";
import { READ_ONLY_GIT_ENV } from "./checkout-git-utils.js";
import { classifyGitMetadataPath, getPrunedGitMetadataPaths } from "./git-metadata-event-rules.js";
import { fetchWorkspaceGitRemote, } from "./workspace-git-fetch.js";
import { deriveProjectSlug } from "./workspace-git-metadata.js";
import { createFileObserver, } from "./file-observer/index.js";
import { checkoutLiteFromGitSnapshot } from "./workspace-registry-model.js";
import { createWatcherLivenessCanary } from "./watcher-liveness-canary.js";
const WORKSPACE_GIT_WATCH_DEBOUNCE_MS = 1000;
const BACKGROUND_GIT_FETCH_INTERVAL_MS = 180000;
const FETCH_METADATA_ECHO_TTL_MS = 5000;
export const WORKSPACE_GIT_OBSERVATION_REENSURE_INTERVAL_MS = 60000;
const FORGE_PR_STATUS_POLL_FAST_INTERVAL_MS = 20000;
const FORGE_PR_STATUS_POLL_SLOW_INTERVAL_MS = 120000;
const FORGE_PR_STATUS_POLL_ERROR_BACKOFF_CAP_MS = 300000;
const DEGRADED_GIT_POLL_INTERVAL_MS = 5000;
// Degraded polling shells out a full Git refresh per tick, and the repositories that defeat the
// recursive watcher are the ones where that refresh is expensive. At a fixed cadence the daemon
// therefore burns a core forever on a workspace nobody has touched. Double the gap after every
// tick that produced an identical snapshot, and drop back to the base interval as soon as one
// does not. Explicit reads still force a refresh, so this only bounds background discovery of
// changes made outside Paseo.
const DEGRADED_GIT_POLL_MAX_INTERVAL_MS = 60000;
// A dependency install creates directories for minutes. Collapse the burst into
// a couple of `git ls-files` runs rather than one per event.
const WORKING_TREE_IGNORE_REFRESH_QUIET_MS = 300;
const WORKING_TREE_IGNORE_REFRESH_MAX_DELAY_MS = 2000;
// `knownDirectories` is a memoisation of the fast path in
// `noteWorkingTreeDirectories`, not authoritative state — every entry is
// rediscoverable from a later watcher event under the same path. Deletion
// handling (`removeDeletedKnownDirectories`) keeps it close to the live
// directory count, but this cap is the backstop for what that cannot cover
// (a missed or coalesced delete event, a backend quirk): clearing the whole
// set outright on overflow is always safe, since the only cost is one extra
// `git ls-files` refresh the next time a directory under this root is
// touched again. Set well below `MAX_TRACKED_ENTRIES` (250_000, the
// native-recursive.ts cap on combined file+directory entries per watched
// root) because directories are a minority of any tracked tree, and the
// observer itself already fails into polling before a single root's
// combined entry count could approach that cap.
const WORKING_TREE_KNOWN_DIRECTORIES_MAX = 50000;
// Keep whole workspace pipelines below the lower-level Git process pool so daemon control work
// retains subprocess and event-loop headroom during large workspace reconciliation bursts.
export const WORKSPACE_GIT_REFRESH_CONCURRENCY = 4;
export const WORKSPACE_GIT_OBSERVATION_SETUP_CONCURRENCY = 2;
export const WORKSPACE_GIT_WATCHER_SUBSCRIBE_TIMEOUT_MS = 10000;
const WATCH_RECOVERY_BASE_DELAY_MS = 30000;
// Giving up permanently leaves polling as the only behaviour until a daemon
// restart, which kills running agents. Back off, but keep trying.
const WATCH_RECOVERY_MAX_DELAY_MS = 300000;
const WATCH_RECOVERY_MAX_BACKOFF_STEPS = 4;
// Auxiliary reads may reuse cached values within this window; snapshots do not expire on read.
const WORKSPACE_GIT_AUXILIARY_READ_TTL_MS = 15000;
// Non-forced refresh triggers share this minimum gap to absorb watcher/self-heal bursts; force bypasses it.
const WORKSPACE_GIT_INTERNAL_MIN_GAP_MS = 2000;
// Small values (booleans, short strings, small arrays); generous cap.
const WORKSPACE_GIT_AUXILIARY_CACHE_MAX = 256;
/**
 * The checkout cache must hold the whole live estate, or a sweep re-reads what
 * the LRU evicted and the warm path degrades to O(workspaces). The observed
 * estate is a few hundred live records across under a thousand roots; the bound
 * leaves headroom above that, and stays bounded for a daemon that sees more.
 */
const WORKSPACE_GIT_CHECKOUT_CACHE_MAX = 4096;
function mergeSets(left, right) {
    const merged = new Set(left);
    let added = false;
    for (const value of right) {
        if (!merged.has(value)) {
            merged.add(value);
            added = true;
        }
    }
    return { merged, added };
}
export function getWorkspaceGitObservationReensurePhaseMs(cwd) {
    return (createHash("sha256").update(cwd).digest().readUInt32BE(0) %
        WORKSPACE_GIT_OBSERVATION_REENSURE_INTERVAL_MS);
}
// Kept for local diagnostic fixtures that only use the stable phase calculation.
export const getWorkspaceGitSelfHealPhaseMs = getWorkspaceGitObservationReensurePhaseMs;
class WorkspaceGitServiceDisposedError extends Error {
    constructor() {
        super("WorkspaceGitService is disposed");
        this.name = "WorkspaceGitServiceDisposedError";
    }
}
class WorkspaceGitWatcherSubscriptionTimeoutError extends Error {
    constructor(watchPath) {
        super(`Watcher subscription for ${watchPath} timed out after ${WORKSPACE_GIT_WATCHER_SUBSCRIBE_TIMEOUT_MS}ms`);
        this.name = "WorkspaceGitWatcherSubscriptionTimeoutError";
    }
}
function setsEqual(left, right) {
    return left.size === right.size && [...left].every((value) => right.has(value));
}
function buildDefaultWorkspaceGitServiceDeps(subscribe) {
    return {
        subscribe,
        getCheckoutSnapshotFacts,
        getCheckoutRefDerivedState,
        getCheckoutStatus,
        getCheckoutShortstat,
        getCheckoutWorktreeState,
        getCheckoutDiff,
        getPullRequestStatus,
        resolveBranchCheckout,
        resolveRepositoryDefaultBranch,
        listBranchSuggestions,
        listPaseoWorktrees,
        resolveAbsoluteGitDir,
        hasOriginRemote,
        runGitFetch: fetchWorkspaceGitRemote,
        runGitCommand,
        getWorkspaceGitSelfHealPhaseMs: getWorkspaceGitObservationReensurePhaseMs,
        createWatcherLivenessCanary,
        now: () => new Date(),
    };
}
function resolveWorkspaceGitServiceDeps(subscribe, deps) {
    return { ...buildDefaultWorkspaceGitServiceDeps(subscribe), ...deps };
}
export class WorkspaceGitServiceImpl {
    constructor(options) {
        this.workspaceRefreshLimit = pLimit({
            concurrency: WORKSPACE_GIT_REFRESH_CONCURRENCY,
            rejectOnClear: true,
        });
        this.workspaceObservationSetupLimit = pLimit({
            concurrency: WORKSPACE_GIT_OBSERVATION_SETUP_CONCURRENCY,
            rejectOnClear: true,
        });
        this.disposeController = new AbortController();
        this.disposed = false;
        this.disposePromise = null;
        this.snapshotUpdatedListeners = new Set();
        this.workspaceTargets = new Map();
        this.repoTargets = new Map();
        this.workingTreeWatchTargets = new Map();
        this.workingTreeWatchSetups = new Map();
        this.workingTreeWatchResolutions = new Map();
        this.workingTreeWatchAliases = new Map();
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
        this.checkoutCache = new LRUCache({
            max: WORKSPACE_GIT_CHECKOUT_CACHE_MAX,
        });
        this.branchValidationCache = new LRUCache({ max: WORKSPACE_GIT_AUXILIARY_CACHE_MAX });
        this.localBranchCache = new LRUCache({ max: WORKSPACE_GIT_AUXILIARY_CACHE_MAX });
        this.branchSuggestionsCache = new LRUCache({ max: WORKSPACE_GIT_AUXILIARY_CACHE_MAX });
        this.stashListCache = new LRUCache({ max: WORKSPACE_GIT_AUXILIARY_CACHE_MAX });
        this.worktreeListCache = new LRUCache({ max: WORKSPACE_GIT_AUXILIARY_CACHE_MAX });
        this.defaultBranchCache = new LRUCache({ max: WORKSPACE_GIT_AUXILIARY_CACHE_MAX });
        this.checkoutDiffCache = new CheckoutDiffCache(() => this.deps.now().getTime());
        this.watcherErrorCallbackCount = 0;
        this.logger = options.logger.child({ module: "workspace-git-service" });
        this.paseoHome = options.paseoHome;
        this.worktreesRoot = options.worktreesRoot;
        this.fileObserver = options.fileObserver ?? createFileObserver();
        this.deps = resolveWorkspaceGitServiceDeps(this.fileObserver.subscribe.bind(this.fileObserver), options.deps);
        this.forgeResolver = createForgeResolver({
            createService: (forge) => this.deps.forgeOverrides?.[forge] ?? createForgeService(forge),
        });
    }
    resolveForge(cwd) {
        this.assertNotDisposed();
        return this.forgeResolver.resolve(resolve(cwd));
    }
    registerWorkspace(params, listener) {
        this.assertNotDisposed();
        const cwd = resolve(params.cwd);
        const target = this.ensureWorkspaceTarget(cwd);
        target.listeners.add(listener);
        if (target.listeners.size === 1) {
            this.startWorkspaceSubscriptionTimers(target);
        }
        if (!target.latestSnapshot) {
            this.scheduleInitialWorkspaceRefresh(target);
        }
        this.scheduleWorkspaceObservationSetup(target);
        return {
            unsubscribe: () => {
                this.removeWorkspaceListener(cwd, listener);
            },
        };
    }
    onSnapshotUpdated(listener) {
        this.assertNotDisposed();
        this.snapshotUpdatedListeners.add(listener);
        return {
            unsubscribe: () => {
                this.snapshotUpdatedListeners.delete(listener);
            },
        };
    }
    getMetrics() {
        let workspaceListenerCount = 0;
        let repositoryWorkspaceLinkCount = 0;
        let workingTreeWatchListenerCount = 0;
        let workspaceRefreshInFlightCount = 0;
        let workspaceRefreshQueuedCount = 0;
        let workspaceObservationSetupInFlightCount = 0;
        let fetchInFlightCount = 0;
        for (const target of this.workspaceTargets.values()) {
            workspaceListenerCount += target.listeners.size;
            if (target.observationSetupPromise) {
                workspaceObservationSetupInFlightCount += 1;
            }
            if (target.refreshState.status === "in-flight") {
                workspaceRefreshInFlightCount += 1;
                if (target.refreshState.queued) {
                    workspaceRefreshQueuedCount += 1;
                }
            }
        }
        for (const target of this.repoTargets.values()) {
            repositoryWorkspaceLinkCount += target.workspaceKeys.size;
            if (target.fetchInFlight) {
                fetchInFlightCount += 1;
            }
        }
        for (const target of this.workingTreeWatchTargets.values()) {
            workingTreeWatchListenerCount += target.listeners.size;
        }
        return {
            workspaceTargetCount: this.workspaceTargets.size,
            workspaceListenerCount,
            repositoryTargetCount: this.repoTargets.size,
            repositoryWorkspaceLinkCount,
            workingTreeWatchTargetCount: this.workingTreeWatchTargets.size,
            workingTreeWatchListenerCount,
            workspaceObservationSetupInFlightCount,
            workingTreeWatchSetupInFlightCount: this.workingTreeWatchSetups.size,
            workspaceRefreshInFlightCount,
            workspaceRefreshQueuedCount,
            workspaceRefreshAdmissionActiveCount: this.workspaceRefreshLimit.activeCount,
            workspaceRefreshAdmissionPendingCount: this.workspaceRefreshLimit.pendingCount,
            workspaceObservationSetupAdmissionActiveCount: this.workspaceObservationSetupLimit.activeCount,
            workspaceObservationSetupAdmissionPendingCount: this.workspaceObservationSetupLimit.pendingCount,
            fetchInFlightCount,
            snapshotUpdatedListenerCount: this.snapshotUpdatedListeners.size,
            watcherErrorCallbackCount: this.watcherErrorCallbackCount,
            fileObserver: this.fileObserver.getDiagnostics(),
        };
    }
    async getSnapshot(cwd, options) {
        this.assertNotDisposed();
        cwd = resolve(cwd);
        const request = this.normalizeRefreshRequest(options, "getSnapshot", true);
        const target = this.ensureWorkspaceTarget(cwd);
        if (!request.force && target.latestSnapshot) {
            return target.latestSnapshot;
        }
        return this.requestWorkspaceSnapshot(target, request);
    }
    async getCheckout(cwd) {
        this.assertNotDisposed();
        const normalizedCwd = resolve(cwd);
        const cached = this.peekCachedCheckout(normalizedCwd);
        if (cached) {
            return cached;
        }
        // Captured before any Git read: if an invalidation lands while this read is
        // in flight, the identity moves and this read publishes nothing - whether
        // or not the cwd has a workspace target.
        const generation = this.reserveCheckoutGeneration(normalizedCwd);
        const status = await this.deps.getCheckoutStatus(normalizedCwd, {
            paseoHome: this.paseoHome,
            worktreesRoot: this.worktreesRoot,
            logger: this.logger,
        });
        const checkout = status.isGit
            ? checkoutLiteFromGitSnapshot(normalizedCwd, {
                isGit: true,
                currentBranch: status.currentBranch,
                remoteUrl: status.remoteUrl,
                repoRoot: status.repoRoot,
                isPaseoOwnedWorktree: status.isPaseoOwnedWorktree,
                mainRepoRoot: status.mainRepoRoot,
            })
            : checkoutLiteFromGitSnapshot(normalizedCwd, {
                isGit: false,
                currentBranch: null,
                remoteUrl: null,
                repoRoot: null,
                isPaseoOwnedWorktree: false,
                mainRepoRoot: null,
            });
        this.publishCachedCheckout(normalizedCwd, generation, checkout);
        return checkout;
    }
    peekSnapshot(cwd) {
        cwd = resolve(cwd);
        return this.workspaceTargets.get(cwd)?.latestSnapshot ?? null;
    }
    /**
     * The last completed lite checkout for a warmed workspace, or null when there
     * is none (no target, or invalidated since the last refresh). Reads nothing
     * from Git, so a whole-estate sweep costs no processes beyond the refreshes
     * the workspace's own events already schedule.
     */
    peekCachedCheckout(cwd) {
        return this.checkoutCache.get(resolve(cwd))?.checkout ?? null;
    }
    async getCheckoutDiff(cwd, options, readOptions) {
        this.assertNotDisposed();
        const normalizedCwd = resolve(cwd);
        const normalizedOptions = this.normalizeCheckoutDiffOptions(options);
        // Initial inventory events cover the watcher setup gap. Process them before
        // starting a cold diff, rather than invalidating that build halfway through.
        await this.workspaceTargets.get(normalizedCwd)?.observationSetupPromise;
        this.assertNotDisposed();
        return this.checkoutDiffCache.read({
            cwd: normalizedCwd,
            compare: normalizedOptions,
            ...readOptions,
            load: () => this.deps.getCheckoutDiff(normalizedCwd, normalizedOptions, {
                paseoHome: this.paseoHome,
                worktreesRoot: this.worktreesRoot,
            }),
        });
    }
    normalizeCheckoutDiffOptions(options) {
        return {
            mode: options.mode,
            ...(options.mode === "base" && options.baseRef !== undefined
                ? { baseRef: options.baseRef }
                : {}),
            ...(options.ignoreWhitespace === true ? { ignoreWhitespace: true } : {}),
            ...(options.includeStructured === true ? { includeStructured: true } : {}),
        };
    }
    invalidateCheckoutDiffCache(cwd, mode) {
        this.checkoutDiffCache.invalidate(cwd, mode);
    }
    validateBranchRef(cwd, ref, options) {
        this.assertNotDisposed();
        const normalizedCwd = resolve(cwd);
        const normalizedRef = ref.trim();
        const key = JSON.stringify(["branch-validation", normalizedCwd, normalizedRef]);
        return this.readAuxiliaryCache(this.branchValidationCache, key, options, () => this.deps.resolveBranchCheckout(normalizedCwd, normalizedRef));
    }
    hasLocalBranch(cwd, branch, options) {
        this.assertNotDisposed();
        const normalizedCwd = resolve(cwd);
        const normalizedBranch = branch.trim();
        const ref = `refs/heads/${normalizedBranch}`;
        const key = JSON.stringify(["local-branch", normalizedCwd, ref]);
        return this.readAuxiliaryCache(this.localBranchCache, key, options, async () => {
            const result = await this.deps.runGitCommand(["rev-parse", "--verify", "--quiet", ref], {
                cwd: normalizedCwd,
                envOverlay: READ_ONLY_GIT_ENV,
                acceptExitCodes: [0, 1],
            });
            return result.exitCode === 0;
        });
    }
    suggestBranchesForCwd(cwd, options, readOptions) {
        this.assertNotDisposed();
        const normalizedCwd = resolve(cwd);
        const query = options?.query ?? "";
        const limit = options?.limit;
        const key = JSON.stringify(["branch-suggestions", normalizedCwd, query, limit ?? null]);
        return this.readAuxiliaryCache(this.branchSuggestionsCache, key, readOptions, () => this.deps.listBranchSuggestions(normalizedCwd, options));
    }
    listStashes(cwd, options, readOptions) {
        this.assertNotDisposed();
        const normalizedCwd = resolve(cwd);
        const paseoOnly = options?.paseoOnly !== false;
        const key = JSON.stringify(["stashes", normalizedCwd, paseoOnly]);
        return this.readAuxiliaryCache(this.stashListCache, key, readOptions, async () => {
            const { stdout } = await this.deps.runGitCommand(["stash", "list", "--format=%gd%x00%s"], {
                cwd: normalizedCwd,
                envOverlay: READ_ONLY_GIT_ENV,
            });
            return parseWorkspaceGitStashList(stdout, { paseoOnly });
        });
    }
    async listWorktrees(cwdOrRepoRoot, options) {
        this.assertNotDisposed();
        const repoRoot = await this.resolveRepoRoot(cwdOrRepoRoot, options);
        const key = JSON.stringify(["worktrees", repoRoot]);
        return this.readAuxiliaryCache(this.worktreeListCache, key, options, () => this.deps.listPaseoWorktrees({
            cwd: repoRoot,
            paseoHome: this.paseoHome,
            worktreesRoot: this.worktreesRoot,
        }));
    }
    async resolveRepoRoot(cwd, options) {
        const snapshot = await this.getSnapshot(cwd, options);
        if (!snapshot.git.isGit) {
            throw new Error("Create worktree requires a git repository");
        }
        return snapshot.git.isPaseoOwnedWorktree
            ? (snapshot.git.mainRepoRoot ?? snapshot.git.repoRoot ?? resolve(cwd))
            : (snapshot.git.repoRoot ?? resolve(cwd));
    }
    async resolveDefaultBranch(cwdOrRepoRoot, options) {
        this.assertNotDisposed();
        const cwd = resolve(cwdOrRepoRoot);
        const key = JSON.stringify(["default-branch", cwd]);
        return this.readAuxiliaryCache(this.defaultBranchCache, key, options, async () => {
            const defaultBranch = await this.deps.resolveRepositoryDefaultBranch(cwd);
            if (!defaultBranch) {
                throw new Error("Unable to resolve repository default branch");
            }
            return defaultBranch;
        });
    }
    async getProjectSlug(cwd, options) {
        const snapshot = await this.getSnapshot(cwd, options);
        return deriveProjectSlug(resolve(cwd), snapshot.git.isGit ? snapshot.git.remoteUrl : null);
    }
    async resolveRepoRemoteUrl(cwd, options) {
        const snapshot = await this.getSnapshot(cwd, options);
        return snapshot.git.remoteUrl;
    }
    async refresh(cwd, _options) {
        this.assertNotDisposed();
        cwd = resolve(cwd);
        const target = this.ensureWorkspaceTarget(cwd);
        await this.refreshWorkspaceTarget(target, {
            force: false,
            refreshStructure: true,
            refreshWorktree: true,
            includeForge: false,
            reason: "refresh",
            notify: true,
            queueIfBusy: false,
            movedRemoteRefs: new Set(),
        });
        this.scheduleWorkspaceObservationSetup(target);
    }
    async requestWorkingTreeWatch(cwd, onChange) {
        this.assertNotDisposed();
        cwd = resolve(cwd);
        const target = await this.ensureWorkingTreeWatchTarget(cwd);
        target.listeners.add(onChange);
        return {
            repoRoot: target.repoRoot,
            unsubscribe: () => {
                this.removeWorkingTreeWatchListener(target.cwd, onChange);
            },
        };
    }
    scheduleRefreshForCwd(cwd) {
        this.assertNotDisposed();
        cwd = resolve(cwd);
        const target = this.workspaceTargets.get(cwd);
        if (target) {
            this.scheduleWorkspaceRefresh(target, { queueIfBusy: false });
        }
    }
    onWorkspaceStateMayHaveChanged(cwd) {
        this.assertNotDisposed();
        const normalizedCwd = resolve(cwd);
        // The cached lite checkout may be stale now; a refresh republishes it.
        // Bumping the generation retires any read already in flight, so it cannot
        // republish the facts this invalidation just retired. This holds even for a
        // directory no target has observed: its cached checkout is retired too.
        this.invalidateCachedCheckout(normalizedCwd);
        this.invalidateForge(normalizedCwd);
        const target = this.workspaceTargets.get(normalizedCwd);
        if (!target || target.closed) {
            return;
        }
        this.scheduleWorkspaceRefresh(target, {
            force: true,
            includeForge: true,
            reason: "external-state-change",
        });
    }
    /**
     * Drop the resolved forge adapter's cached state for a cwd. Goes through the
     * resolver so it targets the same adapter instance the poller reads — used by
     * git mutations to force a fresh forge status on the next refresh.
     */
    invalidateForge(cwd) {
        this.assertNotDisposed();
        this.forgeResolver.invalidate(resolve(cwd));
    }
    dispose() {
        if (this.disposePromise)
            return this.disposePromise;
        this.disposed = true;
        this.disposeController.abort(new WorkspaceGitServiceDisposedError());
        this.workspaceRefreshLimit.clearQueue();
        this.workspaceObservationSetupLimit.clearQueue();
        for (const target of this.workspaceTargets.values()) {
            this.closeWorkspaceTarget(target);
        }
        this.workspaceTargets.clear();
        for (const target of this.repoTargets.values()) {
            this.closeRepoTarget(target);
        }
        this.repoTargets.clear();
        for (const target of this.workingTreeWatchTargets.values()) {
            this.closeWorkingTreeWatchTarget(target);
        }
        this.workingTreeWatchTargets.clear();
        this.workingTreeWatchSetups.clear();
        this.workingTreeWatchResolutions.clear();
        this.workingTreeWatchAliases.clear();
        this.snapshotUpdatedListeners.clear();
        this.disposePromise = this.fileObserver.close();
        return this.disposePromise;
    }
    assertNotDisposed() {
        if (this.disposed) {
            throw new WorkspaceGitServiceDisposedError();
        }
    }
    ensureWorkspaceTarget(cwd) {
        this.assertNotDisposed();
        const existingTarget = this.workspaceTargets.get(cwd);
        if (existingTarget) {
            return existingTarget;
        }
        return this.createWorkspaceTarget(cwd);
    }
    readAuxiliaryCache(cache, key, options, load) {
        this.assertNotDisposed();
        if (options?.force && !options.reason) {
            throw new Error("WorkspaceGitService forced read requires a reason");
        }
        const entry = this.ensureAuxiliaryCacheEntry(cache, key);
        const nowMs = this.deps.now().getTime();
        if (!options?.force && entry.value !== null && entry.loadedAtMs !== null) {
            const ageMs = nowMs - entry.loadedAtMs;
            if (ageMs <= WORKSPACE_GIT_AUXILIARY_READ_TTL_MS) {
                return Promise.resolve(entry.value);
            }
            if (entry.lastShellOutAtMs !== null &&
                nowMs - entry.lastShellOutAtMs < WORKSPACE_GIT_INTERNAL_MIN_GAP_MS) {
                return Promise.resolve(entry.value);
            }
        }
        if (entry.inFlight) {
            return entry.inFlight;
        }
        entry.lastShellOutAtMs = nowMs;
        entry.inFlight = load()
            .then((value) => {
            entry.value = value;
            entry.loadedAtMs = this.deps.now().getTime();
            return value;
        })
            .finally(() => {
            entry.inFlight = null;
        });
        return entry.inFlight;
    }
    ensureAuxiliaryCacheEntry(cache, key) {
        const existing = cache.get(key);
        if (existing) {
            return existing;
        }
        const entry = {
            value: null,
            loadedAtMs: null,
            lastShellOutAtMs: null,
            inFlight: null,
        };
        cache.set(key, entry);
        return entry;
    }
    ensureWorkingTreeWatchTarget(cwd) {
        this.assertNotDisposed();
        const targetCwd = this.workingTreeWatchAliases.get(cwd);
        if (targetCwd) {
            const existingTarget = this.workingTreeWatchTargets.get(targetCwd);
            if (existingTarget) {
                return Promise.resolve(existingTarget);
            }
            this.workingTreeWatchAliases.delete(cwd);
        }
        const existingResolution = this.workingTreeWatchResolutions.get(cwd);
        if (existingResolution) {
            return existingResolution;
        }
        const resolution = this.resolveWorkingTreeWatchTarget(cwd).finally(() => {
            if (this.workingTreeWatchResolutions.get(cwd) === resolution) {
                this.workingTreeWatchResolutions.delete(cwd);
            }
        });
        this.workingTreeWatchResolutions.set(cwd, resolution);
        return resolution;
    }
    async resolveWorkingTreeWatchTarget(cwd) {
        const repoRoot = await this.resolveCheckoutWatchRoot(cwd);
        const targetCwd = repoRoot ?? cwd;
        const existingTarget = this.workingTreeWatchTargets.get(targetCwd);
        if (existingTarget) {
            this.rememberWorkingTreeWatchAlias(existingTarget, cwd);
            return existingTarget;
        }
        const existingSetup = this.workingTreeWatchSetups.get(targetCwd);
        if (existingSetup) {
            const target = await existingSetup;
            this.rememberWorkingTreeWatchAlias(target, cwd);
            return target;
        }
        const watchPath = repoRoot && createRealpathAwarePathMatcher(repoRoot)(cwd) ? cwd : targetCwd;
        const setup = this.createWorkingTreeWatchTarget(targetCwd, watchPath, repoRoot).finally(() => {
            if (this.workingTreeWatchSetups.get(targetCwd) === setup) {
                this.workingTreeWatchSetups.delete(targetCwd);
            }
        });
        this.workingTreeWatchSetups.set(targetCwd, setup);
        const target = await setup;
        this.rememberWorkingTreeWatchAlias(target, cwd);
        return target;
    }
    rememberWorkingTreeWatchAlias(target, cwd) {
        target.aliases.add(cwd);
        this.workingTreeWatchAliases.set(cwd, target.cwd);
    }
    createWorkspaceTarget(cwd) {
        const target = {
            cwd,
            listeners: new Set(),
            workingTreeWatchTarget: null,
            debounceTimer: null,
            pendingDebounceRequest: null,
            observationReensureTimer: null,
            forgePrStatusPollSubscription: null,
            forgePrStatusPollKey: null,
            refreshState: { status: "idle" },
            latestGit: null,
            latestGitLoadedAtMs: null,
            latestForge: null,
            latestForgeLoadedAtMs: null,
            latestSnapshot: null,
            latestSnapshotLoadedAtMs: null,
            latestFacts: null,
            factsPromise: null,
            latestFingerprint: null,
            lastShellOutAtMs: null,
            repoGitRoot: null,
            observationSetupPromise: null,
            observationSetupComplete: false,
            closed: false,
        };
        this.workspaceTargets.set(cwd, target);
        return target;
    }
    scheduleInitialWorkspaceRefresh(target) {
        queueMicrotask(() => {
            if (!this.isActiveObservedWorkspaceTarget(target) || target.latestSnapshot) {
                return;
            }
            void this.refreshWorkspaceTarget(target, {
                force: false,
                refreshStructure: true,
                refreshWorktree: true,
                includeForge: true,
                reason: "initial",
                notify: true,
                queueIfBusy: false,
                movedRemoteRefs: new Set(),
            });
        });
    }
    scheduleWorkspaceObservationSetup(target) {
        if (target.observationSetupComplete ||
            target.observationSetupPromise ||
            !this.isActiveObservedWorkspaceTarget(target)) {
            return;
        }
        target.observationSetupPromise = this.workspaceObservationSetupLimit(async () => {
            if (!this.isActiveObservedWorkspaceTarget(target)) {
                return;
            }
            await this.setupWorkspaceObservation(target);
        })
            .catch((error) => {
            if (this.disposed || !this.isActiveObservedWorkspaceTarget(target)) {
                return;
            }
            this.logger.warn({ err: error, cwd: target.cwd }, "Failed to set up workspace git observation");
        })
            .finally(() => {
            target.observationSetupPromise = null;
        });
    }
    async setupWorkspaceObservation(target) {
        const facts = await this.getFactsForObservation(target);
        if (!this.isActiveObservedWorkspaceTarget(target)) {
            return;
        }
        const watchCwd = facts.isGit ? facts.worktreeRoot : target.cwd;
        const workingTreeTargetPromise = this.ensureWorkingTreeWatchTarget(watchCwd);
        const workingTreeTarget = await workingTreeTargetPromise;
        if (!this.isActiveObservedWorkspaceTarget(target)) {
            queueMicrotask(() => this.closeWorkingTreeWatchTargetIfUnused(workingTreeTarget));
            return;
        }
        if (target.workingTreeWatchTarget !== workingTreeTarget) {
            if (target.workingTreeWatchTarget) {
                this.removeWorkspaceWorkingTreeLink(target.workingTreeWatchTarget, target.cwd);
            }
            target.workingTreeWatchTarget = workingTreeTarget;
        }
        workingTreeTarget.workspaceKeys.add(target.cwd);
        if (!facts.isGit || !facts.absoluteGitDir) {
            target.observationSetupComplete = true;
            return;
        }
        await this.promoteWorkingTreeWatchTarget(workingTreeTarget, facts.worktreeRoot);
        const gitDir = facts.absoluteGitDir;
        const repoGitRoot = facts.gitCommonDir ?? (await this.resolveWorkspaceGitRefsRoot(gitDir));
        if (!this.isActiveObservedWorkspaceTarget(target)) {
            return;
        }
        target.repoGitRoot = repoGitRoot;
        await this.ensureRepoTarget(target);
        if (this.isActiveObservedWorkspaceTarget(target)) {
            target.observationSetupComplete = true;
        }
    }
    async getFactsForObservation(target) {
        if (target.latestFacts) {
            return target.latestFacts;
        }
        return this.loadCheckoutFacts(target, {
            paseoHome: this.paseoHome,
            logger: this.logger,
        });
    }
    loadCheckoutFacts(target, context) {
        if (target.factsPromise) {
            return target.factsPromise;
        }
        const promise = this.deps
            .getCheckoutSnapshotFacts(target.cwd, context)
            .then((facts) => {
            target.latestFacts = facts;
            return facts;
        })
            .finally(() => {
            if (target.factsPromise === promise) {
                target.factsPromise = null;
            }
        });
        target.factsPromise = promise;
        return promise;
    }
    isActiveObservedWorkspaceTarget(target) {
        return (!target.closed &&
            target.listeners.size > 0 &&
            this.workspaceTargets.get(target.cwd) === target);
    }
    async createWorkingTreeWatchTarget(cwd, watchPath, repoRoot) {
        const ignoredDirectories = repoRoot
            ? (await this.loadIgnoredDirs(watchPath)).ignored
            : new Set();
        const target = {
            cwd,
            watchPath,
            repoRoot,
            subscription: null,
            ignoredDirectories,
            appliedIgnoreList: [],
            ignoredDirectoriesRefreshPromise: null,
            ignoredDirectoriesRefreshRequested: false,
            knownDirectories: new Set(),
            pendingKnownDirectories: new Set(),
            ignoreRefreshTimer: null,
            ignoreRefreshDeadlineMs: null,
            aliases: new Set([cwd]),
            workspaceKeys: new Set(),
            fallbackPolling: false,
            fallbackPollTimer: null,
            fallbackPollQuietTickCount: 0,
            recovery: { attemptCount: 0, timer: null, establishedAt: null },
            listeners: new Set(),
            closed: false,
        };
        this.workingTreeWatchTargets.set(cwd, target);
        this.workingTreeWatchAliases.set(cwd, cwd);
        await this.startWorkingTreeSubscription(target);
        this.assertNotDisposed();
        if (repoRoot === null) {
            this.startWorkingTreeWatchFallback(target, "not_a_git_checkout");
        }
        return target;
    }
    async subscribeWithDeadline(watchPath, callback, options, onSubscribeSettled) {
        this.assertNotDisposed();
        const signal = this.disposeController.signal;
        let outcome = "pending";
        let timeout = null;
        let removeAbortListener = () => { };
        let unsubscribePromise = null;
        let subscriptionPromise;
        try {
            subscriptionPromise = this.deps
                .subscribe(watchPath, callback, options)
                .finally(onSubscribeSettled);
        }
        catch (error) {
            onSubscribeSettled();
            throw error;
        }
        void subscriptionPromise.then((subscription) => {
            if (outcome === "expired" || signal.aborted) {
                unsubscribePromise ?? (unsubscribePromise = this.unsubscribeWatcherSubscription(subscription, watchPath));
                return unsubscribePromise;
            }
            return undefined;
        }, () => undefined);
        const timeoutPromise = new Promise((_resolve, reject) => {
            timeout = setTimeout(() => {
                outcome = "expired";
                reject(new WorkspaceGitWatcherSubscriptionTimeoutError(watchPath));
            }, WORKSPACE_GIT_WATCHER_SUBSCRIBE_TIMEOUT_MS);
        });
        const disposalPromise = new Promise((_resolve, reject) => {
            const rejectForDisposal = () => {
                outcome = "expired";
                reject(signal.reason);
            };
            if (signal.aborted) {
                rejectForDisposal();
                return;
            }
            signal.addEventListener("abort", rejectForDisposal, { once: true });
            removeAbortListener = () => signal.removeEventListener("abort", rejectForDisposal);
        });
        try {
            const subscription = await Promise.race([
                subscriptionPromise,
                timeoutPromise,
                disposalPromise,
            ]);
            if (signal.aborted) {
                outcome = "expired";
                unsubscribePromise ?? (unsubscribePromise = this.unsubscribeWatcherSubscription(subscription, watchPath));
                await unsubscribePromise;
                throw signal.reason;
            }
            outcome = "accepted";
            return subscription;
        }
        finally {
            if (outcome === "pending") {
                outcome = "expired";
            }
            if (timeout) {
                clearTimeout(timeout);
            }
            removeAbortListener();
        }
    }
    async unsubscribeWatcherSubscription(subscription, watchPath) {
        try {
            await subscription.unsubscribe();
        }
        catch (error) {
            this.logger.warn({ err: error, watchPath }, "Failed to stop watcher subscription");
        }
    }
    // Shared by startWorkingTreeSubscription and
    // replaceWorkingTreeIgnoredDirectories's applied-vs-desired gate so both
    // compute the same resolved ignore list.
    workingTreeIgnoreList(target) {
        return [join(target.watchPath, ".git"), ...target.ignoredDirectories];
    }
    async startWorkingTreeSubscription(target, options) {
        const ignore = this.workingTreeIgnoreList(target);
        let watcherErrored = false;
        let subscribeSettled = false;
        const markSubscribeSettled = () => {
            subscribeSettled = true;
            if (watcherErrored) {
                this.scheduleWorkingTreeWatchRecovery(target);
            }
        };
        try {
            const subscription = await this.subscribeWithDeadline(target.watchPath, (error, events) => {
                if (error) {
                    if (watcherErrored) {
                        return;
                    }
                    watcherErrored = true;
                    this.watcherErrorCallbackCount += 1;
                    this.logger.warn({ err: error, cwd: target.cwd }, "Working tree watcher error; using degraded polling");
                    this.degradeWorkingTreeWatch(target, "watcher_error");
                    if (subscribeSettled) {
                        this.scheduleWorkingTreeWatchRecovery(target);
                    }
                    return;
                }
                if (watcherErrored) {
                    return;
                }
                const discovered = this.noteWorkingTreeDirectories(target, events);
                if (events.some((event) => basename(event.path) === ".gitignore")) {
                    void this.refreshWorkingTreeIgnoredDirectories(target);
                }
                else if (discovered) {
                    this.scheduleWorkingTreeIgnoreRefresh(target);
                }
                if (!this.hasRelevantWorkingTreeEvent(target, events)) {
                    return;
                }
                this.notifyWorkingTreeChanged(target, "working-tree-watch");
            }, { ignore }, markSubscribeSettled);
            if (watcherErrored) {
                await this.unsubscribeWatcherSubscription(subscription, target.watchPath);
                return false;
            }
            if (target.closed ||
                (target.fallbackPolling && !options?.replaceFallback) ||
                target.subscription) {
                await this.unsubscribeWatcherSubscription(subscription, target.watchPath);
                return false;
            }
            target.subscription = subscription;
            target.appliedIgnoreList = ignore;
            // Do not reset `attemptCount` here — `subscribe()` resolving proves
            // nothing about the watcher's health on a filesystem where it errors on
            // first use. Record when this subscription was established instead;
            // `scheduleWorkingTreeWatchRecovery` only resets the ladder once this
            // one has survived long enough to prove itself durable.
            target.recovery.establishedAt = this.deps.now().getTime();
            if (options?.replaceFallback && target.repoRoot !== null) {
                target.fallbackPolling = false;
                if (target.fallbackPollTimer) {
                    clearTimeout(target.fallbackPollTimer);
                    target.fallbackPollTimer = null;
                }
            }
            return true;
        }
        catch (error) {
            if (watcherErrored) {
                return false;
            }
            if (this.disposed || target.closed) {
                throw error;
            }
            this.logger.warn({ err: error, cwd: target.cwd }, "Failed to start working tree watcher; using degraded polling");
            if (!options?.replaceFallback) {
                this.startWorkingTreeWatchFallback(target, "watcher_setup_failed");
            }
            return false;
        }
    }
    degradedPollDelayMs(quietTickCount) {
        return Math.min(DEGRADED_GIT_POLL_MAX_INTERVAL_MS, DEGRADED_GIT_POLL_INTERVAL_MS * 2 ** quietTickCount);
    }
    // A refresh that throws is swallowed by refreshWorkspaceTarget and leaves the fingerprint
    // alone, so it reads as a quiet tick and widens the gap. That is the intended outcome: a
    // repository whose Git commands keep failing is the last one to retry every 5 seconds.
    async refreshDegradedPollTarget(workspaceTarget, request) {
        const fingerprintBefore = workspaceTarget.latestFingerprint;
        await this.refreshWorkspaceTarget(workspaceTarget, request);
        return workspaceTarget.latestFingerprint !== fingerprintBefore;
    }
    startWorkingTreeWatchFallback(target, reason) {
        if (this.disposed || target.closed || target.fallbackPolling) {
            return;
        }
        target.fallbackPolling = true;
        target.fallbackPollQuietTickCount = 0;
        const { cwd } = target;
        const poll = async () => {
            target.fallbackPollTimer = null;
            if (target.closed || this.workingTreeWatchTargets.get(target.cwd) !== target) {
                return;
            }
            const changes = await Promise.all(Array.from(target.workspaceKeys, async (workspaceKey) => {
                const workspaceTarget = this.workspaceTargets.get(workspaceKey);
                if (!workspaceTarget) {
                    return false;
                }
                const changed = await this.refreshDegradedPollTarget(workspaceTarget, {
                    force: false,
                    refreshStructure: target.repoRoot === null,
                    refreshWorktree: true,
                    includeForge: false,
                    reason: "working-tree-watch-fallback",
                    notify: true,
                    queueIfBusy: true,
                    movedRemoteRefs: new Set(),
                });
                if (target.repoRoot === null && workspaceTarget.latestGit?.isGit === true) {
                    workspaceTarget.observationSetupComplete = false;
                    this.scheduleWorkspaceObservationSetup(workspaceTarget);
                }
                return changed;
            }));
            this.notifyWorkingTreeConsumers(target);
            if (!target.closed && (target.subscription === null || target.repoRoot === null)) {
                target.fallbackPollQuietTickCount = changes.some(Boolean)
                    ? 0
                    : target.fallbackPollQuietTickCount + 1;
                target.fallbackPollTimer = setTimeout(poll, this.degradedPollDelayMs(target.fallbackPollQuietTickCount));
            }
            else {
                target.fallbackPolling = false;
            }
        };
        target.fallbackPollTimer = setTimeout(poll, DEGRADED_GIT_POLL_INTERVAL_MS);
        this.logger.warn({
            cwd,
            intervalMs: DEGRADED_GIT_POLL_INTERVAL_MS,
            maxIntervalMs: DEGRADED_GIT_POLL_MAX_INTERVAL_MS,
            reason,
        }, "Working tree watcher unavailable; using bounded polling fallback");
    }
    degradeWorkingTreeWatch(target, reason) {
        const subscription = target.subscription;
        target.subscription = null;
        if (subscription) {
            void this.unsubscribeWatcherSubscription(subscription, target.watchPath);
        }
        this.notifyWorkingTreeChanged(target, "working-tree-watch-error");
        this.startWorkingTreeWatchFallback(target, reason);
    }
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
    advanceWatchRecoveryLadder(recovery) {
        if (recovery.establishedAt !== null &&
            this.deps.now().getTime() - recovery.establishedAt >= WATCH_RECOVERY_MAX_DELAY_MS) {
            recovery.attemptCount = 0;
        }
        recovery.establishedAt = null;
        recovery.attemptCount += 1;
        return Math.min(WATCH_RECOVERY_BASE_DELAY_MS *
            2 ** Math.min(recovery.attemptCount - 1, WATCH_RECOVERY_MAX_BACKOFF_STEPS), WATCH_RECOVERY_MAX_DELAY_MS);
    }
    scheduleWorkingTreeWatchRecovery(target) {
        if (target.closed || target.subscription || target.recovery.timer) {
            return;
        }
        const delayMs = this.advanceWatchRecoveryLadder(target.recovery);
        target.recovery.timer = setTimeout(() => {
            target.recovery.timer = null;
            void this.recoverWorkingTreeWatch(target);
        }, delayMs);
    }
    async recoverWorkingTreeWatch(target) {
        if (target.closed || target.subscription) {
            return;
        }
        await this.refreshWorkingTreeIgnoredDirectories(target);
        if (target.closed || target.subscription) {
            return;
        }
        const recovered = await this.startWorkingTreeSubscription(target, { replaceFallback: true });
        if (!recovered) {
            this.scheduleWorkingTreeWatchRecovery(target);
            return;
        }
        this.logger.info({ cwd: target.cwd }, "Working tree watcher recovered");
        this.notifyWorkingTreeChanged(target, "working-tree-watch-recovered");
    }
    async promoteWorkingTreeWatchTarget(target, repoRoot) {
        if (target.repoRoot !== null) {
            return;
        }
        target.repoRoot = repoRoot;
        if (target.subscription && target.fallbackPolling) {
            target.fallbackPolling = false;
            if (target.fallbackPollTimer) {
                clearTimeout(target.fallbackPollTimer);
                target.fallbackPollTimer = null;
            }
        }
        await this.refreshWorkingTreeIgnoredDirectories(target);
    }
    /**
     * `git ls-files` reports ignored directories only once they exist, so the
     * ignore set must be re-read when new directory topology appears — not only
     * when the rules change. Keyed on `dirname` because FSEvents coalescing makes
     * the directory's own creation event unreliable; a file inside it proves it
     * exists either way.
     */
    noteWorkingTreeDirectories(target, events) {
        if (target.repoRoot === null) {
            return false;
        }
        this.removeDeletedKnownDirectories(target, events);
        const gitDir = join(target.watchPath, ".git");
        // `matchesWatchPath` is realpath-aware because it compares an event-reported
        // directory against `target.watchPath` itself — a config-time root that can
        // legitimately differ from the watcher's reported form (e.g. a symlinked
        // temp dir). It is now gated behind the plain Set lookup below, so it only
        // runs for a directory this target has never seen before, not on every
        // event.
        const matchesWatchPath = createRealpathAwarePathMatcher(target.watchPath);
        // One new directory is enough: the scheduled Git query inventories every
        // ignored directory that exists by then. Stop before a large event batch
        // multiplies containment checks across all its new directories.
        for (const event of events) {
            const directory = dirname(event.path);
            // Cheap Set lookup first — the steady-state case where the directory is
            // already known must never reach the realpath-aware matcher below.
            if (target.knownDirectories.has(directory) || matchesWatchPath(directory)) {
                continue;
            }
            // `directory` and `gitDir`/`ignoredDirectory` all derive from the same
            // `target.watchPath` used to build this subscription, and `directory`
            // itself is the same `dirname(event.path)` value already trusted as a
            // plain string key by `target.knownDirectories.has()` above — no realpath
            // resolution needed for containment among values from this one source.
            if (!isPathInsideRoot(target.watchPath, directory)) {
                continue;
            }
            if (isPathInsideRoot(gitDir, directory)) {
                continue;
            }
            let ignored = false;
            for (const ignoredDirectory of target.ignoredDirectories) {
                if (isPathInsideRoot(ignoredDirectory, directory)) {
                    ignored = true;
                    break;
                }
            }
            if (ignored) {
                continue;
            }
            target.knownDirectories.add(directory);
            target.pendingKnownDirectories.add(directory);
            this.enforceKnownDirectoriesCap(target);
            return true;
        }
        return false;
    }
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
    removeDeletedKnownDirectories(target, events) {
        if (target.knownDirectories.size === 0) {
            return;
        }
        for (const event of events) {
            if (event.type !== "delete" || !target.knownDirectories.has(event.path)) {
                continue;
            }
            for (const directory of target.knownDirectories) {
                if (!isPathInsideRoot(event.path, directory)) {
                    continue;
                }
                target.knownDirectories.delete(directory);
                // Not required for correctness — both refresh outcomes tolerate a
                // stale entry that no longer resolves to anything live: a
                // successful refresh clears `pendingKnownDirectories` outright, and
                // a failed one's `rearmPendingKnownDirectories` no-ops a delete of
                // an already-absent key. Dropping it here keeps
                // `pendingKnownDirectories` a subset of `knownDirectories` at all
                // times instead of "true except right after a deletion."
                target.pendingKnownDirectories.delete(directory);
            }
        }
    }
    /**
     * See `WORKING_TREE_KNOWN_DIRECTORIES_MAX` for why clearing on overflow is
     * always safe. Runs only when this batch discovered at least one new
     * directory, since that is the only way `knownDirectories` grows.
     */
    enforceKnownDirectoriesCap(target) {
        if (target.knownDirectories.size <= WORKING_TREE_KNOWN_DIRECTORIES_MAX) {
            return;
        }
        target.knownDirectories.clear();
        target.pendingKnownDirectories.clear();
    }
    scheduleWorkingTreeIgnoreRefresh(target) {
        if (this.disposed || target.closed || target.repoRoot === null) {
            return;
        }
        const now = this.deps.now().getTime();
        target.ignoreRefreshDeadlineMs ?? (target.ignoreRefreshDeadlineMs = now + WORKING_TREE_IGNORE_REFRESH_MAX_DELAY_MS);
        if (target.ignoreRefreshTimer) {
            clearTimeout(target.ignoreRefreshTimer);
        }
        const delayMs = Math.max(0, Math.min(WORKING_TREE_IGNORE_REFRESH_QUIET_MS, target.ignoreRefreshDeadlineMs - now));
        target.ignoreRefreshTimer = setTimeout(() => {
            target.ignoreRefreshTimer = null;
            target.ignoreRefreshDeadlineMs = null;
            void this.refreshWorkingTreeIgnoredDirectories(target);
        }, delayMs);
    }
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
    pruneKnownDirectories(target) {
        if (target.ignoredDirectories.size === 0) {
            return;
        }
        const foldCase = looksLikeDefiniteWindowsPath(target.watchPath);
        const comparable = (path) => foldCase ? path.replaceAll("\\", "/").toLowerCase() : path;
        const ignoredPrefixes = [];
        const foldedIgnoredExact = foldCase ? new Set() : null;
        for (const ignoredDirectory of target.ignoredDirectories) {
            const ignored = comparable(ignoredDirectory);
            ignoredPrefixes.push(`${ignored}/`);
            foldedIgnoredExact?.add(ignored);
        }
        for (const directory of target.knownDirectories) {
            const comparableDirectory = comparable(directory);
            const comparableDirectoryWithSep = `${comparableDirectory}/`;
            const isIgnored = (foldedIgnoredExact ?? target.ignoredDirectories).has(comparableDirectory) ||
                ignoredPrefixes.some((prefix) => comparableDirectoryWithSep.startsWith(prefix));
            if (isIgnored) {
                target.knownDirectories.delete(directory);
            }
        }
    }
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
    rearmPendingKnownDirectories(target) {
        if (target.pendingKnownDirectories.size === 0) {
            return;
        }
        for (const directory of target.pendingKnownDirectories) {
            target.knownDirectories.delete(directory);
        }
        target.pendingKnownDirectories.clear();
    }
    hasRelevantWorkingTreeEvent(target, events) {
        const gitDir = join(target.watchPath, ".git");
        const matchesWatchPath = createRealpathAwarePathMatcher(target.watchPath);
        return events.some((event) => {
            // Directory metadata changes at the watch root do not change Git state.
            // FSEvents may emit these when every changed descendant was ignored.
            if (matchesWatchPath(event.path)) {
                return false;
            }
            if (isRealpathInsideRoot(gitDir, event.path)) {
                return false;
            }
            for (const ignoredDirectory of target.ignoredDirectories) {
                if (isRealpathInsideRoot(ignoredDirectory, event.path)) {
                    return false;
                }
            }
            return true;
        });
    }
    refreshWorkingTreeIgnoredDirectories(target) {
        if (target.closed || target.repoRoot === null) {
            return Promise.resolve();
        }
        target.ignoredDirectoriesRefreshRequested = true;
        if (target.ignoredDirectoriesRefreshPromise) {
            return target.ignoredDirectoriesRefreshPromise;
        }
        const refreshPromise = (async () => {
            while (!target.closed && target.ignoredDirectoriesRefreshRequested) {
                target.ignoredDirectoriesRefreshRequested = false;
                try {
                    await this.replaceWorkingTreeIgnoredDirectories(target);
                }
                catch (error) {
                    this.logger.warn({ err: error, cwd: target.cwd }, "Failed to refresh working tree watcher ignore paths");
                }
            }
        })().finally(() => {
            if (target.ignoredDirectoriesRefreshPromise === refreshPromise) {
                target.ignoredDirectoriesRefreshPromise = null;
            }
        });
        target.ignoredDirectoriesRefreshPromise = refreshPromise;
        return refreshPromise;
    }
    async replaceWorkingTreeIgnoredDirectories(target) {
        const { ignored: ignoredDirectories, failed } = await this.loadIgnoredDirs(target.watchPath, target.ignoredDirectories);
        if (target.closed) {
            return;
        }
        if (failed) {
            // A failed `git ls-files` must not leave directories discovered since
            // the last completed refresh permanently marked known — see the
            // `pendingKnownDirectories` field comment. Re-arm them so the next
            // event under any of them is treated as unseen again and schedules
            // another refresh attempt.
            this.rearmPendingKnownDirectories(target);
        }
        else {
            target.pendingKnownDirectories.clear();
        }
        if (!this.haveSamePaths(target.ignoredDirectories, ignoredDirectories)) {
            target.ignoredDirectories = ignoredDirectories;
            this.pruneKnownDirectories(target);
        }
        if (target.fallbackPolling) {
            return;
        }
        const subscription = target.subscription;
        if (!subscription) {
            return;
        }
        // Compare against the resolved list the live subscription actually
        // accepted (`appliedIgnoreList`), not what git last reported
        // (`ignoredDirectories` alone) — the comparison and the value passed to
        // `updateIgnore` have to be the same array, or a skipped update would
        // otherwise latch forever.
        const next = this.workingTreeIgnoreList(target);
        if (this.haveSamePaths(new Set(target.appliedIgnoreList), new Set(next))) {
            return;
        }
        try {
            await subscription.updateIgnore(next);
            target.appliedIgnoreList = next;
        }
        catch (error) {
            target.subscription = null;
            if (!target.closed && !target.fallbackPolling) {
                this.startWorkingTreeWatchFallback(target, "watcher_update_failed");
                this.scheduleWorkingTreeWatchRecovery(target);
            }
            this.logger.warn({ err: error, cwd: target.cwd }, "Failed to update working tree watcher ignore paths");
            return;
        }
        if (target.closed || target.fallbackPolling) {
            return;
        }
        this.notifyWorkingTreeChanged(target, "working-tree-watch-reconfigured");
    }
    haveSamePaths(first, second) {
        if (first.size !== second.size) {
            return false;
        }
        for (const path of first) {
            if (!second.has(path)) {
                return false;
            }
        }
        return true;
    }
    notifyWorkingTreeChanged(target, reason) {
        if (target.closed) {
            return;
        }
        this.notifyWorkingTreeConsumers(target);
        this.scheduleWorkingTreeRefreshes(target, reason);
    }
    notifyWorkingTreeConsumers(target) {
        for (const alias of target.aliases) {
            this.invalidateCheckoutDiffCache(alias, "uncommitted");
        }
        for (const listener of target.listeners) {
            listener();
        }
    }
    scheduleWorkingTreeRefreshes(target, reason) {
        for (const workspaceKey of target.workspaceKeys) {
            const workspaceTarget = this.workspaceTargets.get(workspaceKey);
            if (workspaceTarget) {
                this.scheduleWorkspaceRefresh(workspaceTarget, { scope: "worktree", reason });
            }
        }
    }
    getWorkingTreeWatchTargetForWorkspace(workspaceTarget) {
        const target = workspaceTarget.workingTreeWatchTarget;
        return target && !target.closed ? target : null;
    }
    async resolveCheckoutWatchRoot(cwd) {
        try {
            const { stdout } = await this.deps.runGitCommand(["rev-parse", "--show-toplevel"], {
                cwd,
                envOverlay: READ_ONLY_GIT_ENV,
            });
            return parseGitRevParsePath(stdout);
        }
        catch {
            return null;
        }
    }
    async resolveWorkspaceGitRefsRoot(gitDir) {
        try {
            const commonDir = (await readFile(join(gitDir, "commondir"), "utf8")).trim();
            if (commonDir.length > 0) {
                return resolve(gitDir, commonDir);
            }
        }
        catch {
            return gitDir;
        }
        return gitDir;
    }
    async ensureRepoTarget(workspaceTarget) {
        const repoGitRoot = workspaceTarget.repoGitRoot;
        if (!repoGitRoot || !this.isActiveObservedWorkspaceTarget(workspaceTarget)) {
            return;
        }
        const existingTarget = this.repoTargets.get(repoGitRoot);
        if (existingTarget) {
            existingTarget.workspaceKeys.add(workspaceTarget.cwd);
            return;
        }
        const repoTarget = {
            repoGitRoot,
            cwd: workspaceTarget.cwd,
            workspaceKeys: new Set([workspaceTarget.cwd]),
            subscription: null,
            fallbackPolling: false,
            fallbackPollTimer: null,
            fallbackPollQuietTickCount: 0,
            recovery: { attemptCount: 0, timer: null, establishedAt: null },
            intervalId: null,
            fetchInFlight: false,
            bufferedFetchMetadataEvents: [],
            recentFetchRemoteRefChanges: new Map(),
            knownRemoteRefs: null,
            closed: false,
        };
        this.repoTargets.set(repoGitRoot, repoTarget);
        await this.startRepoMetadataObservation(repoTarget);
        if (repoTarget.closed || this.repoTargets.get(repoGitRoot) !== repoTarget) {
            return;
        }
        const fetchWorkspaceTarget = Array.from(repoTarget.workspaceKeys)
            .map((workspaceKey) => this.workspaceTargets.get(workspaceKey))
            .find((candidate) => candidate !== undefined && this.isActiveObservedWorkspaceTarget(candidate));
        if (!fetchWorkspaceTarget) {
            return;
        }
        repoTarget.cwd = fetchWorkspaceTarget.cwd;
        const facts = fetchWorkspaceTarget.latestFacts;
        const hasOrigin = facts?.isGit === true
            ? facts.remoteUrl !== null
            : await this.deps.hasOriginRemote(fetchWorkspaceTarget.cwd);
        if (repoTarget.closed || this.repoTargets.get(repoGitRoot) !== repoTarget) {
            return;
        }
        if (!hasOrigin) {
            return;
        }
        repoTarget.intervalId = setInterval(() => {
            void this.runRepoFetch(repoTarget);
        }, BACKGROUND_GIT_FETCH_INTERVAL_MS);
        void this.runRepoFetch(repoTarget);
    }
    async startRepoMetadataObservation(target, options) {
        const ignore = getPrunedGitMetadataPaths("common").map((path) => join(target.repoGitRoot, path));
        const matchesRepoGitRoot = createRealpathAwarePathMatcher(target.repoGitRoot);
        const canary = this.deps.createWatcherLivenessCanary(target.repoGitRoot);
        let openedSubscription = null;
        let watcherErrored = false;
        let subscribeSettled = false;
        const markSubscribeSettled = () => {
            subscribeSettled = true;
            if (watcherErrored) {
                this.scheduleRepoMetadataWatchRecovery(target);
            }
        };
        try {
            const subscription = await this.subscribeWithDeadline(target.repoGitRoot, (error, events) => {
                const liveEvents = canary.filterEvents(events);
                if (error) {
                    if (watcherErrored) {
                        return;
                    }
                    watcherErrored = true;
                    this.watcherErrorCallbackCount += 1;
                    this.logger.warn({ err: error, repoGitRoot: target.repoGitRoot }, "Repository metadata watcher error; using degraded polling");
                    this.degradeRepoMetadataWatch(target);
                    if (subscribeSettled) {
                        this.scheduleRepoMetadataWatchRecovery(target);
                    }
                    return;
                }
                if (watcherErrored) {
                    return;
                }
                if (liveEvents.length === 0) {
                    return;
                }
                const relevantEvents = liveEvents.filter((event) => !matchesRepoGitRoot(event.path) &&
                    ignore.every((ignoredPath) => !isRealpathInsideRoot(ignoredPath, event.path)));
                if (relevantEvents.length > 0) {
                    const immediateEvents = target.fetchInFlight
                        ? relevantEvents.filter((event) => {
                            if (this.isFetchRemoteMetadataEvent(target, event)) {
                                target.bufferedFetchMetadataEvents.push(event);
                                return false;
                            }
                            return true;
                        })
                        : relevantEvents;
                    if (immediateEvents.length > 0) {
                        this.refreshWorkingTreeIgnoresFromRepoMetadataEvents(target, immediateEvents);
                        const routedRefreshes = this.routeRepoMetadataEvents(target, immediateEvents);
                        this.scheduleRepoMetadataRefresh(target, "git-metadata-watch", routedRefreshes === null || [...routedRefreshes.values()].some((r) => r.structural), routedRefreshes);
                    }
                }
            }, { ignore }, markSubscribeSettled);
            openedSubscription = subscription;
            await canary.verify(this.disposeController.signal);
            if (watcherErrored) {
                await this.unsubscribeWatcherSubscription(subscription, target.repoGitRoot);
                return false;
            }
            if (target.closed ||
                (target.fallbackPolling && !options?.replaceFallback) ||
                this.repoTargets.get(target.repoGitRoot) !== target) {
                await this.unsubscribeWatcherSubscription(subscription, target.repoGitRoot);
                return false;
            }
            target.subscription = subscription;
            // See `advanceWatchRecoveryLadder`: do not reset `attemptCount` on
            // subscribe success alone, only record when this subscription was
            // established.
            target.recovery.establishedAt = this.deps.now().getTime();
            if (options?.replaceFallback) {
                target.fallbackPolling = false;
                if (target.fallbackPollTimer) {
                    clearTimeout(target.fallbackPollTimer);
                    target.fallbackPollTimer = null;
                }
            }
            return true;
        }
        catch (error) {
            if (openedSubscription) {
                await this.unsubscribeWatcherSubscription(openedSubscription, target.repoGitRoot);
            }
            if (watcherErrored) {
                return false;
            }
            if (this.disposed || target.closed) {
                throw error;
            }
            this.logger.warn({ err: error, repoGitRoot: target.repoGitRoot }, "Failed to start repository metadata watcher; using degraded polling");
            if (!options?.replaceFallback) {
                this.startRepoMetadataFallback(target);
            }
            return false;
        }
    }
    degradeRepoMetadataWatch(target) {
        const subscription = target.subscription;
        target.subscription = null;
        if (subscription) {
            void this.unsubscribeWatcherSubscription(subscription, target.repoGitRoot);
        }
        this.scheduleRepoMetadataRefresh(target, "git-metadata-watch-error", true);
        this.startRepoMetadataFallback(target);
    }
    scheduleRepoMetadataWatchRecovery(target) {
        if (target.closed || target.subscription || target.recovery.timer) {
            return;
        }
        const delayMs = this.advanceWatchRecoveryLadder(target.recovery);
        target.recovery.timer = setTimeout(() => {
            target.recovery.timer = null;
            void this.recoverRepoMetadataWatch(target);
        }, delayMs);
    }
    async recoverRepoMetadataWatch(target) {
        if (target.closed || target.subscription) {
            return;
        }
        const recovered = await this.startRepoMetadataObservation(target, { replaceFallback: true });
        if (!recovered) {
            this.scheduleRepoMetadataWatchRecovery(target);
            return;
        }
        this.logger.info({ repoGitRoot: target.repoGitRoot }, "Repository metadata watcher recovered");
    }
    routeRepoMetadataEvents(target, events) {
        const refreshes = new Map();
        const matchesRepoGitRoot = createRealpathAwarePathMatcher(target.repoGitRoot);
        for (const event of events) {
            if (!this.routeRepoMetadataEvent(target, event, matchesRepoGitRoot, refreshes))
                return null;
        }
        return refreshes;
    }
    refreshWorkingTreeIgnoresFromRepoMetadataEvents(target, events) {
        const workspaceKeys = new Set();
        for (const event of events) {
            const commonRelativePath = getRealpathAwareRelativePath(target.repoGitRoot, event.path)?.replaceAll("\\", "/");
            if (commonRelativePath === "config" || commonRelativePath === "info/exclude") {
                for (const workspaceKey of target.workspaceKeys)
                    workspaceKeys.add(workspaceKey);
                continue;
            }
            for (const workspaceKey of target.workspaceKeys) {
                const facts = this.workspaceTargets.get(workspaceKey)?.latestFacts;
                if (facts?.isGit &&
                    facts.absoluteGitDir &&
                    getRealpathAwareRelativePath(facts.absoluteGitDir, event.path)?.replaceAll("\\", "/") ===
                        "config.worktree") {
                    workspaceKeys.add(workspaceKey);
                }
            }
        }
        for (const workspaceKey of workspaceKeys) {
            const workspaceTarget = this.workspaceTargets.get(workspaceKey);
            const workingTreeTarget = workspaceTarget
                ? this.getWorkingTreeWatchTargetForWorkspace(workspaceTarget)
                : null;
            if (workingTreeTarget)
                void this.refreshWorkingTreeIgnoredDirectories(workingTreeTarget);
        }
    }
    isFetchRemoteMetadataEvent(target, event) {
        const relativePath = getRealpathAwareRelativePath(target.repoGitRoot, event.path);
        const effect = classifyGitMetadataPath("common", relativePath ?? "");
        return ((effect.kind === "ref" && effect.namespace === "remote") ||
            (effect.kind === "all" &&
                (relativePath === "packed-refs" || relativePath?.startsWith("reftable/") === true)));
    }
    routeRepoMetadataEvent(target, event, matchesRepoGitRoot, refreshes) {
        if (this.routePrivateGitDirEvent(target, event, matchesRepoGitRoot, refreshes))
            return true;
        const commonRelativePath = getRealpathAwareRelativePath(target.repoGitRoot, event.path);
        const effect = classifyGitMetadataPath("common", commonRelativePath ?? "");
        switch (effect.kind) {
            case "ignore":
                return true;
            case "owner":
                this.routeMainCheckoutMetadata(target, matchesRepoGitRoot, effect.refreshBase, refreshes);
                return true;
            case "ref":
                if (effect.namespace === "local") {
                    this.routeLocalBranchRef(target, effect.ref, refreshes);
                }
                else {
                    if (event.type === "delete") {
                        target.recentFetchRemoteRefChanges.delete(effect.ref);
                        target.knownRemoteRefs = null;
                        return false;
                    }
                    const recent = target.recentFetchRemoteRefChanges.get(effect.ref);
                    if (recent && recent.expiresAtMs >= this.deps.now().getTime()) {
                        this.routeRemoteBranchRef(target, effect.ref, refreshes, {
                            narrow: recent.change.kind === "moved",
                        });
                    }
                    else {
                        target.recentFetchRemoteRefChanges.delete(effect.ref);
                        if (target.knownRemoteRefs?.has(effect.ref)) {
                            this.routeRemoteBranchRef(target, effect.ref, refreshes, { narrow: true });
                        }
                        else if (event.type === "create" &&
                            target.knownRemoteRefs &&
                            [...target.knownRemoteRefs].some((ref) => ref.startsWith(`${effect.ref}/`))) {
                            return true;
                        }
                        else {
                            return false;
                        }
                    }
                }
                return true;
            case "all":
                if (commonRelativePath === "packed-refs" ||
                    commonRelativePath?.startsWith("reftable/") === true) {
                    target.knownRemoteRefs = null;
                }
                return false;
        }
    }
    routePrivateGitDirEvent(target, event, matchesRepoGitRoot, refreshes) {
        let matched = false;
        for (const workspaceKey of target.workspaceKeys) {
            const facts = this.workspaceTargets.get(workspaceKey)?.latestFacts;
            if (!facts?.isGit || !facts.absoluteGitDir || matchesRepoGitRoot(facts.absoluteGitDir)) {
                continue;
            }
            const relativePath = getRealpathAwareRelativePath(facts.absoluteGitDir, event.path);
            if (relativePath === null)
                continue;
            matched = true;
            const effect = classifyGitMetadataPath("worktree", relativePath);
            if (effect.kind === "owner") {
                this.addWorkspaceMetadataRefresh(refreshes, workspaceKey, effect.refreshBase);
            }
            else if (effect.kind !== "ignore") {
                throw new Error(`Invalid ${effect.kind} effect for worktree metadata`);
            }
        }
        return matched;
    }
    routeMainCheckoutMetadata(target, matchesRepoGitRoot, refreshBase, refreshes) {
        for (const workspaceKey of target.workspaceKeys) {
            const facts = this.workspaceTargets.get(workspaceKey)?.latestFacts;
            if (facts?.isGit && facts.absoluteGitDir && matchesRepoGitRoot(facts.absoluteGitDir)) {
                this.addWorkspaceMetadataRefresh(refreshes, workspaceKey, refreshBase);
            }
        }
    }
    routeLocalBranchRef(target, branch, refreshes) {
        for (const workspaceKey of target.workspaceKeys) {
            const facts = this.workspaceTargets.get(workspaceKey)?.latestFacts;
            if (!facts?.isGit)
                continue;
            const dependentRefs = [
                facts.storedBaseRef,
                facts.resolvedBaseRef,
                facts.comparisonBaseRef,
                facts.upstreamStatus?.ref,
            ];
            const usesBranch = dependentRefs.some((ref) => ref === branch || ref === `refs/heads/${branch}`);
            if (facts.currentBranch === branch || usesBranch) {
                this.addWorkspaceMetadataRefresh(refreshes, workspaceKey, true);
            }
        }
    }
    routeRemoteBranchRef(target, remoteRef, refreshes, options) {
        const qualifiedRemoteRef = `refs/remotes/${remoteRef}`;
        for (const workspaceKey of target.workspaceKeys) {
            const facts = this.workspaceTargets.get(workspaceKey)?.latestFacts;
            if (!facts?.isGit)
                continue;
            const trackedBranch = facts.branchMergeRef?.startsWith("refs/heads/")
                ? facts.branchMergeRef.slice("refs/heads/".length)
                : null;
            const configuredRemoteRef = facts.branchRemoteName && facts.branchRemoteName !== "." && trackedBranch
                ? `${facts.branchRemoteName}/${trackedBranch}`
                : null;
            const shortstatRemoteRef = facts.currentBranch &&
                (!facts.resolvedBaseRef || branchNameFromRef(facts.resolvedBaseRef) === facts.currentBranch)
                ? `origin/${facts.currentBranch}`
                : null;
            const refs = [
                facts.storedBaseRef,
                facts.resolvedBaseRef,
                facts.comparisonBaseRef,
                facts.upstreamStatus?.ref,
                configuredRemoteRef,
                shortstatRemoteRef,
            ];
            const usesRemoteRef = refs.some((ref) => ref === remoteRef || ref === qualifiedRemoteRef);
            if (usesRemoteRef) {
                this.addWorkspaceMetadataRefresh(refreshes, workspaceKey, true, {
                    structural: options?.narrow !== true,
                    movedRemoteRef: options?.narrow === true ? remoteRef : undefined,
                    queueIfBusy: options?.queueIfBusy,
                });
            }
        }
    }
    addWorkspaceMetadataRefresh(refreshes, workspaceKey, refreshBase, options) {
        const previous = refreshes.get(workspaceKey);
        const movedRemoteRefs = new Set(previous?.movedRemoteRefs);
        if (options?.movedRemoteRef) {
            movedRemoteRefs.add(options.movedRemoteRef);
        }
        refreshes.set(workspaceKey, {
            refreshBase: previous?.refreshBase === true || refreshBase,
            structural: previous?.structural === true || options?.structural !== false,
            movedRemoteRefs,
            queueIfBusy: (previous?.queueIfBusy ?? false) || (options?.queueIfBusy ?? true),
        });
    }
    scheduleRepoMetadataRefresh(target, reason, refreshWorktree, routedRefreshes = null) {
        if (target.closed || this.repoTargets.get(target.repoGitRoot) !== target) {
            return;
        }
        const workingTreeTargets = new Set();
        const refreshes = routedRefreshes ??
            new Map(Array.from(target.workspaceKeys, (workspaceKey) => [
                workspaceKey,
                {
                    refreshBase: true,
                    structural: true,
                    movedRemoteRefs: new Set(),
                    queueIfBusy: true,
                },
            ]));
        for (const [workspaceKey, refresh] of refreshes) {
            const workspaceTarget = this.workspaceTargets.get(workspaceKey);
            if (workspaceTarget) {
                let scope;
                if (!refreshWorktree) {
                    scope = refresh.structural ? "structure" : "refs";
                }
                if (refresh.refreshBase) {
                    this.invalidateCheckoutDiffCache(workspaceTarget.cwd, "base");
                    if (workspaceTarget.latestFacts?.isGit) {
                        this.invalidateCheckoutDiffCache(workspaceTarget.latestFacts.worktreeRoot, "base");
                    }
                }
                if (refreshWorktree) {
                    const workingTreeTarget = this.getWorkingTreeWatchTargetForWorkspace(workspaceTarget);
                    if (workingTreeTarget) {
                        workingTreeTargets.add(workingTreeTarget);
                    }
                }
                this.scheduleWorkspaceRefresh(workspaceTarget, {
                    scope,
                    emitUnchanged: refresh.refreshBase,
                    reason,
                    queueIfBusy: refresh.queueIfBusy,
                    movedRemoteRefs: refresh.movedRemoteRefs,
                });
            }
        }
        for (const workingTreeTarget of workingTreeTargets) {
            this.notifyWorkingTreeConsumers(workingTreeTarget);
        }
    }
    startRepoMetadataFallback(target) {
        if (target.fallbackPolling || target.closed) {
            return;
        }
        target.fallbackPolling = true;
        target.fallbackPollQuietTickCount = 0;
        const poll = async () => {
            target.fallbackPollTimer = null;
            if (target.closed || this.repoTargets.get(target.repoGitRoot) !== target) {
                return;
            }
            const workingTreeTargets = new Set();
            const changes = await Promise.all(Array.from(target.workspaceKeys, async (workspaceKey) => {
                const workspaceTarget = this.workspaceTargets.get(workspaceKey);
                if (!workspaceTarget) {
                    return false;
                }
                this.invalidateCheckoutDiffCache(workspaceTarget.cwd, "base");
                if (workspaceTarget.latestFacts?.isGit) {
                    this.invalidateCheckoutDiffCache(workspaceTarget.latestFacts.worktreeRoot, "base");
                }
                const workingTreeTarget = this.getWorkingTreeWatchTargetForWorkspace(workspaceTarget);
                if (workingTreeTarget) {
                    workingTreeTargets.add(workingTreeTarget);
                }
                return await this.refreshDegradedPollTarget(workspaceTarget, {
                    force: false,
                    refreshStructure: true,
                    refreshWorktree: true,
                    includeForge: false,
                    emitUnchanged: true,
                    reason: "git-metadata-watch-fallback",
                    notify: true,
                    queueIfBusy: true,
                    movedRemoteRefs: new Set(),
                });
            }));
            for (const workingTreeTarget of workingTreeTargets) {
                this.notifyWorkingTreeConsumers(workingTreeTarget);
            }
            if (!target.closed && target.subscription === null) {
                target.fallbackPollQuietTickCount = changes.some(Boolean)
                    ? 0
                    : target.fallbackPollQuietTickCount + 1;
                target.fallbackPollTimer = setTimeout(poll, this.degradedPollDelayMs(target.fallbackPollQuietTickCount));
            }
            else {
                target.fallbackPolling = false;
            }
        };
        target.fallbackPollTimer = setTimeout(poll, DEGRADED_GIT_POLL_INTERVAL_MS);
    }
    scheduleWorkspaceRefresh(targetOrCwd, options) {
        const target = typeof targetOrCwd === "string"
            ? this.workspaceTargets.get(resolve(targetOrCwd))
            : targetOrCwd;
        if (!target || target.closed || this.workspaceTargets.get(target.cwd) !== target) {
            return;
        }
        const request = this.buildScheduledRefreshRequest(options);
        target.pendingDebounceRequest = this.mergeRefreshRequests(target.pendingDebounceRequest, request);
        if (target.debounceTimer) {
            clearTimeout(target.debounceTimer);
        }
        target.debounceTimer = setTimeout(() => {
            if (target.closed || this.workspaceTargets.get(target.cwd) !== target) {
                return;
            }
            target.debounceTimer = null;
            const merged = target.pendingDebounceRequest;
            target.pendingDebounceRequest = null;
            if (merged) {
                void this.refreshWorkspaceTarget(target, merged);
            }
        }, WORKSPACE_GIT_WATCH_DEBOUNCE_MS);
    }
    startWorkspaceSubscriptionTimers(target) {
        if (!target.observationReensureTimer) {
            const reensureObservation = () => {
                if (!this.isActiveObservedWorkspaceTarget(target)) {
                    target.observationReensureTimer = null;
                    return;
                }
                target.observationReensureTimer = setTimeout(reensureObservation, WORKSPACE_GIT_OBSERVATION_REENSURE_INTERVAL_MS);
                this.scheduleWorkspaceObservationSetup(target);
            };
            target.observationReensureTimer = setTimeout(reensureObservation, this.deps.getWorkspaceGitSelfHealPhaseMs(target.cwd));
        }
        this.updateForgePrStatusPollForTarget(target);
    }
    updateForgePrStatusPollForTarget(target) {
        if (target.listeners.size === 0) {
            this.stopForgePrStatusPollForTarget(target);
            return;
        }
        const git = target.latestGit;
        if (!git?.remoteUrl) {
            this.stopForgePrStatusPollForTarget(target);
            return;
        }
        const resolution = this.forgeResolver.resolveFromRemoteUrl(git.remoteUrl);
        if (!resolution) {
            this.stopForgePrStatusPollForTarget(target);
            return;
        }
        const pollTarget = this.resolveForgePrStatusPollTarget(target);
        const remoteUrl = git.remoteUrl;
        if (!pollTarget) {
            this.stopForgePrStatusPollForTarget(target);
            return;
        }
        const pollKey = buildWorkspaceForgePrStatusPollKey({
            forge: resolution.forge,
            remoteUrl,
            target: pollTarget,
        });
        const previousPollKey = target.forgePrStatusPollKey;
        if (target.forgePrStatusPollKey === pollKey && target.forgePrStatusPollSubscription) {
            return;
        }
        const pollImmediately = previousPollKey !== null && previousPollKey !== pollKey;
        this.stopForgePrStatusPollForTarget(target);
        target.forgePrStatusPollKey = pollKey;
        if (resolution.service.retainCurrentPullRequestStatusPoll) {
            target.forgePrStatusPollSubscription = resolution.service.retainCurrentPullRequestStatusPoll({
                cwd: target.cwd,
                headRef: pollTarget.headRef,
                ...(pollTarget.headSha ? { headSha: pollTarget.headSha } : {}),
                ...(pollTarget.headRepositoryOwner
                    ? { headRepositoryOwner: pollTarget.headRepositoryOwner }
                    : {}),
                onStatus: (status) => {
                    if (!this.isActiveObservedWorkspaceTarget(target)) {
                        return;
                    }
                    this.rememberForgePrStatusSnapshot(target, buildForgeSnapshotFromStatus(status, resolution.forge), {
                        notify: true,
                    });
                },
                onError: (error) => {
                    this.logger.warn({
                        err: error,
                        cwd: target.cwd,
                        forge: resolution.forge,
                        headRef: pollTarget.headRef,
                        headRepositoryOwner: pollTarget.headRepositoryOwner,
                        reason: "self-heal-forge-pr-status",
                    }, "Failed to run forge PR status self-heal refresh");
                },
            });
            return;
        }
        target.forgePrStatusPollSubscription = this.retainGenericForgePrStatusPoll({
            target,
            forge: resolution.forge,
            service: resolution.service,
            pollTarget,
            pollImmediately,
        });
    }
    retainGenericForgePrStatusPoll({ target, forge, service, pollTarget, pollImmediately, }) {
        let closed = false;
        let timer = null;
        let latestStatus = target.latestForge?.pullRequest ?? null;
        let consecutiveErrors = 0;
        const schedule = (delayMs) => {
            if (closed) {
                return;
            }
            timer = setTimeout(() => {
                timer = null;
                void poll();
            }, delayMs);
        };
        const poll = async () => {
            if (closed || !this.isActiveObservedWorkspaceTarget(target)) {
                return;
            }
            try {
                const status = await service.getCurrentPullRequestStatus({
                    cwd: target.cwd,
                    headRef: pollTarget.headRef,
                    ...(pollTarget.headSha ? { headSha: pollTarget.headSha } : {}),
                    ...(pollTarget.headRepositoryOwner
                        ? { headRepositoryOwner: pollTarget.headRepositoryOwner }
                        : {}),
                    reason: "self-heal-forge-pr-status",
                });
                if (!closed && this.isActiveObservedWorkspaceTarget(target)) {
                    latestStatus = status;
                    consecutiveErrors = 0;
                    this.rememberForgePrStatusSnapshot(target, buildForgeSnapshotFromStatus(status, forge), {
                        notify: true,
                    });
                }
            }
            catch (error) {
                consecutiveErrors += 1;
                this.logger.warn({
                    err: error,
                    cwd: target.cwd,
                    forge,
                    headRef: pollTarget.headRef,
                    headRepositoryOwner: pollTarget.headRepositoryOwner,
                    reason: "self-heal-forge-pr-status",
                }, "Failed to run forge PR status self-heal refresh");
            }
            finally {
                schedule(computeGenericForgeNextInterval(latestStatus, consecutiveErrors));
            }
        };
        // A git-only refresh clears forge state when the commit-aware poll identity
        // changes. Revalidate that new identity immediately instead of leaving the
        // PR panel empty for the full stable polling interval.
        schedule(pollImmediately ? 0 : computeGenericForgeNextInterval(latestStatus, consecutiveErrors));
        return {
            unsubscribe: () => {
                closed = true;
                if (timer) {
                    clearTimeout(timer);
                    timer = null;
                }
            },
        };
    }
    resolveForgePrStatusPollTarget(target) {
        const git = target.latestGit;
        if (!git?.currentBranch) {
            return null;
        }
        const lookupTarget = target.latestFacts?.isGit && target.latestFacts.currentBranch === git.currentBranch
            ? target.latestFacts.pullRequestLookupTarget
            : null;
        if (target.latestFacts?.isGit && target.latestFacts.paseoWorktree.isPaseoOwnedWorktree) {
            return lookupTarget;
        }
        if (lookupTarget) {
            return lookupTarget;
        }
        return { headRef: git.currentBranch };
    }
    stopForgePrStatusPollForTarget(target) {
        target.forgePrStatusPollSubscription?.unsubscribe();
        target.forgePrStatusPollSubscription = null;
        target.forgePrStatusPollKey = null;
    }
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
    async loadIgnoredDirs(rootPath, previous = new Set()) {
        const ignored = new Set();
        try {
            const result = await this.deps.runGitCommand(["ls-files", "-o", "-i", "--directory", "--exclude-standard"], { cwd: rootPath, env: READ_ONLY_GIT_ENV });
            for (const raw of result.stdout.split("\n")) {
                if (!raw.endsWith("/")) {
                    continue;
                }
                const rel = raw.replace(/\/+$/, "");
                if (!rel) {
                    continue;
                }
                ignored.add(resolve(rootPath, rel));
            }
        }
        catch (error) {
            this.logger.warn({ err: error, rootPath }, "Failed to load gitignore directories; keeping previous ignore set");
            return { ignored: previous, failed: true };
        }
        return { ignored, failed: false };
    }
    async refreshWorkspaceTarget(target, request) {
        if (target.closed || this.workspaceTargets.get(target.cwd) !== target) {
            return;
        }
        try {
            await this.requestWorkspaceSnapshot(target, request);
        }
        catch (error) {
            if (this.disposed || target.closed) {
                return;
            }
            this.logger.warn({ err: error, cwd: target.cwd, reason: request.reason }, "Failed to refresh workspace git snapshot");
        }
    }
    requestWorkspaceSnapshot(target, request) {
        if (target.refreshState.status === "in-flight") {
            const active = target.refreshState.request;
            const addsWork = (request.force && !active.force) ||
                (request.refreshStructure && !active.refreshStructure) ||
                (request.refreshWorktree && !active.refreshWorktree) ||
                (request.includeForge && !active.includeForge) ||
                (request.emitUnchanged === true && active.emitUnchanged !== true) ||
                [...request.movedRemoteRefs].some((ref) => !active.movedRemoteRefs.has(ref));
            if (request.queueIfBusy || addsWork) {
                target.refreshState.queued = this.mergeRefreshRequests(target.refreshState.queued, request);
            }
            return target.refreshState.promise;
        }
        if (!request.force && !request.queueIfBusy && this.shouldThrottleNonForcedRefresh(target)) {
            return Promise.resolve(target.latestSnapshot);
        }
        const promise = this.runWorkspaceRefreshLoop(target, request).finally(() => {
            const state = target.refreshState;
            if (state.status === "in-flight" && state.promise === promise) {
                target.refreshState = { status: "idle" };
            }
        });
        target.refreshState = {
            status: "in-flight",
            promise,
            request,
            queued: null,
        };
        return promise;
    }
    normalizeRefreshRequest(options, defaultReason, notify) {
        if (options?.force && !options.reason) {
            throw new Error("WorkspaceGitService.getSnapshot force refresh requires a reason");
        }
        const force = options?.force === true;
        return {
            force,
            refreshStructure: true,
            refreshWorktree: true,
            includeForge: options?.includeForge ?? true,
            reason: options?.reason ?? defaultReason,
            notify,
            queueIfBusy: false,
            movedRemoteRefs: new Set(),
        };
    }
    shouldThrottleNonForcedRefresh(target) {
        if (!target.latestSnapshot || target.lastShellOutAtMs === null) {
            return false;
        }
        return this.deps.now().getTime() - target.lastShellOutAtMs < WORKSPACE_GIT_INTERNAL_MIN_GAP_MS;
    }
    buildScheduledRefreshRequest(options) {
        const scope = options?.scope;
        return {
            force: options?.force === true,
            refreshStructure: scope !== "worktree" && scope !== "refs",
            refreshWorktree: scope !== "structure" && scope !== "refs",
            includeForge: options?.includeForge ?? false,
            emitUnchanged: options?.emitUnchanged,
            reason: options?.reason ?? "watch",
            notify: true,
            queueIfBusy: options?.queueIfBusy ?? true,
            movedRemoteRefs: new Set(options?.movedRemoteRefs),
        };
    }
    mergeRefreshRequests(pending, request) {
        if (!pending) {
            return request;
        }
        const force = pending.force || request.force;
        const upgradesForce = request.force && !pending.force;
        const upgradesStructure = request.refreshStructure && !pending.refreshStructure;
        const upgradesWorktree = request.refreshWorktree && !pending.refreshWorktree;
        const upgradesForge = request.includeForge && !pending.includeForge;
        const upgradesEmit = request.emitUnchanged === true && pending.emitUnchanged !== true;
        const { merged: movedRemoteRefs, added: upgradesMovedRefs } = mergeSets(pending.movedRemoteRefs, request.movedRemoteRefs);
        return {
            force,
            refreshStructure: pending.refreshStructure || request.refreshStructure,
            refreshWorktree: pending.refreshWorktree || request.refreshWorktree,
            includeForge: pending.includeForge || request.includeForge,
            emitUnchanged: pending.emitUnchanged === true || request.emitUnchanged === true,
            reason: upgradesForce ||
                upgradesStructure ||
                upgradesWorktree ||
                upgradesForge ||
                upgradesEmit ||
                upgradesMovedRefs
                ? request.reason
                : pending.reason,
            notify: pending.notify || request.notify,
            queueIfBusy: pending.queueIfBusy || request.queueIfBusy,
            movedRemoteRefs,
        };
    }
    async runWorkspaceRefreshLoop(target, initialRequest) {
        let request = initialRequest;
        let snapshot = target.latestSnapshot ?? buildNotGitSnapshot(target.cwd);
        let failure = null;
        while (true) {
            if (request.emitUnchanged === true &&
                request.movedRemoteRefs.size === 0 &&
                target.latestSnapshot) {
                this.rememberSnapshot(target, target.latestSnapshot, {
                    notify: request.notify,
                    forceEmit: true,
                });
            }
            try {
                const runRefreshGitCommand = createRunGitCommand(`workspace-refresh:${request.reason}`);
                const admittedSnapshot = await this.workspaceRefreshLimit(() => {
                    if (target.closed || this.workspaceTargets.get(target.cwd) !== target) {
                        return null;
                    }
                    return this.refreshSnapshot(target, request, runRefreshGitCommand);
                });
                if (!admittedSnapshot) {
                    break;
                }
                snapshot = admittedSnapshot;
                this.rememberSnapshot(target, snapshot, {
                    notify: request.notify,
                    forceEmit: request.force || (request.emitUnchanged === true && request.movedRemoteRefs.size > 0),
                });
                failure = null;
            }
            catch (error) {
                failure = { error };
                // A failed refresh must not leave the facts it failed to refresh being
                // served as fresh. Retire the cache; the next read goes live.
                this.invalidateCachedCheckout(target.cwd);
            }
            if (this.disposed || target.closed || this.workspaceTargets.get(target.cwd) !== target) {
                break;
            }
            const state = target.refreshState;
            if (state.status !== "in-flight" || !state.queued) {
                break;
            }
            request = state.queued;
            state.queued = null;
            state.request = request;
        }
        if (failure) {
            throw failure.error;
        }
        return snapshot;
    }
    async refreshSnapshot(target, request, runRefreshGitCommand) {
        // Captured before any Git read: if an invalidation lands while this refresh
        // is in flight, the identity moves and this refresh publishes nothing.
        const generation = this.reserveCheckoutGeneration(target.cwd);
        let facts = target.latestFacts;
        if (request.movedRemoteRefs.size > 0 && !request.refreshStructure && !request.refreshWorktree) {
            if (facts?.isGit && target.latestGit?.isGit) {
                try {
                    await this.refreshRefDerivedSnapshot(target, facts, request.movedRemoteRefs, runRefreshGitCommand);
                    return this.combineSnapshot(target);
                }
                catch (error) {
                    this.logger.debug({ err: error, cwd: target.cwd, movedRemoteRefs: [...request.movedRemoteRefs] }, "Narrow remote ref refresh failed; using structural refresh");
                }
            }
            facts = await this.refreshGitSnapshot(target, {
                ...request,
                refreshStructure: true,
                refreshWorktree: true,
            }, runRefreshGitCommand);
            return this.combineSnapshot(target);
        }
        if (request.refreshStructure || !facts || !target.latestGit) {
            facts = await this.refreshGitSnapshot(target, request, runRefreshGitCommand);
        }
        else if (request.refreshWorktree) {
            await this.refreshWorktreeSnapshot(target, facts, runRefreshGitCommand);
        }
        if (!facts) {
            facts = await this.refreshGitSnapshot(target, request, runRefreshGitCommand);
        }
        if (request.includeForge) {
            await this.refreshForgeSnapshot(target, request, facts, runRefreshGitCommand);
        }
        const snapshot = this.combineSnapshot(target);
        target.latestSnapshotLoadedAtMs = this.deps.now().getTime();
        this.publishCachedCheckout(target.cwd, generation, this.checkoutLiteFromRuntimeGit(target.cwd, snapshot.git));
        return snapshot;
    }
    /**
     * Publish the lite checkout derived from the freshest facts this read
     * established, so a later reconciliation sweep - or a client status request -
     * can read it without Git. The identity captured when the read began must
     * still be current: invalidation, eviction or a newer read retires it.
     */
    publishCachedCheckout(cwd, generation, checkout) {
        // An absent slot also refuses publication. A newer read always reserves a
        // new identity, including when it recreates a slot after eviction.
        const current = this.checkoutCache.peek(cwd);
        if (current?.generation !== generation) {
            return;
        }
        this.checkoutCache.set(cwd, { checkout, generation });
    }
    /**
     * Reserve this read's publication identity before it starts. Preserve a warm
     * value during a refresh, but retire every older read's right to publish.
     */
    reserveCheckoutGeneration(cwd) {
        const generation = Symbol();
        const checkout = this.checkoutCache.peek(cwd)?.checkout ?? null;
        this.checkoutCache.set(cwd, { checkout, generation });
        return generation;
    }
    checkoutLiteFromRuntimeGit(cwd, git) {
        return checkoutLiteFromGitSnapshot(cwd, {
            isGit: git.isGit,
            currentBranch: git.isGit ? git.currentBranch : null,
            remoteUrl: git.isGit ? git.remoteUrl : null,
            repoRoot: git.isGit ? git.repoRoot : null,
            isPaseoOwnedWorktree: git.isGit ? git.isPaseoOwnedWorktree : false,
            mainRepoRoot: git.isGit ? git.mainRepoRoot : null,
        });
    }
    /**
     * Retire the cached checkout for a cwd and any read in flight behind it. The
     * next read goes live; a read that began before this call cannot publish. The
     * slot's identity is never reused, even if eviction removes the slot before
     * the read resolves. This also holds for cwds with no workspace target.
     */
    invalidateCachedCheckout(cwd) {
        this.checkoutCache.set(cwd, {
            checkout: null,
            generation: Symbol(),
        });
    }
    async refreshRefDerivedSnapshot(target, facts, movedRemoteRefs, runRefreshGitCommand) {
        const latestGit = target.latestGit;
        if (!latestGit?.isGit) {
            throw new Error("Remote ref refresh requires a warmed Git snapshot");
        }
        target.lastShellOutAtMs = this.deps.now().getTime();
        const derived = await this.deps.getCheckoutRefDerivedState(target.cwd, facts, { aheadBehind: latestGit.aheadBehind, diffStat: latestGit.diffStat }, movedRemoteRefs, {
            paseoHome: this.paseoHome,
            worktreesRoot: this.worktreesRoot,
            logger: this.logger,
            facts,
            runGitCommand: runRefreshGitCommand,
        });
        target.latestFacts = { ...facts, upstreamStatus: derived.upstreamStatus };
        target.latestGit = {
            ...latestGit,
            aheadBehind: derived.aheadBehind,
            diffStat: derived.diffStat,
            upstreamRef: derived.upstreamStatus?.ref ?? null,
            aheadOfOrigin: derived.upstreamStatus?.aheadBehind.ahead ?? null,
            behindOfOrigin: derived.upstreamStatus?.aheadBehind.behind ?? null,
        };
        const loadedAtMs = this.deps.now().getTime();
        target.latestGitLoadedAtMs = loadedAtMs;
    }
    async refreshWorktreeSnapshot(target, facts, runRefreshGitCommand) {
        const latestGit = target.latestGit;
        if (!latestGit || !facts.isGit) {
            return;
        }
        target.lastShellOutAtMs = this.deps.now().getTime();
        const context = {
            paseoHome: this.paseoHome,
            worktreesRoot: this.worktreesRoot,
            logger: this.logger,
            facts,
            runGitCommand: runRefreshGitCommand,
        };
        const worktree = await this.deps.getCheckoutWorktreeState(target.cwd, context);
        target.latestGit = {
            ...latestGit,
            isDirty: worktree.isDirty,
            diffStat: worktree.diffStat,
        };
        const loadedAtMs = this.deps.now().getTime();
        target.latestGitLoadedAtMs = loadedAtMs;
    }
    async refreshGitSnapshot(target, request, runRefreshGitCommand) {
        const now = this.deps.now();
        target.lastShellOutAtMs = now.getTime();
        const cwd = target.cwd;
        const previousForgePrStatusPollKey = this.getForgePrStatusPollKey(target);
        const baseContext = {
            paseoHome: this.paseoHome,
            worktreesRoot: this.worktreesRoot,
            logger: this.logger,
            runGitCommand: runRefreshGitCommand,
        };
        const facts = await this.loadCheckoutFacts(target, baseContext);
        const context = { ...baseContext, facts };
        const checkoutStatus = await this.deps.getCheckoutStatus(cwd, context);
        if (!checkoutStatus.isGit) {
            target.latestGit = buildNotGitSnapshot(cwd).git;
            const loadedAtMs = this.deps.now().getTime();
            target.latestGitLoadedAtMs = loadedAtMs;
            target.latestForge = buildForgeUnavailableSnapshot();
            target.latestForgeLoadedAtMs = target.latestGitLoadedAtMs;
            return facts;
        }
        const refreshWorktree = request.refreshWorktree || target.latestGit === null;
        const diffStat = refreshWorktree
            ? await this.deps
                .getCheckoutShortstat(cwd, context, {
                force: request.force || target.latestGit !== null,
            })
                .catch(() => null)
            : (target.latestGit?.diffStat ?? null);
        target.latestGit = {
            isGit: true,
            repoRoot: checkoutStatus.repoRoot,
            mainRepoRoot: checkoutStatus.mainRepoRoot,
            currentBranch: checkoutStatus.currentBranch,
            remoteUrl: checkoutStatus.remoteUrl,
            isPaseoOwnedWorktree: checkoutStatus.isPaseoOwnedWorktree,
            isDirty: refreshWorktree
                ? checkoutStatus.isDirty
                : (target.latestGit?.isDirty ?? checkoutStatus.isDirty),
            baseRef: checkoutStatus.baseRef,
            aheadBehind: checkoutStatus.aheadBehind,
            upstreamRef: checkoutStatus.upstreamRef,
            aheadOfOrigin: checkoutStatus.aheadOfOrigin,
            behindOfOrigin: checkoutStatus.behindOfOrigin,
            hasRemote: checkoutStatus.hasRemote,
            diffStat,
        };
        const loadedAtMs = this.deps.now().getTime();
        target.latestGitLoadedAtMs = loadedAtMs;
        if (previousForgePrStatusPollKey !== this.getForgePrStatusPollKey(target)) {
            target.latestForge = buildForgeUnavailableSnapshot();
            target.latestForgeLoadedAtMs = target.latestGitLoadedAtMs;
        }
        return facts;
    }
    async refreshForgeSnapshot(target, request, facts, runRefreshGitCommand) {
        const remoteUrl = target.latestGit?.remoteUrl ?? null;
        const resolution = await this.forgeResolver.resolveFromRemoteUrlAsync(remoteUrl);
        // Every forge gates on the resolver alone: a cloud host matches synchronously
        // and a self-hosted/Enterprise host is recognized by the adapter probe (which
        // this async resolution populates), so GitHub Enterprise is no longer gated
        // out by a cloud-only identity check.
        if (!resolution) {
            target.latestForge = buildUnresolvedRemoteForgeSnapshot(remoteUrl);
            target.latestForgeLoadedAtMs = this.deps.now().getTime();
            return;
        }
        const forgeService = resolution.service;
        const forceForge = request.force && request.includeForge;
        if (forceForge) {
            forgeService.invalidate({ cwd: target.cwd });
        }
        const forgeSnapshot = await loadForgeSnapshot({
            cwd: target.cwd,
            forgeService,
            now: this.deps.now(),
            deps: this.deps,
            force: forceForge,
            reason: request.reason,
            facts,
            runGitCommand: runRefreshGitCommand,
        });
        // Carry the resolved forge (probe-aware) so the wire projection labels
        // self-managed GitLab hosts correctly instead of falling back to "github".
        target.latestForge = { ...forgeSnapshot, forge: resolution.forge };
        target.latestForgeLoadedAtMs = this.deps.now().getTime();
    }
    combineSnapshot(target) {
        if (!target.latestGit) {
            return target.latestSnapshot ?? buildNotGitSnapshot(target.cwd);
        }
        return {
            cwd: target.cwd,
            git: target.latestGit,
            forge: target.latestForge ?? buildForgeUnavailableSnapshot(),
        };
    }
    getForgePrStatusPollKey(target) {
        const git = target.latestGit;
        if (!git?.currentBranch || !git.remoteUrl) {
            return null;
        }
        const resolution = this.forgeResolver.resolveFromRemoteUrl(git.remoteUrl);
        if (!resolution) {
            return null;
        }
        const pollTarget = this.resolveForgePrStatusPollTarget(target);
        if (!pollTarget) {
            return null;
        }
        return buildWorkspaceForgePrStatusPollKey({
            forge: resolution.forge,
            remoteUrl: git.remoteUrl,
            target: pollTarget,
        });
    }
    rememberForgePrStatusSnapshot(target, github, options) {
        if (target.closed || this.workspaceTargets.get(target.cwd) !== target) {
            return;
        }
        target.latestForge = github;
        target.latestForgeLoadedAtMs = this.deps.now().getTime();
        this.rememberSnapshot(target, this.combineSnapshot(target), {
            notify: options?.notify,
            forceEmit: false,
        });
    }
    rememberSnapshot(target, snapshot, options) {
        target.latestSnapshot = snapshot;
        if (target.listeners.size > 0) {
            this.updateForgePrStatusPollForTarget(target);
        }
        const fingerprint = JSON.stringify(snapshot);
        const fingerprintMatches = target.latestFingerprint === fingerprint;
        if (fingerprintMatches && !options?.forceEmit) {
            return;
        }
        target.latestFingerprint = fingerprint;
        if (!options?.notify || target.listeners.size === 0) {
            return;
        }
        for (const listener of target.listeners) {
            listener(snapshot);
        }
        for (const listener of this.snapshotUpdatedListeners) {
            try {
                listener(snapshot);
            }
            catch (error) {
                this.logger.warn({ err: error, cwd: snapshot.cwd }, "Workspace git snapshot listener threw");
            }
        }
    }
    async runRepoFetch(target) {
        if (target.fetchInFlight) {
            return;
        }
        target.fetchInFlight = true;
        this.logger.debug({ repoGitRoot: target.repoGitRoot, cwd: target.cwd }, "Running background git fetch");
        let result = null;
        const eventsBeforeFetchSnapshot = [];
        try {
            try {
                result = await this.deps.runGitFetch(target.cwd, {
                    onRefSnapshot: (phase) => {
                        const events = target.bufferedFetchMetadataEvents.splice(0);
                        if (phase === "before") {
                            eventsBeforeFetchSnapshot.push(...events);
                        }
                    },
                }, createRunGitCommand("background-fetch"));
            }
            catch (error) {
                this.logger.warn({ err: error, repoGitRoot: target.repoGitRoot, cwd: target.cwd }, "Background git fetch failed");
            }
            this.applyRepoFetchResult(target, result, eventsBeforeFetchSnapshot);
        }
        finally {
            target.fetchInFlight = false;
        }
    }
    applyRepoFetchResult(target, result, eventsBeforeFetchSnapshot) {
        this.flushFetchMetadataEvents(target, eventsBeforeFetchSnapshot);
        if (!result || result.changes === null) {
            target.recentFetchRemoteRefChanges.clear();
            target.knownRemoteRefs = null;
            this.flushBufferedFetchMetadataEvents(target);
            if (result) {
                this.logger.warn({ err: result.error, repoGitRoot: target.repoGitRoot, cwd: target.cwd }, "Background git fetch ref classification failed; using structural refresh");
            }
            this.scheduleRepoMetadataRefresh(target, "repo-fetch-unclassified", false);
            return;
        }
        if (result.error) {
            this.logger.warn({ err: result.error, repoGitRoot: target.repoGitRoot, cwd: target.cwd }, "Background git fetch completed with errors after changing refs");
        }
        const expiresAtMs = this.deps.now().getTime() + FETCH_METADATA_ECHO_TTL_MS;
        const remoteRefShapeChanged = target.knownRemoteRefs !== null &&
            result.remoteRefs !== undefined &&
            !setsEqual(target.knownRemoteRefs, result.remoteRefs);
        if (result.remoteRefs) {
            target.knownRemoteRefs = new Set(result.remoteRefs);
        }
        target.recentFetchRemoteRefChanges.clear();
        for (const change of result.changes) {
            target.recentFetchRemoteRefChanges.set(change.ref, { change, expiresAtMs });
        }
        this.flushBufferedFetchMetadataEvents(target);
        if (result.nonRemoteRefsChanged === true ||
            remoteRefShapeChanged ||
            result.changes.some((change) => change.kind !== "moved")) {
            this.scheduleRepoMetadataRefresh(target, "repo-fetch-ref-shape", false);
            return;
        }
        if (result.changes.length === 0) {
            return;
        }
        const refreshes = new Map();
        for (const change of result.changes) {
            this.routeRemoteBranchRef(target, change.ref, refreshes, { narrow: true });
        }
        this.scheduleRepoMetadataRefresh(target, "repo-fetch", false, refreshes);
    }
    flushBufferedFetchMetadataEvents(target) {
        this.flushFetchMetadataEvents(target, target.bufferedFetchMetadataEvents.splice(0));
    }
    flushFetchMetadataEvents(target, events) {
        if (events.length === 0) {
            return;
        }
        const routedRefreshes = this.routeRepoMetadataEvents(target, events);
        this.scheduleRepoMetadataRefresh(target, "git-metadata-watch-after-fetch", routedRefreshes === null ||
            [...routedRefreshes.values()].some((refresh) => refresh.structural), routedRefreshes);
    }
    removeWorkspaceListener(cwd, listener) {
        const target = this.workspaceTargets.get(cwd);
        if (!target) {
            return;
        }
        target.listeners.delete(listener);
        if (target.listeners.size > 0) {
            return;
        }
        this.removeWorkspaceTarget(target);
    }
    removeWorkspaceTarget(target) {
        if (target.repoGitRoot) {
            const repoTarget = this.repoTargets.get(target.repoGitRoot);
            repoTarget?.workspaceKeys.delete(target.cwd);
            if (repoTarget && repoTarget.workspaceKeys.size === 0) {
                this.closeRepoTarget(repoTarget);
                this.repoTargets.delete(target.repoGitRoot);
            }
            else if (repoTarget?.cwd === target.cwd) {
                repoTarget.cwd = repoTarget.workspaceKeys.values().next().value ?? repoTarget.cwd;
            }
        }
        this.closeWorkspaceTarget(target);
        this.workspaceTargets.delete(target.cwd);
    }
    removeWorkingTreeWatchListener(cwd, listener) {
        const target = this.workingTreeWatchTargets.get(cwd);
        if (!target) {
            return;
        }
        target.listeners.delete(listener);
        if (target.listeners.size > 0 || target.workspaceKeys.size > 0) {
            return;
        }
        this.closeWorkingTreeWatchTarget(target);
        this.workingTreeWatchTargets.delete(cwd);
    }
    removeWorkspaceWorkingTreeLink(target, workspaceKey) {
        target.workspaceKeys.delete(workspaceKey);
        if (target.workspaceKeys.size > 0 || target.listeners.size > 0) {
            return;
        }
        this.closeWorkingTreeWatchTarget(target);
        if (this.workingTreeWatchTargets.get(target.cwd) === target) {
            this.workingTreeWatchTargets.delete(target.cwd);
        }
    }
    closeWorkingTreeWatchTargetIfUnused(target) {
        if (target.closed ||
            target.workspaceKeys.size > 0 ||
            target.listeners.size > 0 ||
            this.workingTreeWatchTargets.get(target.cwd) !== target) {
            return;
        }
        this.closeWorkingTreeWatchTarget(target);
        this.workingTreeWatchTargets.delete(target.cwd);
    }
    closeWorkspaceTarget(target) {
        target.closed = true;
        if (target.workingTreeWatchTarget) {
            this.removeWorkspaceWorkingTreeLink(target.workingTreeWatchTarget, target.cwd);
            target.workingTreeWatchTarget = null;
        }
        if (target.debounceTimer) {
            clearTimeout(target.debounceTimer);
            target.debounceTimer = null;
        }
        if (target.observationReensureTimer) {
            clearTimeout(target.observationReensureTimer);
            target.observationReensureTimer = null;
        }
        this.stopForgePrStatusPollForTarget(target);
        target.listeners.clear();
    }
    closeWorkingTreeWatchTarget(target) {
        target.closed = true;
        for (const alias of target.aliases) {
            if (this.workingTreeWatchAliases.get(alias) === target.cwd) {
                this.workingTreeWatchAliases.delete(alias);
            }
        }
        target.aliases.clear();
        if (target.fallbackPollTimer) {
            clearTimeout(target.fallbackPollTimer);
            target.fallbackPollTimer = null;
        }
        target.fallbackPolling = false;
        if (target.recovery.timer) {
            clearTimeout(target.recovery.timer);
            target.recovery.timer = null;
        }
        if (target.ignoreRefreshTimer) {
            clearTimeout(target.ignoreRefreshTimer);
            target.ignoreRefreshTimer = null;
        }
        target.ignoreRefreshDeadlineMs = null;
        if (target.subscription) {
            const subscription = target.subscription;
            target.subscription = null;
            void subscription.unsubscribe().catch((error) => {
                this.logger.warn({ err: error, cwd: target.cwd }, "Failed to stop working tree watcher");
            });
        }
        target.workspaceKeys.clear();
        target.listeners.clear();
    }
    closeRepoTarget(target) {
        target.closed = true;
        if (target.intervalId) {
            clearInterval(target.intervalId);
            target.intervalId = null;
        }
        if (target.fallbackPollTimer) {
            clearTimeout(target.fallbackPollTimer);
            target.fallbackPollTimer = null;
        }
        target.fallbackPolling = false;
        if (target.recovery.timer) {
            clearTimeout(target.recovery.timer);
            target.recovery.timer = null;
        }
        if (target.subscription) {
            const subscription = target.subscription;
            target.subscription = null;
            void subscription.unsubscribe().catch((error) => {
                this.logger.warn({ err: error, repoGitRoot: target.repoGitRoot }, "Failed to stop repository metadata watcher");
            });
        }
        target.workspaceKeys.clear();
    }
}
async function loadForgeSnapshot(options) {
    const forgeService = options.forgeService;
    if (!forgeService) {
        return buildForgeSnapshot("no_remote", null, null);
    }
    // GitHub's isAuthenticated throws the precise CLI-missing / auth error; GitLab's
    // and Gitea's return false without throwing (the precise kind surfaces from
    // the PR-status lookup below instead), so probing them here can't change the
    // outcome and would just be a wasted CLI spawn on every refresh.
    if (forgeService.authProbeCanThrow) {
        try {
            await forgeService.isAuthenticated({ cwd: options.cwd });
        }
        catch (error) {
            return buildForgeSnapshot(forgeAuthStateFromError(error), null, null);
        }
    }
    try {
        const result = await options.deps.getPullRequestStatus(options.cwd, forgeService, {
            force: options.force,
            reason: options.reason,
        }, { facts: options.facts, runGitCommand: options.runGitCommand });
        return buildForgeSnapshot(result.authState, result.status, null);
    }
    catch (error) {
        // The auth probe succeeded, so a failure here is a command error, not an
        // auth problem — surface it as an error while keeping features enabled.
        return buildForgeSnapshot("authenticated", null, {
            message: error instanceof Error ? error.message : String(error),
        });
    }
}
function buildForgeSnapshot(authState, pullRequest, error) {
    return {
        featuresEnabled: authState === "authenticated",
        authState,
        pullRequest,
        error,
    };
}
function parseWorkspaceGitStashList(stdout, options) {
    const entries = [];
    const lines = stdout.trim().split("\n").filter(Boolean);
    for (const line of lines) {
        const sepIdx = line.indexOf("\0");
        if (sepIdx < 0) {
            continue;
        }
        const refPart = line.slice(0, sepIdx);
        const subject = line.slice(sepIdx + 1);
        const indexMatch = refPart.match(/\{(\d+)\}/);
        if (!indexMatch) {
            continue;
        }
        const index = Number(indexMatch[1]);
        const prefix = "paseo-auto-stash:";
        const prefixIdx = subject.indexOf(prefix);
        const isPaseo = prefixIdx >= 0;
        const branch = isPaseo ? subject.slice(prefixIdx + prefix.length).trim() || null : null;
        if (options.paseoOnly && !isPaseo) {
            continue;
        }
        entries.push({ index, message: subject, branch, isPaseo });
    }
    return entries;
}
function buildNotGitSnapshot(cwd) {
    return {
        cwd,
        git: {
            isGit: false,
            repoRoot: null,
            mainRepoRoot: null,
            currentBranch: null,
            remoteUrl: null,
            isPaseoOwnedWorktree: false,
            isDirty: null,
            baseRef: null,
            aheadBehind: null,
            upstreamRef: null,
            aheadOfOrigin: null,
            behindOfOrigin: null,
            hasRemote: false,
            diffStat: null,
        },
        forge: buildForgeUnavailableSnapshot(),
    };
}
function buildForgeUnavailableSnapshot() {
    return buildForgeSnapshot("no_remote", null, null);
}
/**
 * Snapshot for a remote whose host matched no registered forge and no
 * CLI-authenticated host. Deliberate choice: expose the hostname as the open
 * `forge` id with `authState: "unauthenticated"`, because a self-hosted
 * GitLab/Gitea becomes resolvable the moment its CLI is authenticated for
 * that host — so "authenticate" is the actionable next step. The trade-off:
 * a genuinely unsupported host (e.g. Bitbucket) also reads as a login
 * problem; clients that want to distinguish can check the id against the
 * forge registry.
 */
function buildUnresolvedRemoteForgeSnapshot(remoteUrl) {
    const host = remoteUrl ? parseGitRemoteLocation(remoteUrl)?.host : null;
    if (!host) {
        return buildForgeUnavailableSnapshot();
    }
    return { ...buildForgeSnapshot("unauthenticated", null, null), forge: host };
}
function buildForgeSnapshotFromStatus(status, forge) {
    return { ...buildForgeSnapshot("authenticated", status, null), forge };
}
function buildWorkspaceForgePrStatusPollKey({ forge, remoteUrl, target, }) {
    return JSON.stringify([
        forge,
        remoteUrl,
        target.headRef,
        target.headSha ?? null,
        target.headRepositoryOwner ?? null,
    ]);
}
function computeGenericForgeNextInterval(status, consecutiveErrors) {
    const isPending = status?.checksStatus === "pending" ||
        status?.checks?.some((check) => check.status === "pending") === true;
    const baseInterval = isPending
        ? FORGE_PR_STATUS_POLL_FAST_INTERVAL_MS
        : FORGE_PR_STATUS_POLL_SLOW_INTERVAL_MS;
    if (consecutiveErrors <= 1) {
        return baseInterval;
    }
    return Math.min(baseInterval * 2 ** (consecutiveErrors - 1), FORGE_PR_STATUS_POLL_ERROR_BACKOFF_CAP_MS);
}
//# sourceMappingURL=workspace-git-service.js.map