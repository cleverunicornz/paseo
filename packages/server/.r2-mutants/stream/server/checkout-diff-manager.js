import { expandTilde } from "../utils/path.js";
import { toCheckoutError } from "./checkout-git-utils.js";
const CHECKOUT_DIFF_WATCH_DEBOUNCE_MS = 150;
export class CheckoutDiffManager {
    constructor(options) {
        this.targets = new Map();
        this.workspaceGitService = options.workspaceGitService;
    }
    async read(params) {
        return this.computeCheckoutDiffSnapshot(params.cwd, this.normalizeCompare(params.compare));
    }
    async subscribe(params, listener) {
        const cwd = params.cwd;
        const compare = this.normalizeCompare(params.compare);
        const target = this.ensureTarget(cwd, compare);
        target.listeners.add(listener);
        target.openPromise ?? (target.openPromise = this.openTarget(target));
        let isSubscribed = true;
        const unsubscribe = () => {
            if (!isSubscribed) {
                return;
            }
            isSubscribed = false;
            params.signal?.removeEventListener("abort", unsubscribe);
            this.removeListener(target, listener);
        };
        params.signal?.addEventListener("abort", unsubscribe, { once: true });
        if (params.signal?.aborted) {
            unsubscribe();
        }
        try {
            await target.openPromise;
            const initial = target.latestPayload ??
                (await this.computeCheckoutDiffSnapshot(target.cwd, target.compare, {
                    diffCwd: target.diffCwd,
                }));
            target.latestPayload = initial;
            target.latestFingerprint = JSON.stringify(initial);
            return { initial, unsubscribe };
        }
        catch (error) {
            unsubscribe();
            throw error;
        }
    }
    scheduleRefreshForCwd(cwd) {
        const resolvedCwd = expandTilde(cwd);
        for (const target of this.targets.values()) {
            if (target.cwd !== resolvedCwd && target.diffCwd !== resolvedCwd) {
                continue;
            }
            this.scheduleTargetRefresh(target);
        }
    }
    getMetrics() {
        let checkoutDiffSubscriptionCount = 0;
        for (const target of this.targets.values()) {
            checkoutDiffSubscriptionCount += target.listeners.size;
        }
        return {
            checkoutDiffTargetCount: this.targets.size,
            checkoutDiffSubscriptionCount,
            checkoutDiffWatcherCount: 0,
            checkoutDiffFallbackRefreshTargetCount: 0,
        };
    }
    dispose() {
        for (const target of this.targets.values()) {
            this.closeTarget(target);
        }
        this.targets.clear();
    }
    normalizeCompare(compare) {
        const ignoreWhitespace = compare.ignoreWhitespace === true;
        if (compare.mode === "uncommitted") {
            return { mode: "uncommitted", ignoreWhitespace };
        }
        const trimmedBaseRef = compare.baseRef?.trim();
        return trimmedBaseRef
            ? { mode: "base", baseRef: trimmedBaseRef, ignoreWhitespace }
            : { mode: "base", ignoreWhitespace };
    }
    buildTargetKey(cwd, compare) {
        return JSON.stringify([
            cwd,
            compare.mode,
            compare.mode === "base" ? (compare.baseRef ?? "") : "",
            compare.ignoreWhitespace === true,
        ]);
    }
    closeTarget(target) {
        if (target.debounceTimer) {
            clearTimeout(target.debounceTimer);
            target.debounceTimer = null;
        }
        target.workingTreeWatchUnsubscribe?.();
        target.workingTreeWatchUnsubscribe = null;
        target.workspaceGitUnsubscribe?.();
        target.workspaceGitUnsubscribe = null;
        target.listeners.clear();
    }
    rememberWorkspaceSnapshot(target, snapshot) {
        const structureFingerprint = JSON.stringify({
            isGit: snapshot.git.isGit,
            repoRoot: snapshot.git.repoRoot,
            mainRepoRoot: snapshot.git.mainRepoRoot,
            currentBranch: snapshot.git.currentBranch,
            remoteUrl: snapshot.git.remoteUrl,
            isPaseoOwnedWorktree: snapshot.git.isPaseoOwnedWorktree,
            baseRef: snapshot.git.baseRef,
            aheadBehind: snapshot.git.aheadBehind,
            aheadOfOrigin: snapshot.git.aheadOfOrigin,
            behindOfOrigin: snapshot.git.behindOfOrigin,
            hasRemote: snapshot.git.hasRemote,
        });
        const worktreeFingerprint = JSON.stringify({
            isDirty: snapshot.git.isDirty,
            diffStat: snapshot.git.diffStat,
        });
        const forgeFingerprint = JSON.stringify(snapshot.forge);
        const previousStructureFingerprint = target.latestWorkspaceStructureFingerprint;
        const previousWorktreeFingerprint = target.latestWorkspaceWorktreeFingerprint;
        const previousForgeFingerprint = target.latestWorkspaceForgeFingerprint;
        target.latestWorkspaceStructureFingerprint = structureFingerprint;
        target.latestWorkspaceWorktreeFingerprint = worktreeFingerprint;
        target.latestWorkspaceForgeFingerprint = forgeFingerprint;
        if (previousStructureFingerprint === null) {
            return;
        }
        const structureChanged = structureFingerprint !== previousStructureFingerprint;
        const worktreeChanged = worktreeFingerprint !== previousWorktreeFingerprint;
        const forgeChanged = forgeFingerprint !== previousForgeFingerprint;
        if (structureChanged || (!worktreeChanged && !forgeChanged)) {
            this.scheduleTargetRefresh(target, false);
        }
    }
    removeListener(target, listener) {
        target.listeners.delete(listener);
        if (target.listeners.size > 0) {
            return;
        }
        this.closeTarget(target);
        if (this.targets.get(target.key) === target) {
            this.targets.delete(target.key);
        }
    }
    scheduleTargetRefresh(target, force = true) {
        target.pendingDebounceForce || (target.pendingDebounceForce = force);
        if (target.debounceTimer) {
            clearTimeout(target.debounceTimer);
        }
        target.debounceTimer = setTimeout(() => {
            target.debounceTimer = null;
            const pendingForce = target.pendingDebounceForce;
            target.pendingDebounceForce = false;
            void this.refreshTarget(target, pendingForce);
        }, CHECKOUT_DIFF_WATCH_DEBOUNCE_MS);
    }
    async computeCheckoutDiffSnapshot(cwd, compare, options) {
        const diffCwd = options?.diffCwd ?? cwd;
        try {
            const diffResult = await this.workspaceGitService.getCheckoutDiff(diffCwd, {
                mode: compare.mode,
                baseRef: compare.baseRef,
                ignoreWhitespace: compare.ignoreWhitespace,
                includeStructured: true,
            }, options?.force
                ? { force: true, reason: options.reason ?? "checkout-diff-refresh" }
                : undefined);
            if (diffResult.diffTooLarge) {
                return {
                    cwd,
                    files: [],
                    diffTooLarge: true,
                    error: toCheckoutError(new Error("Diff too large to display")),
                };
            }
            const files = [...(diffResult.structured ?? [])];
            files.sort((a, b) => {
                if (a.path === b.path)
                    return 0;
                return a.path < b.path ? -1 : 1;
            });
            return {
                cwd,
                files,
                error: null,
            };
        }
        catch (error) {
            return {
                cwd,
                files: [],
                error: toCheckoutError(error),
            };
        }
    }
    async refreshTarget(target, force) {
        if (target.refreshPromise) {
            target.refreshQueued = true;
            target.refreshQueuedForce || (target.refreshQueuedForce = force);
            return;
        }
        target.refreshPromise = (async () => {
            let currentForce = force;
            do {
                target.refreshQueued = false;
                target.refreshQueuedForce = false;
                const snapshot = await this.computeCheckoutDiffSnapshot(target.cwd, target.compare, {
                    diffCwd: target.diffCwd,
                    force: currentForce,
                    ...(currentForce ? { reason: "working-tree-watch" } : {}),
                });
                target.latestPayload = snapshot;
                const fingerprint = JSON.stringify(snapshot);
                if (fingerprint !== target.latestFingerprint) {
                    target.latestFingerprint = fingerprint;
                    for (const listener of target.listeners) {
                        listener(snapshot);
                    }
                }
                currentForce = target.refreshQueuedForce;
            } while (target.refreshQueued);
        })();
        try {
            await target.refreshPromise;
        }
        finally {
            target.refreshPromise = null;
        }
    }
    ensureTarget(cwd, compare) {
        const targetKey = this.buildTargetKey(cwd, compare);
        const existing = this.targets.get(targetKey);
        if (existing) {
            return existing;
        }
        const target = {
            key: targetKey,
            cwd,
            diffCwd: cwd,
            compare,
            listeners: new Set(),
            workingTreeWatchUnsubscribe: null,
            workspaceGitUnsubscribe: null,
            latestWorkspaceStructureFingerprint: null,
            latestWorkspaceWorktreeFingerprint: null,
            latestWorkspaceForgeFingerprint: null,
            debounceTimer: null,
            pendingDebounceForce: false,
            refreshPromise: null,
            refreshQueued: false,
            refreshQueuedForce: false,
            latestPayload: null,
            latestFingerprint: null,
            openPromise: null,
        };
        this.targets.set(targetKey, target);
        return target;
    }
    async openTarget(target) {
        if (target.compare.mode === "base") {
            const snapshot = this.workspaceGitService.peekSnapshot(target.cwd) ??
                (await this.workspaceGitService.getSnapshot(target.cwd, { includeForge: false }));
            target.diffCwd = snapshot.git.repoRoot ?? target.cwd;
            if (this.targets.get(target.key) !== target || target.listeners.size === 0) {
                return;
            }
            this.rememberWorkspaceSnapshot(target, snapshot);
            const workspaceSubscription = this.workspaceGitService.registerWorkspace({ cwd: target.cwd }, (nextSnapshot) => this.rememberWorkspaceSnapshot(target, nextSnapshot));
            if (this.targets.get(target.key) !== target || target.listeners.size === 0) {
                workspaceSubscription.unsubscribe();
                return;
            }
            target.workspaceGitUnsubscribe = workspaceSubscription.unsubscribe;
            return;
        }
        const { repoRoot, unsubscribe } = await this.workspaceGitService.requestWorkingTreeWatch(target.cwd, () => this.scheduleTargetRefresh(target));
        target.diffCwd = repoRoot ?? target.cwd;
        if (this.targets.get(target.key) !== target || target.listeners.size === 0) {
            unsubscribe();
            return;
        }
        target.workingTreeWatchUnsubscribe = unsubscribe;
    }
}
//# sourceMappingURL=checkout-diff-manager.js.map