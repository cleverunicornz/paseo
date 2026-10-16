import type { FileBackedWorkspaceRegistry } from "../workspace-registry.js";
import { WorkspaceLabelService } from "./internal/service.js";
import type { WorkspaceLabelDefinition } from "@getpaseo/protocol/workspace-labels";
export { WorkspaceLabelError, WorkspaceLabelService } from "./internal/service.js";
export { WorkspaceLabelStorageUncertainError } from "./internal/catalog-store.js";
export declare function createWorkspaceLabelService(input: {
    paseoHome: string;
    workspaceRegistry: FileBackedWorkspaceRegistry;
    writeCatalog?: (filePath: string, labels: readonly WorkspaceLabelDefinition[]) => Promise<void>;
    writeTransaction?: (filePath: string, transaction: unknown) => Promise<void>;
    removeTransaction?: (filePath: string) => Promise<void>;
    journalLimit?: number;
}): WorkspaceLabelService;
//# sourceMappingURL=index.d.ts.map