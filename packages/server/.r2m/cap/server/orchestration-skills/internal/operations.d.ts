import type { AgentSkillSelection } from "@getpaseo/protocol/messages";
export type SkillsState = "not-installed" | "up-to-date" | "drift";
export type SkillOp = {
    kind: "add";
    name: string;
} | {
    kind: "update";
    name: string;
} | {
    kind: "delete";
    name: string;
};
/** What the user asked to have installed. `all` follows the bundle as it grows. */
export type SkillSelection = AgentSkillSelection;
export interface SkillsStatus {
    state: SkillsState;
    ops: SkillOp[];
    /** Every skill the bundle currently ships, sorted. The selectable catalog. */
    available: string[];
    /**
     * Managed skills with a directory in at least one agent home, sorted. An `add`
     * op means "missing from at least one target", so it cannot answer whether
     * there is anything on disk to delete — this can.
     */
    installed: string[];
}
export interface SkillTargets {
    sourceDir: string;
    agentsDir: string;
    claudeDir: string;
    codexDir: string;
}
export declare const LEGACY_SKILL_NAMES: readonly ["paseo-chat", "paseo-epic", "paseo-orchestrate", "paseo-orchestrator"];
/** The names a convergence may create, replace, or delete. */
export declare function listManagedSkillNames(sourceDir: string): Promise<string[]>;
export declare function getSkillsStatus(targets: SkillTargets, selection: SkillSelection): Promise<SkillsStatus>;
export declare function installSkills(targets: SkillTargets, selection: SkillSelection, 
/** Apply exactly this plan instead of rescanning, so a confirmed plan is the applied plan. */
plan?: SkillsStatus): Promise<SkillsStatus>;
export declare function updateSkills(targets: SkillTargets, selection: SkillSelection): Promise<SkillsStatus>;
export declare function autoUpdateInstalledSkills(targets: SkillTargets, selection: SkillSelection): Promise<SkillsStatus>;
export declare function uninstallSkills(targets: SkillTargets, selection: SkillSelection): Promise<SkillsStatus>;
//# sourceMappingURL=operations.d.ts.map