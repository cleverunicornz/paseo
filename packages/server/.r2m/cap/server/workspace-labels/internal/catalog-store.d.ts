import type { WorkspaceLabelDefinition } from "@getpaseo/protocol/workspace-labels";
import type { PersistedWorkspaceRecord } from "../../workspace-registry.js";
interface WorkspaceLabelCompoundRegistry {
    blockAllMutationsUntilRestart(): void;
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
}
interface WorkspaceLabelMutation<TResult> {
    labels: WorkspaceLabelDefinition[];
    workspaceUpdates: PersistedWorkspaceRecord[];
    result: TResult;
}
export declare class WorkspaceLabelStorageUncertainError extends Error {
    readonly code = "workspace_label_storage_uncertain";
    constructor();
}
export declare class WorkspaceLabelCatalogStore {
    private readonly filePath;
    private readonly transactionPath;
    private readonly workspaces;
    private readonly writeCatalog;
    private readonly writeTransaction;
    private readonly removeTransaction;
    private loaded;
    private initializing;
    private labels;
    private blocked;
    constructor(filePath: string, transactionPath: string, workspaces: WorkspaceLabelCompoundRegistry, writeCatalog?: (filePath: string, labels: readonly WorkspaceLabelDefinition[]) => Promise<void>, writeTransaction?: (filePath: string, transaction: unknown) => Promise<void>, removeTransaction?: (filePath: string) => Promise<void>);
    initialize(): Promise<void>;
    list(): Promise<WorkspaceLabelDefinition[]>;
    commit<TResult>(planner: (labels: readonly WorkspaceLabelDefinition[], workspaces: ReadonlyMap<string, PersistedWorkspaceRecord>) => WorkspaceLabelMutation<TResult>): Promise<TResult>;
    private resolveFailedCommit;
    private blockUntilRestart;
    private loadAndRecover;
    private readCatalog;
    private readTransaction;
    private requireTransaction;
    private recover;
}
export {};
//# sourceMappingURL=catalog-store.d.ts.map