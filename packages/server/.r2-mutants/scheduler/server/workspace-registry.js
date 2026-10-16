import { promises as fs } from "node:fs";
import { z } from "zod";
import { writeJsonFileAtomic } from "./atomic-file.js";
import { areEquivalentPaths } from "../utils/path.js";
import { generateProjectId, } from "./workspace-registry-model.js";
const UntrustedWorkspaceSourceSchema = z.object({
    kind: z.literal("change_request"),
    forge: z.string(),
    number: z.number().int().positive(),
    headRepository: z.string(),
});
const PersistedProjectRecordSchema = z.object({
    projectId: z.string(),
    rootPath: z.string(),
    kind: z.enum(["git", "non_git"]),
    displayName: z.string(),
    // COMPAT(projectKey): added in v0.2.4 on 2026-07-28; remove optional after 2027-01-28.
    projectKey: z
        .string()
        .nullable()
        .optional()
        .transform((value) => value ?? null),
    // User-set override layered over the derived displayName. Reconciliation
    // never touches this. Null means "use the derived name". Added for #987.
    customName: z
        .string()
        .nullable()
        .optional()
        .transform((value) => value ?? null),
    // Identifies the project's stored custom icon; null means automatic.
    customIconRevision: z
        .string()
        .nullable()
        .optional()
        .transform((value) => value ?? null),
    createdAt: z.string(),
    updatedAt: z.string(),
    archivedAt: z.string().nullable(),
});
const PersistedWorkspaceRecordSchema = z.object({
    workspaceId: z.string(),
    projectId: z.string(),
    cwd: z.string(),
    kind: z.enum(["local_checkout", "worktree", "directory"]),
    displayName: z.string(),
    // User-set title layered over the derived displayName. In Model B the title is
    // the workspace identity; branch/directory are backing metadata. Reconciliation
    // never touches this. Null means "use the derived displayName".
    title: z
        .string()
        .nullable()
        .optional()
        .transform((value) => value ?? null),
    // The worktree's git branch. Decoupled from displayName/title by construction:
    // displayName holds the human name (title), branch holds the git branch. Only
    // worktree workspaces carry a branch; directory/local_checkout leave it null.
    branch: z
        .string()
        .nullable()
        .optional()
        .transform((value) => value ?? null),
    // Exact checkout/worktree root backing cwd. This differs from cwd when the
    // selected project is a subdirectory inside a repository. Persist it so
    // archive and recovery do not need the directory to still exist in order to
    // recover placement.
    worktreeRoot: z.string().nullable().default(null),
    // Comparison base preserved across worktree deletion and restore. New branch-off
    // workspaces store the resolved ref (e.g. refs/remotes/upstream/main); legacy and
    // PR checkout records may contain a bare branch name. Ordinary checkouts use null.
    baseBranch: z
        .string()
        .nullable()
        .optional()
        .transform((value) => value ?? null),
    isPaseoOwnedWorktree: z.boolean().default(false),
    mainRepoRoot: z.string().nullable().default(null),
    createdAt: z.string(),
    updatedAt: z.string(),
    archivedAt: z.string().nullable(),
    // COMPAT(autoArchivedChangeRequestUrl): added in v0.2.6, remove optional parsing after 2027-01-31.
    // Records the merged change request whose automatic archive was consumed.
    autoArchivedChangeRequestUrl: z
        .string()
        .nullable()
        .optional()
        .transform((value) => value ?? null),
    pinnedAt: z
        .string()
        .nullable()
        .optional()
        .transform((value) => value ?? null),
    labels: z.array(z.string()).optional(),
    untrustedSource: UntrustedWorkspaceSourceSchema.optional(),
});
class FileBackedRegistry {
    constructor(options) {
        this.loaded = false;
        this.cache = new Map();
        this.mutationQueue = Promise.resolve();
        this.mutationsBlockedUntilRestart = false;
        this.filePath = options.filePath;
        this.schema = options.schema;
        this.getId = options.getId;
        this.logger = options.logger.child({
            module: "workspace-registry",
            component: options.component,
        });
        this.writeRecords = options.writeRecords ?? writeJsonFileAtomic;
    }
    async initialize() {
        await this.load();
    }
    async existsOnDisk() {
        try {
            await fs.access(this.filePath);
            return true;
        }
        catch {
            return false;
        }
    }
    async list() {
        await this.load();
        return Array.from(this.cache.values());
    }
    async get(id) {
        await this.load();
        return this.cache.get(id) ?? null;
    }
    async upsert(record) {
        const parsed = this.schema.parse(record);
        await this.mutateCache((records) => {
            records.set(this.getId(parsed), parsed);
            return undefined;
        });
    }
    async update(id, updater) {
        return this.mutateCache((records) => {
            const existing = records.get(id);
            if (!existing)
                return null;
            const next = this.schema.parse(updater(existing));
            records.set(id, next);
            return next;
        });
    }
    async archive(id, archivedAt) {
        await this.archiveIfPresent(id, archivedAt);
    }
    async archiveIfPresent(id, archivedAt) {
        return this.mutateCache((records) => {
            const existing = records.get(id);
            if (!existing)
                return null;
            const next = this.schema.parse({ ...existing, updatedAt: archivedAt, archivedAt });
            records.set(id, next);
            return next;
        });
    }
    async archiveIfActive(id, archivedAt) {
        return this.mutateCache((records) => {
            const existing = records.get(id);
            if (!existing || existing.archivedAt)
                return null;
            const next = this.schema.parse({ ...existing, updatedAt: archivedAt, archivedAt });
            records.set(id, next);
            return next;
        });
    }
    async remove(id) {
        await this.removeIfPresent(id);
    }
    async removeIfPresent(id) {
        return this.mutateCache((records) => {
            const existing = records.get(id);
            if (!existing)
                return null;
            records.delete(id);
            return existing;
        });
    }
    async load() {
        if (this.loaded) {
            return;
        }
        this.cache.clear();
        try {
            const raw = await fs.readFile(this.filePath, "utf8");
            const parsed = z.array(this.schema).parse(JSON.parse(raw));
            for (const record of parsed) {
                this.cache.set(this.getId(record), record);
            }
        }
        catch (error) {
            const code = error.code;
            if (code !== "ENOENT") {
                this.logger.error({ err: error, filePath: this.filePath }, "Failed to load registry file");
            }
        }
        this.loaded = true;
    }
    async mutateMany(updater) {
        return this.mutateCache((records) => {
            const changed = updater(records);
            if (changed.length === 0)
                return [];
            const parsed = changed.map((record) => this.schema.parse(record));
            for (const record of parsed)
                records.set(this.getId(record), record);
            return parsed;
        });
    }
    async mutateCache(updater, hooks) {
        const previous = this.mutationQueue;
        let release;
        this.mutationQueue = new Promise((resolve) => {
            release = resolve;
        });
        await previous;
        try {
            await this.load();
            if (this.mutationsBlockedUntilRestart) {
                throw new Error("Workspace registry mutations are blocked until daemon restart");
            }
            const staged = new Map(this.cache);
            const result = updater(staged);
            const recordsChanged = !mapsEqual(this.cache, staged);
            if (!recordsChanged && !hooks?.forcePersist?.(result))
                return result;
            const records = Array.from(staged.values());
            await hooks?.beforeWrite?.(records);
            if (recordsChanged)
                await this.writeRecords(this.filePath, records);
            await hooks?.afterWrite?.();
            if (recordsChanged) {
                this.cache.clear();
                for (const [id, record] of staged)
                    this.cache.set(id, record);
            }
            hooks?.afterCommit?.();
            return result;
        }
        finally {
            release();
        }
    }
    freezeMutationsUntilRestart() {
        this.mutationsBlockedUntilRestart = true;
    }
}
function mapsEqual(left, right) {
    if (left.size !== right.size)
        return false;
    for (const [key, value] of left) {
        if (right.get(key) !== value)
            return false;
    }
    return true;
}
export class FileBackedProjectRegistry extends FileBackedRegistry {
    constructor(filePath, logger, options) {
        super({
            filePath,
            logger,
            schema: PersistedProjectRecordSchema,
            getId: (record) => record.projectId,
            component: "projects",
            writeRecords: options?.writeRecords,
        });
        this.allocationQueue = Promise.resolve();
        this.mutationListeners = new Set();
        this.projectIdFactory = options?.projectIdFactory ?? generateProjectId;
    }
    async getOrCreateActiveByRoot(input) {
        const previous = this.allocationQueue;
        let release;
        this.allocationQueue = new Promise((resolve) => (release = resolve));
        await previous;
        try {
            const active = (await this.list())
                .filter((project) => !project.archivedAt && areEquivalentPaths(project.rootPath, input.rootPath))
                .sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt) ||
                left.projectId.localeCompare(right.projectId))[0];
            if (active) {
                if (active.kind === input.kind && active.projectKey === (input.projectKey ?? null))
                    return active;
                const refreshed = {
                    ...active,
                    kind: input.kind,
                    projectKey: input.projectKey ?? null,
                    updatedAt: input.timestamp,
                };
                await this.upsert(refreshed);
                return refreshed;
            }
            for (;;) {
                const projectId = this.projectIdFactory();
                if (await this.get(projectId))
                    continue;
                const record = createPersistedProjectRecord({
                    projectId,
                    rootPath: input.rootPath,
                    kind: input.kind,
                    displayName: input.displayName,
                    projectKey: input.projectKey ?? null,
                    createdAt: input.timestamp,
                    updatedAt: input.timestamp,
                });
                await this.upsert(record);
                return record;
            }
        }
        finally {
            release();
        }
    }
    subscribeToMutations(listener) {
        this.mutationListeners.add(listener);
        return () => this.mutationListeners.delete(listener);
    }
    async upsert(record) {
        await super.upsert(record);
        await this.notifyMutation({ kind: "upsert", projectId: record.projectId, project: record });
    }
    async update(projectId, updater) {
        const project = await super.update(projectId, updater);
        if (!project)
            return null;
        await this.notifyMutation({ kind: "upsert", projectId, project });
        return project;
    }
    async archive(projectId, archivedAt) {
        const project = await this.archiveIfActive(projectId, archivedAt);
        if (!project)
            return;
        await this.notifyMutation({ kind: "archive", projectId, project });
    }
    async remove(projectId) {
        const project = await this.removeIfPresent(projectId);
        if (!project)
            return;
        await this.notifyMutation({ kind: "remove", projectId, project: null });
    }
    async notifyMutation(mutation) {
        await Promise.all([...this.mutationListeners].map((listener) => listener(mutation)));
    }
}
export class FileBackedWorkspaceRegistry extends FileBackedRegistry {
    constructor(filePath, logger, options) {
        super({
            filePath,
            logger,
            schema: PersistedWorkspaceRecordSchema,
            getId: (record) => record.workspaceId,
            component: "workspaces",
            writeRecords: options?.writeRecords,
        });
        this.mutationListeners = new Set();
    }
    subscribeToMutations(listener) {
        this.mutationListeners.add(listener);
        return () => this.mutationListeners.delete(listener);
    }
    async update(workspaceId, updater) {
        const workspace = await super.update(workspaceId, updater);
        if (workspace) {
            await this.notifyMutation({ kind: "upsert", workspaceId, workspace });
        }
        return workspace;
    }
    async upsert(record, context) {
        await super.upsert(record);
        await this.notifyMutation({
            kind: "upsert",
            workspaceId: record.workspaceId,
            workspace: record,
            ...(context?.expectsInitialAgent ? { expectsInitialAgent: true } : {}),
        });
    }
    async archive(workspaceId, archivedAt, context) {
        const workspace = await super.update(workspaceId, (existing) => ({
            ...existing,
            updatedAt: archivedAt,
            archivedAt,
            ...(context?.autoArchivedChangeRequestUrl
                ? { autoArchivedChangeRequestUrl: context.autoArchivedChangeRequestUrl }
                : {}),
        }));
        if (!workspace)
            return;
        await this.notifyMutation({ kind: "archive", workspaceId, workspace });
    }
    async remove(workspaceId) {
        const workspace = await this.removeIfPresent(workspaceId);
        if (!workspace)
            return;
        await this.notifyMutation({ kind: "remove", workspaceId, workspace: null });
    }
    async commitWorkspaceLabelMutation(input) {
        let changed = [];
        const committed = await this.mutateCache((records) => {
            const staged = input.stage(records);
            changed = staged.updates.map((record) => PersistedWorkspaceRecordSchema.parse(record));
            for (const record of changed)
                records.set(record.workspaceId, record);
            return { result: staged.result, forcePersist: staged.forcePersist };
        }, {
            forcePersist: (output) => output.forcePersist,
            beforeWrite: input.beforeWorkspaceWrite,
            afterWrite: input.afterWorkspaceWrite,
            afterCommit: input.afterCommit,
        });
        if (input.publish !== false) {
            await Promise.all(changed.map((workspace) => this.notifyMutation({ kind: "upsert", workspaceId: workspace.workspaceId, workspace })));
        }
        return committed.result;
    }
    blockAllMutationsUntilRestart() {
        this.freezeMutationsUntilRestart();
    }
    async notifyMutation(mutation) {
        await Promise.all([...this.mutationListeners].map(async (listener) => {
            try {
                await listener(mutation);
            }
            catch (error) {
                // Publication happens after the registry commit and cannot make durable state fail.
                this.logger.error({ err: error, mutation }, "Workspace mutation listener failed");
            }
        }));
    }
}
export function createPersistedProjectRecord(input) {
    return PersistedProjectRecordSchema.parse({
        ...input,
        customName: input.customName ?? null,
        projectKey: input.projectKey ?? null,
        customIconRevision: input.customIconRevision ?? null,
        archivedAt: input.archivedAt ?? null,
    });
}
export function resolveProjectDisplayName(record) {
    return record.customName ?? record.displayName;
}
export function createPersistedWorkspaceRecord(input) {
    return PersistedWorkspaceRecordSchema.parse({
        ...input,
        title: input.title ?? null,
        branch: input.branch ?? null,
        worktreeRoot: input.worktreeRoot ?? null,
        baseBranch: input.baseBranch ?? null,
        isPaseoOwnedWorktree: input.isPaseoOwnedWorktree ?? false,
        mainRepoRoot: input.mainRepoRoot ?? null,
        archivedAt: input.archivedAt ?? null,
        autoArchivedChangeRequestUrl: input.autoArchivedChangeRequestUrl ?? null,
        pinnedAt: input.pinnedAt ?? null,
    });
}
// The single workspace-name rule: the title always wins; otherwise fall back to
// the freshest available derived display name (a live branch snapshot when the
// caller has one, the persisted displayName otherwise).
export function resolveWorkspaceName(input) {
    return input.title ?? input.derivedDisplayName;
}
export function resolveWorkspaceDisplayName(record) {
    return resolveWorkspaceName({ title: record.title, derivedDisplayName: record.displayName });
}
//# sourceMappingURL=workspace-registry.js.map