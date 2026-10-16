import { join } from "node:path";
import { WorkspaceLabelCatalogStore } from "./internal/catalog-store.js";
import { WorkspaceLabelService } from "./internal/service.js";
import { WorkspaceLabelSequence } from "./internal/sequence.js";
export { WorkspaceLabelError, WorkspaceLabelService } from "./internal/service.js";
export { WorkspaceLabelStorageUncertainError } from "./internal/catalog-store.js";
export function createWorkspaceLabelService(input) {
    return new WorkspaceLabelService(new WorkspaceLabelCatalogStore(join(input.paseoHome, "projects", "workspace-labels.json"), join(input.paseoHome, "projects", "workspace-labels.transaction.json"), input.workspaceRegistry, input.writeCatalog, input.writeTransaction, input.removeTransaction), new WorkspaceLabelSequence(input.journalLimit));
}
//# sourceMappingURL=index.js.map