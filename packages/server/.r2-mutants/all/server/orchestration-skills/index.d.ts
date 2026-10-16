import type { AgentSkillSelection } from "@getpaseo/protocol/messages";
import type { DaemonConfigStore } from "../daemon-config-store.js";
import { type SkillsSaveResult, type SkillsSnapshot } from "./internal/controller.js";
import { resolveSkillTargets } from "./internal/paths.js";
export interface OrchestrationSkills {
    getStatus(): Promise<SkillsSnapshot>;
    reconcile(): Promise<SkillsSnapshot>;
    uninstall(): Promise<SkillsSnapshot>;
    saveSelection(selection: AgentSkillSelection, confirmedRemovals?: readonly string[]): Promise<SkillsSaveResult>;
    importLegacySelectionIfUnset(selection: AgentSkillSelection): Promise<{
        imported: boolean;
        selection: AgentSkillSelection;
    }>;
    autoUpdate(): Promise<SkillsSnapshot>;
}
export declare function createOrchestrationSkills(configStore: DaemonConfigStore, resolveTargets?: typeof resolveSkillTargets): OrchestrationSkills;
export type { SkillsSaveResult, SkillsSnapshot } from "./internal/controller.js";
//# sourceMappingURL=index.d.ts.map