import type { AgentSkillSelection } from "@getpaseo/protocol/messages";
import type { DaemonConfigStore } from "../../daemon-config-store.js";
export type SkillSelection = AgentSkillSelection;
export interface SkillSelectionStore {
    get(): Promise<SkillSelection>;
    set(selection: unknown): Promise<SkillSelection>;
    isSet(): Promise<boolean>;
}
export declare function coerceSkillNames(value: unknown): string[];
export declare function coerceSkillSelection(value: unknown): SkillSelection;
export declare function createSkillSelectionStore(configStore: Pick<DaemonConfigStore, "get" | "setAgentSkillSelection">): SkillSelectionStore;
//# sourceMappingURL=selection-store.d.ts.map