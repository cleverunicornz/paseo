import type { Logger } from "pino";
import { z } from "zod";
import { type PersistedProjectKind, type PersistedWorkspaceKind } from "./workspace-registry-model.js";
import type { UntrustedWorkspaceSource } from "./workspace-automation-gate.js";
declare const PersistedProjectRecordSchema: z.ZodObject<{
    projectId: z.ZodString;
    rootPath: z.ZodString;
    kind: z.ZodEnum<{
        git: "git";
        non_git: "non_git";
    }>;
    displayName: z.ZodString;
    projectKey: z.ZodPipe<z.ZodOptional<z.ZodNullable<z.ZodString>>, z.ZodTransform<string | null, string | null | undefined>>;
    customName: z.ZodPipe<z.ZodOptional<z.ZodNullable<z.ZodString>>, z.ZodTransform<string | null, string | null | undefined>>;
    customIconRevision: z.ZodPipe<z.ZodOptional<z.ZodNullable<z.ZodString>>, z.ZodTransform<string | null, string | null | undefined>>;
    createdAt: z.ZodString;
    updatedAt: z.ZodString;
    archivedAt: z.ZodNullable<z.ZodString>;
}, z.core.$strip>;
declare const PersistedWorkspaceRecordSchema: z.ZodObject<{
    workspaceId: z.ZodString;
    projectId: z.ZodString;
    cwd: z.ZodString;
    kind: z.ZodEnum<{
        local_checkout: "local_checkout";
        worktree: "worktree";
        directory: "directory";
    }>;
    displayName: z.ZodString;
    title: z.ZodPipe<z.ZodOptional<z.ZodNullable<z.ZodString>>, z.ZodTransform<string | null, string | null | undefined>>;
    branch: z.ZodPipe<z.ZodOptional<z.ZodNullable<z.ZodString>>, z.ZodTransform<string | null, string | null | undefined>>;
    worktreeRoot: z.ZodDefault<z.ZodNullable<z.ZodString>>;
    baseBranch: z.ZodPipe<z.ZodOptional<z.ZodNullable<z.ZodString>>, z.ZodTransform<string | null, string | null | undefined>>;
    isPaseoOwnedWorktree: z.ZodDefault<z.ZodBoolean>;
    mainRepoRoot: z.ZodDefault<z.ZodNullable<z.ZodString>>;
    createdAt: z.ZodString;
    updatedAt: z.ZodString;
    archivedAt: z.ZodNullable<z.ZodString>;
    autoArchivedChangeRequestUrl: z.ZodPipe<z.ZodOptional<z.ZodNullable<z.ZodString>>, z.ZodTransform<string | null, string | null | undefined>>;
    pinnedAt: z.ZodPipe<z.ZodOptional<z.ZodNullable<z.ZodString>>, z.ZodTransform<string | null, string | null | undefined>>;
    labels: z.ZodOptional<z.ZodArray<z.ZodString>>;
    untrustedSource: z.ZodOptional<z.ZodObject<{
        kind: z.ZodLiteral<"change_request">;
        forge: z.ZodString;
        number: z.ZodNumber;
        headRepository: z.ZodString;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type PersistedProjectRecord = z.infer<typeof PersistedProjectRecordSchema>;
export type PersistedWorkspaceRecord = z.infer<typeof PersistedWorkspaceRecordSchema>;
export interface WorkspaceMutation {
    kind: "upsert" | "archive" | "remove";
    workspaceId: string;
    workspace: PersistedWorkspaceRecord | null;
    expectsInitialAgent?: boolean;
}
export interface WorkspaceMutationContext {
    expectsInitialAgent?: boolean;
}
export interface WorkspaceArchiveContext {
    autoArchivedChangeRequestUrl?: string;
}
export interface ProjectMutation {
    kind: "upsert" | "archive" | "remove";
    projectId: string;
    project: PersistedProjectRecord | null;
}
export interface ProjectRegistry {
    initialize(): Promise<void>;
    existsOnDisk(): Promise<boolean>;
    list(): Promise<PersistedProjectRecord[]>;
    get(projectId: string): Promise<PersistedProjectRecord | null>;
    getOrCreateActiveByRoot(input: {
        rootPath: string;
        kind: PersistedProjectKind;
        displayName: string;
        projectKey?: string;
        timestamp: string;
    }): Promise<PersistedProjectRecord>;
    upsert(record: PersistedProjectRecord): Promise<void>;
    update(projectId: string, updater: (record: PersistedProjectRecord) => PersistedProjectRecord): Promise<PersistedProjectRecord | null>;
    archive(projectId: string, archivedAt: string): Promise<void>;
    remove(projectId: string): Promise<void>;
    /** Central lifecycle seam for daemon-global project observers. */
    subscribeToMutations?(listener: (mutation: ProjectMutation) => void | Promise<void>): () => void;
}
export interface WorkspaceRegistry {
    initialize(): Promise<void>;
    existsOnDisk(): Promise<boolean>;
    list(): Promise<PersistedWorkspaceRecord[]>;
    get(workspaceId: string): Promise<PersistedWorkspaceRecord | null>;
    update(workspaceId: string, updater: (record: PersistedWorkspaceRecord) => PersistedWorkspaceRecord): Promise<PersistedWorkspaceRecord | null>;
    upsert(record: PersistedWorkspaceRecord, context?: WorkspaceMutationContext): Promise<void>;
    archive(workspaceId: string, archivedAt: string, context?: WorkspaceArchiveContext): Promise<void>;
    remove(workspaceId: string): Promise<void>;
    /** Central lifecycle seam for daemon-global workspace observers. */
    subscribeToMutations?(listener: (mutation: WorkspaceMutation) => void | Promise<void>): () => void;
}
type RegistryRecord = PersistedProjectRecord | PersistedWorkspaceRecord;
declare class FileBackedRegistry<TRecord extends RegistryRecord> {
    private readonly filePath;
    protected readonly logger: Logger;
    private readonly schema;
    private readonly getId;
    private loaded;
    private readonly cache;
    private mutationQueue;
    private mutationsBlockedUntilRestart;
    private readonly writeRecords;
    constructor(options: {
        filePath: string;
        logger: Logger;
        schema: z.ZodType<TRecord, unknown>;
        getId: (record: TRecord) => string;
        component: string;
        writeRecords?: (filePath: string, records: readonly TRecord[]) => Promise<void>;
    });
    initialize(): Promise<void>;
    existsOnDisk(): Promise<boolean>;
    list(): Promise<TRecord[]>;
    get(id: string): Promise<TRecord | null>;
    upsert(record: TRecord): Promise<void>;
    update(id: string, updater: (record: TRecord) => TRecord): Promise<TRecord | null>;
    archive(id: string, archivedAt: string): Promise<void>;
    protected archiveIfPresent(id: string, archivedAt: string): Promise<TRecord | null>;
    protected archiveIfActive(id: string, archivedAt: string): Promise<TRecord | null>;
    remove(id: string): Promise<void>;
    protected removeIfPresent(id: string): Promise<TRecord | null>;
    private load;
    protected mutateMany(updater: (records: ReadonlyMap<string, TRecord>) => readonly TRecord[]): Promise<TRecord[]>;
    protected mutateCache<TResult>(updater: (records: Map<string, TRecord>) => TResult, hooks?: {
        forcePersist?: (result: TResult) => boolean;
        beforeWrite?: (records: readonly TRecord[]) => Promise<void>;
        afterWrite?: () => Promise<void>;
        afterCommit?: () => void;
    }): Promise<TResult>;
    protected freezeMutationsUntilRestart(): void;
}
export declare class FileBackedProjectRegistry extends FileBackedRegistry<PersistedProjectRecord> implements ProjectRegistry {
    private allocationQueue;
    private readonly projectIdFactory;
    private readonly mutationListeners;
    constructor(filePath: string, logger: Logger, options?: {
        projectIdFactory?: () => string;
        writeRecords?: (filePath: string, records: readonly PersistedProjectRecord[]) => Promise<void>;
    });
    getOrCreateActiveByRoot(input: {
        rootPath: string;
        kind: PersistedProjectKind;
        displayName: string;
        projectKey?: string;
        timestamp: string;
    }): Promise<PersistedProjectRecord>;
    subscribeToMutations(listener: (mutation: {
        kind: "upsert" | "archive" | "remove";
        projectId: string;
        project: PersistedProjectRecord | null;
    }) => void | Promise<void>): () => void;
    upsert(record: PersistedProjectRecord): Promise<void>;
    update(projectId: string, updater: (record: PersistedProjectRecord) => PersistedProjectRecord): Promise<PersistedProjectRecord | null>;
    archive(projectId: string, archivedAt: string): Promise<void>;
    remove(projectId: string): Promise<void>;
    private notifyMutation;
}
export declare class FileBackedWorkspaceRegistry extends FileBackedRegistry<PersistedWorkspaceRecord> implements WorkspaceRegistry {
    private readonly mutationListeners;
    constructor(filePath: string, logger: Logger, options?: {
        writeRecords?: (filePath: string, records: readonly PersistedWorkspaceRecord[]) => Promise<void>;
    });
    subscribeToMutations(listener: (mutation: WorkspaceMutation) => void | Promise<void>): () => void;
    update(workspaceId: string, updater: (record: PersistedWorkspaceRecord) => PersistedWorkspaceRecord): Promise<PersistedWorkspaceRecord | null>;
    upsert(record: PersistedWorkspaceRecord, context?: WorkspaceMutationContext): Promise<void>;
    archive(workspaceId: string, archivedAt: string, context?: WorkspaceArchiveContext): Promise<void>;
    remove(workspaceId: string): Promise<void>;
    commitWorkspaceLabelMutation<TResult>(input: {
        stage: (records: ReadonlyMap<string, PersistedWorkspaceRecord>) => {
            updates: readonly PersistedWorkspaceRecord[];
            result: TResult;
            forcePersist: boolean;
        };
        beforeWorkspaceWrite: (records: readonly PersistedWorkspaceRecord[]) => Promise<void>;
        afterWorkspaceWrite: () => Promise<void>;
        afterCommit: () => void;
        publish?: boolean;
    }): Promise<TResult>;
    blockAllMutationsUntilRestart(): void;
    private notifyMutation;
}
export declare function createPersistedProjectRecord(input: {
    projectId: string;
    rootPath: string;
    kind: PersistedProjectKind;
    displayName: string;
    customName?: string | null;
    projectKey?: string | null;
    customIconRevision?: string | null;
    createdAt: string;
    updatedAt: string;
    archivedAt?: string | null;
}): PersistedProjectRecord;
export declare function resolveProjectDisplayName(record: PersistedProjectRecord): string;
export declare function createPersistedWorkspaceRecord(input: {
    workspaceId: string;
    projectId: string;
    cwd: string;
    kind: PersistedWorkspaceKind;
    displayName: string;
    title?: string | null;
    branch?: string | null;
    worktreeRoot?: string | null;
    baseBranch?: string | null;
    isPaseoOwnedWorktree?: boolean;
    mainRepoRoot?: string | null;
    createdAt: string;
    updatedAt: string;
    archivedAt?: string | null;
    autoArchivedChangeRequestUrl?: string | null;
    pinnedAt?: string | null;
    labels?: string[];
    untrustedSource?: UntrustedWorkspaceSource;
}): PersistedWorkspaceRecord;
export declare function resolveWorkspaceName(input: {
    title: string | null;
    derivedDisplayName: string;
}): string;
export declare function resolveWorkspaceDisplayName(record: PersistedWorkspaceRecord): string;
export {};
//# sourceMappingURL=workspace-registry.d.ts.map