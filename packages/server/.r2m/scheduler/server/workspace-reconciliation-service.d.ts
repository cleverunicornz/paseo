import type pino from "pino";
import type { ProjectRegistry, WorkspaceRegistry, PersistedProjectRecord } from "./workspace-registry.js";
import type { WorkspaceGitService } from "./workspace-git-service.js";
import { type MutableWorkspacePlacement } from "./workspace-registry-model.js";
export type ProjectUpdate = {
    kind: "upsert";
    project: PersistedProjectRecord;
} | {
    kind: "remove";
    projectId: string;
};
interface ProjectRootWatcher {
    close(): void;
}
export interface ProjectRootWatch {
    (rootPath: string, options: {
        recursive: false;
    }, onChange: (event: string, filename: string | Buffer | null) => void, onError: (error: Error) => void): ProjectRootWatcher;
}
export interface ReconciliationTimer {
    unref?(): void;
}
export interface ReconciliationClock {
    setTimeout(callback: () => void | Promise<void>, delayMs: number): ReconciliationTimer;
    clearTimeout(timer: ReconciliationTimer): void;
    setInterval(callback: () => void | Promise<void>, delayMs: number): ReconciliationTimer;
    clearInterval(timer: ReconciliationTimer): void;
}
export type ReconciliationChange = {
    kind: "workspace_archived";
    workspaceId: string;
    directory: string;
    reason: string;
} | {
    kind: "project_updated";
    projectId: string;
    directory: string;
    fields: Partial<Pick<PersistedProjectRecord, "kind" | "projectKey">>;
} | {
    kind: "workspace_updated";
    workspaceId: string;
    directory: string;
    fields: Partial<MutableWorkspacePlacement>;
};
export interface ReconciliationResult {
    changesApplied: ReconciliationChange[];
    durationMs: number;
    /**
     * True when the sweep yielded to a full Git queue: it made no live Git read
     * because the queue is the foreground's. The sweep is not an error and
     * nothing surfaces to an agent or a user; the tick simply retries later.
     */
    deferred: boolean;
}
export interface WorkspaceReconciliationServiceOptions {
    serverId?: string;
    projectRegistry: ProjectRegistry;
    workspaceRegistry: WorkspaceRegistry;
    logger: pino.Logger;
    onChanges?: (changes: ReconciliationChange[]) => void;
    workspaceGitService?: Pick<WorkspaceGitService, "getCheckout"> & Partial<Pick<WorkspaceGitService, "peekCachedCheckout">>;
    onProjectUpdate?: (update: ProjectUpdate) => void;
    onWorkspaceArchived?: (workspaceId: string) => void | Promise<void>;
    onWorkspacesChanged?: (workspaceIds: string[]) => Promise<void>;
    watchProjectRoot?: ProjectRootWatch;
    clock?: ReconciliationClock;
    rescanIntervalMs?: number;
    debounceMs?: number;
}
export declare class WorkspaceReconciliationService {
    private readonly serverId;
    private readonly projectRegistry;
    private readonly workspaceRegistry;
    private readonly logger;
    private readonly onChanges;
    private readonly workspaceGitService;
    private readonly onProjectUpdate;
    private readonly onWorkspaceArchived;
    private readonly onWorkspacesChanged;
    private readonly watchProjectRoot;
    private readonly clock;
    private readonly rescanIntervalMs;
    private readonly debounceMs;
    private readonly watchers;
    private unsubscribeRegistry;
    private rescanTimer;
    private debounceTimer;
    private deferredRetryTimer;
    private disposed;
    private started;
    private reconciling;
    private reconcileQueuedMode;
    constructor(options: WorkspaceReconciliationServiceOptions);
    start(): Promise<void>;
    dispose(): void;
    /** Reconciles mutable Git facts only; never archives missing records. */
    reconcileGitMetadata(): Promise<ReconciliationResult>;
    runOnce(): Promise<ReconciliationResult>;
    /** Runs the boot-time convergence path and publishes every affected workspace. */
    reconcileNow(): Promise<void>;
    private reconcileGitMetadataForProjects;
    private reconcileProject;
    private syncProjectRootWatches;
    private scheduleObservedReconciliation;
    private reconcileObservedGitMetadata;
    /**
     * A full Git queue is the sweep yielding to foreground work, not a failure:
     * nothing surfaces to an agent or a user, and the tick retries shortly.
     * Anything else is a real reconciliation failure and is logged as one.
     */
    private handleReconciliationFailure;
    private readCheckout;
    /**
     * The warmed checkout for a cwd, when the Git service exposes one. A cache
     * miss or a service without the peek falls through to a live read, so the
     * sweep stays correct for a directory nothing has observed yet.
     */
    private peekCachedCheckout;
    private inspectDirectory;
}
export {};
//# sourceMappingURL=workspace-reconciliation-service.d.ts.map