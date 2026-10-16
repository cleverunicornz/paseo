import { type SkillSelection, type SkillsStatus, type SkillTargets } from "./operations.js";
import { type SkillSelectionStore } from "./selection-store.js";
/** Everything the settings UI needs to render skills in one round trip. */
export interface SkillsSnapshot extends SkillsStatus {
    selection: SkillSelection;
}
export interface SkillsSaveResult extends SkillsSnapshot {
    /**
     * Non-null when the save did nothing because these directories would be
     * deleted and the request had not confirmed them. Retry with the names.
     */
    confirmationRequired: {
        removals: string[];
    } | null;
}
export interface SkillsController {
    status(): Promise<SkillsSnapshot>;
    install(): Promise<SkillsSnapshot>;
    update(): Promise<SkillsSnapshot>;
    uninstall(): Promise<SkillsSnapshot>;
    autoUpdate(): Promise<SkillsSnapshot>;
    save(request: unknown): Promise<SkillsSaveResult>;
    importLegacySelectionIfUnset(selection: unknown): Promise<{
        imported: boolean;
        selection: SkillSelection;
    }>;
}
/**
 * The single writer for installed skills. Startup convergence and every settings
 * command run through one queue, so no operation applies a plan computed from a
 * selection another one has already replaced, and no read sees a half-applied
 * directory. Ordering between concurrent callers is not promised — consistency
 * after both finish is.
 */
export declare function createSkillsController({ resolveTargets, selectionStore, }: {
    resolveTargets: () => SkillTargets;
    selectionStore: SkillSelectionStore;
}): SkillsController;
//# sourceMappingURL=controller.d.ts.map