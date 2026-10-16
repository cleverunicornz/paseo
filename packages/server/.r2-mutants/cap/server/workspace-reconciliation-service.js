import { statSync, watch as watchPath } from "node:fs";
import { areEquivalentPaths } from "../utils/path.js";
import { deriveProjectKind, reconcileWorkspacePlacement, } from "./workspace-registry-model.js";
import { workspaceIdsForProjects } from "./workspace-directory.js";
import { deriveProjectKey } from "./project-key.js";
import { GitProcessQueueFullError, runWithGitCommandClass } from "../utils/run-git-command.js";
const DEFAULT_RESCAN_INTERVAL_MS = 5 * 60000;
const DEFAULT_DEBOUNCE_MS = 100;
/**
 * How long a tick that yielded to a full Git queue waits before trying again.
 * The sweep is the background class: when the queue is deep it defers, so an
 * agent's or a user's Git command is never made to wait behind it. The retry is
 * short because a deferral means the sweep has work outstanding, not that the
 * five-minute cadence has come round again.
 */
const DEFAULT_DEFERRED_RETRY_MS = 5000;
const systemClock = {
    setTimeout: (callback, delayMs) => setTimeout(() => void callback(), delayMs),
    clearTimeout: (timer) => clearTimeout(timer),
    setInterval: (callback, delayMs) => setInterval(() => void callback(), delayMs),
    clearInterval: (timer) => clearInterval(timer),
};
const watchProjectRoot = (rootPath, options, onChange, onError) => {
    const watcher = watchPath(rootPath, options, onChange);
    watcher.on("error", onError);
    return watcher;
};
export class WorkspaceReconciliationService {
    constructor(options) {
        this.watchers = [];
        this.unsubscribeRegistry = null;
        this.rescanTimer = null;
        this.debounceTimer = null;
        this.deferredRetryTimer = null;
        this.disposed = false;
        this.started = false;
        this.reconciling = false;
        this.reconcileQueuedMode = null;
        this.serverId = options.serverId;
        this.projectRegistry = options.projectRegistry;
        this.workspaceRegistry = options.workspaceRegistry;
        this.logger = options.logger.child({ module: "workspace-reconciliation" });
        this.onChanges = options.onChanges ?? null;
        this.workspaceGitService = options.workspaceGitService ?? null;
        this.onProjectUpdate = options.onProjectUpdate ?? null;
        this.onWorkspaceArchived = options.onWorkspaceArchived ?? null;
        this.onWorkspacesChanged = options.onWorkspacesChanged ?? null;
        this.watchProjectRoot = options.watchProjectRoot ?? watchProjectRoot;
        this.clock = options.clock ?? systemClock;
        this.rescanIntervalMs = options.rescanIntervalMs ?? DEFAULT_RESCAN_INTERVAL_MS;
        this.debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
    }
    async start() {
        if (this.started)
            return;
        this.started = true;
        this.unsubscribeRegistry =
            this.projectRegistry.subscribeToMutations?.(async (mutation) => {
                try {
                    // Project creation does not resolve until its root watch is installed,
                    // closing the git-init race for newly added empty projects.
                    await this.syncProjectRootWatches();
                    if (this.disposed)
                        return;
                    if (mutation.kind === "upsert" && mutation.project && !mutation.project.archivedAt) {
                        this.onProjectUpdate?.({ kind: "upsert", project: mutation.project });
                    }
                    else {
                        this.onProjectUpdate?.({ kind: "remove", projectId: mutation.projectId });
                    }
                }
                catch (error) {
                    this.logger.warn({ err: error }, "Project reconciliation mutation handling failed");
                }
            }) ?? null;
        await this.syncProjectRootWatches();
        this.rescanTimer = this.clock.setInterval(() => this.reconcileObservedGitMetadata("full"), this.rescanIntervalMs);
        this.rescanTimer.unref?.();
    }
    dispose() {
        this.disposed = true;
        this.unsubscribeRegistry?.();
        this.unsubscribeRegistry = null;
        if (this.rescanTimer)
            this.clock.clearInterval(this.rescanTimer);
        if (this.debounceTimer)
            this.clock.clearTimeout(this.debounceTimer);
        if (this.deferredRetryTimer)
            this.clock.clearTimeout(this.deferredRetryTimer);
        for (const { watcher } of this.watchers)
            watcher.close();
        this.watchers.length = 0;
    }
    /** Reconciles mutable Git facts only; never archives missing records. */
    async reconcileGitMetadata() {
        const start = Date.now();
        const changes = [];
        const [projects, workspaces] = await Promise.all([
            this.projectRegistry.list(),
            this.workspaceRegistry.list(),
        ]);
        const workspacesByProject = new Map();
        for (const workspace of workspaces) {
            if (workspace.archivedAt || this.inspectDirectory(workspace.cwd) !== "directory")
                continue;
            const siblings = workspacesByProject.get(workspace.projectId) ?? [];
            siblings.push(workspace);
            workspacesByProject.set(workspace.projectId, siblings);
        }
        try {
            await this.reconcileGitMetadataForProjects(projects.filter((project) => !project.archivedAt && this.inspectDirectory(project.rootPath) === "directory"), workspacesByProject, changes);
        }
        catch (error) {
            if (!(error instanceof GitProcessQueueFullError))
                throw error;
            return { changesApplied: changes, durationMs: Date.now() - start, deferred: true };
        }
        if (changes.length > 0)
            this.onChanges?.(changes);
        return { changesApplied: changes, durationMs: Date.now() - start, deferred: false };
    }
    async runOnce() {
        const start = Date.now();
        const changes = [];
        const allProjects = await this.projectRegistry.list();
        const allWorkspaces = await this.workspaceRegistry.list();
        const activeProjects = allProjects.filter((p) => !p.archivedAt);
        const activeWorkspaces = allWorkspaces.filter((w) => !w.archivedAt);
        const workspaceDirectoryStates = activeWorkspaces.map((workspace) => ({
            workspace,
            state: this.inspectDirectory(workspace.cwd),
        }));
        // Project roots are read after the workspace directories, so a volume that
        // goes away mid-pass leaves its project unreachable rather than its workspaces
        // alone. The skew can only withhold an archive, never produce one.
        const reachableProjectIds = new Set(activeProjects
            .filter((project) => this.inspectDirectory(project.rootPath) === "directory")
            .map((project) => project.projectId));
        const workspacesByProject = new Map();
        for (const { workspace, state } of workspaceDirectoryStates) {
            if (state !== "directory")
                continue;
            const list = workspacesByProject.get(workspace.projectId) ?? [];
            list.push(workspace);
            workspacesByProject.set(workspace.projectId, list);
        }
        // 1. Archive workspaces whose directories no longer exist, but only when the
        //    project they belong to is still reachable. A missing project root means the
        //    whole location is unavailable - an unmounted volume, an offline share, a disk
        //    that has not appeared yet - and absence there proves nothing about the
        //    workspace. Projects already persist through that; their workspaces do too.
        const missingWorkspaces = workspaceDirectoryStates
            .filter(({ workspace, state }) => state === "missing" && reachableProjectIds.has(workspace.projectId))
            .map(({ workspace }) => workspace);
        await Promise.all(missingWorkspaces.map(async (workspace) => {
            const timestamp = new Date().toISOString();
            await this.workspaceRegistry.archive(workspace.workspaceId, timestamp);
            await this.onWorkspaceArchived?.(workspace.workspaceId);
            changes.push({
                kind: "workspace_archived",
                workspaceId: workspace.workspaceId,
                directory: workspace.cwd,
                reason: "directory_missing",
            });
            // Update the in-memory list for the project orphan check below
            const siblings = workspacesByProject.get(workspace.projectId);
            if (siblings) {
                const updated = siblings.filter((w) => w.workspaceId !== workspace.workspaceId);
                workspacesByProject.set(workspace.projectId, updated);
            }
        }));
        // 2. Reconcile mutable git metadata without changing identity or membership.
        //    Projects persist until explicitly removed, even when they currently have
        //    zero active workspaces, so they still reconcile their own metadata.
        try {
            await this.reconcileGitMetadataForProjects(activeProjects.filter((project) => reachableProjectIds.has(project.projectId)), workspacesByProject, changes);
        }
        catch (error) {
            if (!(error instanceof GitProcessQueueFullError))
                throw error;
            // The sweep yielded to the foreground's queue. Whatever it applied before
            // the yield stands; the tick retries. It is not a failure.
            this.onChanges?.(changes);
            return { changesApplied: changes, durationMs: Date.now() - start, deferred: true };
        }
        if (changes.length > 0 && this.onChanges) {
            this.onChanges(changes);
        }
        const result = { changesApplied: changes, durationMs: Date.now() - start, deferred: false };
        if (changes.length > 0) {
            this.logger.info({ changeCount: changes.length, durationMs: result.durationMs, changes }, "Workspace reconciliation applied changes");
        }
        return result;
    }
    /** Runs the boot-time convergence path and publishes every affected workspace. */
    async reconcileNow() {
        await this.reconcileObservedGitMetadata("full");
    }
    async reconcileGitMetadataForProjects(projectsToReconcile, workspacesByProject, changes) {
        const checkoutReads = [];
        const readCheckout = (cwd) => {
            const existing = checkoutReads.find((read) => areEquivalentPaths(read.cwd, cwd));
            if (existing)
                return existing.checkout;
            const checkout = this.readCheckout(cwd);
            checkoutReads.push({ cwd, checkout });
            return checkout;
        };
        const roots = [];
        for (const project of projectsToReconcile) {
            const root = roots.find((candidate) => areEquivalentPaths(candidate.rootPath, project.rootPath));
            if (root)
                root.projects.push(project);
            else
                roots.push({ rootPath: project.rootPath, projects: [project] });
        }
        await Promise.all(roots.map(async ({ rootPath, projects }) => {
            try {
                const rootGit = await readCheckout(rootPath);
                await Promise.all(projects.map((project) => this.reconcileProject({
                    project,
                    siblings: workspacesByProject.get(project.projectId) ?? [],
                    currentGit: rootGit,
                    readCheckout,
                    changes,
                })));
            }
            catch (error) {
                // A full queue is the sweep yielding, not a read failure: it must
                // reach the tick so the tick defers, never be logged as an error.
                if (error instanceof GitProcessQueueFullError) {
                    throw error;
                }
                this.logger.warn({ err: error, rootPath }, "Skipped workspace reconciliation after Git read failed");
            }
        }));
    }
    async reconcileProject(input) {
        const { project, siblings, currentGit, readCheckout, changes } = input;
        const workspaceCheckouts = await Promise.all(siblings.map(async (workspace) => ({
            workspace,
            checkout: await readCheckout(workspace.cwd),
        })));
        const projectUpdates = {};
        const mappedKind = deriveProjectKind(currentGit);
        const projectKey = deriveProjectKey({
            rootPath: project.rootPath,
            remoteUrl: currentGit.remoteUrl,
            worktreeRoot: currentGit.worktreeRoot,
            mainRepoRoot: currentGit.mainRepoRoot,
            serverId: this.serverId,
        });
        if (project.kind !== mappedKind) {
            projectUpdates.kind = mappedKind;
        }
        if (project.projectKey !== projectKey) {
            projectUpdates.projectKey = projectKey;
        }
        if (Object.keys(projectUpdates).length > 0) {
            const timestamp = new Date().toISOString();
            await this.projectRegistry.upsert({
                ...project,
                ...projectUpdates,
                updatedAt: timestamp,
            });
            changes.push({
                kind: "project_updated",
                projectId: project.projectId,
                directory: project.rootPath,
                fields: projectUpdates,
            });
        }
        await Promise.all(workspaceCheckouts.map(async ({ workspace, checkout: wsGit }) => {
            const timestamp = new Date().toISOString();
            const update = reconcileWorkspacePlacement({
                workspace,
                checkout: wsGit,
                updatedAt: timestamp,
            });
            if (!update)
                return;
            const updated = await this.workspaceRegistry.update(workspace.workspaceId, (current) => ({
                ...current,
                ...update.fields,
                updatedAt: timestamp,
            }));
            if (!updated)
                return;
            changes.push({
                kind: "workspace_updated",
                workspaceId: workspace.workspaceId,
                directory: workspace.cwd,
                fields: update.fields,
            });
        }));
    }
    async syncProjectRootWatches() {
        if (this.disposed)
            return;
        const projects = await this.projectRegistry.list();
        if (this.disposed)
            return;
        const activeProjects = projects.filter((project) => !project.archivedAt);
        for (let index = this.watchers.length - 1; index >= 0; index -= 1) {
            const target = this.watchers[index];
            const stillActive = activeProjects.some((project) => areEquivalentPaths(project.rootPath, target.rootPath));
            if (stillActive)
                continue;
            target.watcher.close();
            this.watchers.splice(index, 1);
        }
        for (const project of activeProjects) {
            const alreadyWatching = this.watchers.some((target) => areEquivalentPaths(target.rootPath, project.rootPath));
            if (alreadyWatching)
                continue;
            try {
                let watcher;
                watcher = this.watchProjectRoot(project.rootPath, { recursive: false }, (_event, filename) => {
                    if (filename === null || filename.toString() === ".git") {
                        this.scheduleObservedReconciliation();
                    }
                }, (error) => {
                    watcher.close();
                    const index = this.watchers.findIndex((target) => target.watcher === watcher);
                    if (index >= 0)
                        this.watchers.splice(index, 1);
                    this.logger.warn({ err: error, rootPath: project.rootPath }, "Project root watch failed");
                });
                this.watchers.push({ rootPath: project.rootPath, watcher });
            }
            catch (error) {
                // The periodic reconciliation is the convergence path for roots that
                // are temporarily missing or unwatchable.
                this.logger.debug({ err: error, rootPath: project.rootPath }, "Project root is not watchable yet");
            }
        }
    }
    scheduleObservedReconciliation() {
        if (this.disposed || this.debounceTimer)
            return;
        this.debounceTimer = this.clock.setTimeout(() => {
            this.debounceTimer = null;
            return this.reconcileObservedGitMetadata();
        }, this.debounceMs);
    }
    async reconcileObservedGitMetadata(mode = "metadata") {
        if (this.disposed)
            return;
        if (this.reconciling) {
            if (mode === "full" || this.reconcileQueuedMode === null) {
                this.reconcileQueuedMode = mode;
            }
            return;
        }
        this.reconciling = true;
        try {
            await this.syncProjectRootWatches();
            const result = mode === "full" ? await this.runOnce() : await this.reconcileGitMetadata();
            const workspaceIds = new Set();
            const projectIds = new Set();
            for (const change of result.changesApplied) {
                if (change.kind === "workspace_updated" || change.kind === "workspace_archived") {
                    workspaceIds.add(change.workspaceId);
                }
                if (change.kind === "project_updated")
                    projectIds.add(change.projectId);
            }
            if (projectIds.size > 0) {
                const workspaces = await this.workspaceRegistry.list();
                for (const workspaceId of workspaceIdsForProjects(workspaces, projectIds)) {
                    workspaceIds.add(workspaceId);
                }
            }
            if (!this.disposed && workspaceIds.size > 0) {
                await this.onWorkspacesChanged?.(Array.from(workspaceIds));
            }
        }
        catch (error) {
            if (!this.disposed) {
                this.handleReconciliationFailure(error, mode);
            }
        }
        finally {
            this.reconciling = false;
            if (this.reconcileQueuedMode) {
                const queuedMode = this.reconcileQueuedMode;
                this.reconcileQueuedMode = null;
                void this.reconcileObservedGitMetadata(queuedMode);
            }
        }
    }
    /**
     * A full Git queue is the sweep yielding to foreground work, not a failure:
     * nothing surfaces to an agent or a user, and the tick retries shortly.
     * Anything else is a real reconciliation failure and is logged as one.
     */
    handleReconciliationFailure(error, mode) {
        if (!(error instanceof GitProcessQueueFullError)) {
            this.logger.warn({ err: error }, "Workspace reconciliation failed");
            return;
        }
        this.logger.debug({ maxQueueDepth: error.maxQueueDepth, mode }, "Workspace reconciliation deferred to a full Git queue");
        if (this.deferredRetryTimer) {
            this.clock.clearTimeout(this.deferredRetryTimer);
        }
        this.deferredRetryTimer = this.clock.setTimeout(() => {
            this.deferredRetryTimer = null;
            void this.reconcileObservedGitMetadata(mode);
        }, DEFAULT_DEFERRED_RETRY_MS);
        this.deferredRetryTimer.unref?.();
    }
    async readCheckout(cwd) {
        const cached = this.peekCachedCheckout(cwd);
        if (cached) {
            return cached;
        }
        if (!this.workspaceGitService) {
            return {
                cwd,
                isGit: false,
                currentBranch: null,
                remoteUrl: null,
                worktreeRoot: null,
                isPaseoOwnedWorktree: false,
                mainRepoRoot: null,
            };
        }
        // The sweep's own reads are background: when the queue is deep they yield
        // rather than making foreground work wait. The yield leaves the tick as a
        // GitProcessQueueFullError and is caught as a deferral, never surfaced.
        const service = this.workspaceGitService;
        return runWithGitCommandClass("background", () => service.getCheckout(cwd));
    }
    /**
     * The warmed checkout for a cwd, when the Git service exposes one. A cache
     * miss or a service without the peek falls through to a live read, so the
     * sweep stays correct for a directory nothing has observed yet.
     */
    peekCachedCheckout(cwd) {
        return this.workspaceGitService?.peekCachedCheckout?.(cwd) ?? null;
    }
    inspectDirectory(targetPath) {
        try {
            return statSync(targetPath).isDirectory() ? "directory" : "missing";
        }
        catch (error) {
            if (isMissingPathError(error))
                return "missing";
            this.logger.warn({ err: error, targetPath }, "Skipped workspace reconciliation after directory inspection failed");
            return "unreadable";
        }
    }
}
function isMissingPathError(error) {
    if (typeof error !== "object" || error === null || !("code" in error))
        return false;
    return error.code === "ENOENT" || error.code === "ENOTDIR";
}
//# sourceMappingURL=workspace-reconciliation-service.js.map