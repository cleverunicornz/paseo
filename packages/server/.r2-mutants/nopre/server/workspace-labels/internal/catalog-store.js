import { promises as fs } from "node:fs";
import { z } from "zod";
import { WorkspaceLabelDefinitionSchema } from "@getpaseo/protocol/messages";
import { writeJsonFileAtomic } from "../../atomic-file.js";
const WorkspaceLabelWorkspaceStateSchema = z.object({
    workspaceId: z.string(),
    labels: z.array(z.string()).optional(),
    updatedAt: z.string(),
});
const WorkspaceLabelTransactionSchema = z.object({
    phase: z.enum(["prepared", "committed"]),
    beforeLabels: z.array(WorkspaceLabelDefinitionSchema),
    afterLabels: z.array(WorkspaceLabelDefinitionSchema),
    beforeWorkspaces: z.array(WorkspaceLabelWorkspaceStateSchema),
    afterWorkspaces: z.array(WorkspaceLabelWorkspaceStateSchema),
});
export class WorkspaceLabelStorageUncertainError extends Error {
    constructor() {
        super("Workspace label storage outcome is uncertain; restart the daemon before retrying");
        this.code = "workspace_label_storage_uncertain";
        this.name = "WorkspaceLabelStorageUncertainError";
    }
}
export class WorkspaceLabelCatalogStore {
    constructor(filePath, transactionPath, workspaces, writeCatalog = writeJsonFileAtomic, writeTransaction = writeJsonFileAtomic, removeTransaction = fs.rm) {
        this.filePath = filePath;
        this.transactionPath = transactionPath;
        this.workspaces = workspaces;
        this.writeCatalog = writeCatalog;
        this.writeTransaction = writeTransaction;
        this.removeTransaction = removeTransaction;
        this.loaded = false;
        this.initializing = null;
        this.labels = [];
        this.blocked = false;
    }
    async initialize() {
        if (this.loaded)
            return;
        if (!this.initializing) {
            this.initializing = this.loadAndRecover().finally(() => {
                this.initializing = null;
            });
        }
        await this.initializing;
    }
    async list() {
        await this.initialize();
        return this.labels.map((label) => ({ ...label }));
    }
    async commit(planner) {
        await this.initialize();
        if (this.blocked)
            throw new WorkspaceLabelStorageUncertainError();
        let mutation;
        let transaction = null;
        const result = await this.workspaces
            .commitWorkspaceLabelMutation({
            stage: (workspaces) => {
                mutation = planner(this.labels, workspaces);
                transaction = transactionFor(this.labels, mutation, workspaces);
                return {
                    updates: mutation.workspaceUpdates,
                    result: mutation.result,
                    forcePersist: mutation.workspaceUpdates.length > 0 || !catalogsEqual(this.labels, mutation.labels),
                };
            },
            beforeWorkspaceWrite: async () => {
                if (!transaction)
                    throw new Error("Workspace label transaction was not staged");
                await this.writeTransaction(this.transactionPath, transaction);
                await this.writeCatalog(this.filePath, transaction.afterLabels);
            },
            afterWorkspaceWrite: async () => {
                if (!transaction)
                    throw new Error("Workspace label transaction was not staged");
                transaction = { ...transaction, phase: "committed" };
                await this.writeTransaction(this.transactionPath, transaction);
            },
            afterCommit: () => {
                this.labels = [...mutation.labels];
            },
        })
            .catch(async (error) => {
            await this.resolveFailedCommit(error);
        });
        await this.removeTransaction(this.transactionPath).catch(() => undefined);
        return result;
    }
    async resolveFailedCommit(error) {
        let durable;
        try {
            durable = await this.readTransaction();
        }
        catch {
            this.blockUntilRestart();
        }
        if (!durable)
            throw error;
        if (durable.phase === "committed") {
            this.blockUntilRestart();
        }
        try {
            await this.recover(durable);
        }
        catch {
            this.blockUntilRestart();
        }
        throw error;
    }
    blockUntilRestart() {
        this.blocked = true;
        this.workspaces.blockAllMutationsUntilRestart();
        throw new WorkspaceLabelStorageUncertainError();
    }
    async loadAndRecover() {
        const transaction = await this.readTransaction();
        if (transaction) {
            await this.recover(transaction);
            this.loaded = true;
            return;
        }
        this.labels = await this.readCatalog();
        this.loaded = true;
    }
    async readCatalog() {
        try {
            const raw = await fs.readFile(this.filePath, "utf8");
            return z.array(WorkspaceLabelDefinitionSchema).parse(JSON.parse(raw));
        }
        catch (error) {
            if (error.code === "ENOENT")
                return [];
            throw error;
        }
    }
    async readTransaction() {
        try {
            return await this.requireTransaction();
        }
        catch (error) {
            if (error.code === "ENOENT")
                return null;
            throw error;
        }
    }
    async requireTransaction() {
        const raw = await fs.readFile(this.transactionPath, "utf8");
        return WorkspaceLabelTransactionSchema.parse(JSON.parse(raw));
    }
    async recover(transaction) {
        if (transaction.phase === "committed") {
            // The marker exists only after both data files are durable. It is cleanup state, never an
            // instruction to replay stale after-images over newer workspace mutations.
            this.labels = await this.readCatalog();
            await this.removeTransaction(this.transactionPath).catch(() => undefined);
            return;
        }
        const labels = transaction.beforeLabels;
        const workspaceStates = transaction.beforeWorkspaces;
        await this.workspaces.commitWorkspaceLabelMutation({
            stage: (workspaces) => ({
                updates: workspaceStates.flatMap((state) => {
                    const current = workspaces.get(state.workspaceId);
                    return current ? [{ ...current, labels: state.labels, updatedAt: state.updatedAt }] : [];
                }),
                result: undefined,
                forcePersist: true,
            }),
            beforeWorkspaceWrite: () => this.writeCatalog(this.filePath, labels),
            afterWorkspaceWrite: () => this.removeTransaction(this.transactionPath),
            afterCommit: () => {
                this.labels = [...labels];
            },
            publish: false,
        });
    }
}
function transactionFor(currentLabels, mutation, workspaces) {
    const beforeWorkspaces = mutation.workspaceUpdates.flatMap((workspace) => {
        const current = workspaces.get(workspace.workspaceId);
        return current ? [workspaceState(current)] : [];
    });
    return {
        phase: "prepared",
        beforeLabels: currentLabels.map((label) => ({ ...label })),
        afterLabels: mutation.labels.map((label) => ({ ...label })),
        beforeWorkspaces,
        afterWorkspaces: mutation.workspaceUpdates.map(workspaceState),
    };
}
function workspaceState(workspace) {
    return {
        workspaceId: workspace.workspaceId,
        ...(workspace.labels ? { labels: [...workspace.labels] } : {}),
        updatedAt: workspace.updatedAt,
    };
}
function catalogsEqual(left, right) {
    return (left.length === right.length &&
        left.every((label, index) => label.name === right[index]?.name && label.color === right[index]?.color));
}
//# sourceMappingURL=catalog-store.js.map