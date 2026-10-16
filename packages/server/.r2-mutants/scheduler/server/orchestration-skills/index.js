import { createSkillsController, } from "./internal/controller.js";
import { resolveSkillTargets } from "./internal/paths.js";
import { createSkillSelectionStore } from "./internal/selection-store.js";
export function createOrchestrationSkills(configStore, resolveTargets = resolveSkillTargets) {
    const controller = createSkillsController({
        resolveTargets,
        selectionStore: createSkillSelectionStore(configStore),
    });
    return {
        getStatus: () => controller.status(),
        reconcile: () => controller.update(),
        uninstall: () => controller.uninstall(),
        saveSelection: (selection, confirmedRemovals = []) => controller.save({ ...selection, confirmedRemovals }),
        importLegacySelectionIfUnset: (selection) => controller.importLegacySelectionIfUnset(selection),
        autoUpdate: () => controller.autoUpdate(),
    };
}
//# sourceMappingURL=index.js.map