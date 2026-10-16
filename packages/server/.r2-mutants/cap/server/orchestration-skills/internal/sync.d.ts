export interface SkillSyncOptions {
    sourceDir: string;
    agentsDir: string;
    claudeDir: string;
    codexDir: string;
    skillNames: readonly string[];
    onSkillError?: (skillName: string, error: unknown) => void;
}
export interface SkillSyncResult {
    changedFiles: number;
    processedSkills: number;
}
interface ManagedFilesManifest {
    version: 1;
    files: Record<string, string>;
}
export declare function listFilesRecursive(rootDir: string): Promise<string[]>;
export declare function readManagedFilesManifest(dstDir: string): Promise<ManagedFilesManifest | null>;
export interface RemoveSkillTargets {
    agentsDir: string;
    claudeDir: string;
    codexDir: string;
}
export declare function removeSkill(skillName: string, targets: RemoveSkillTargets): Promise<void>;
/**
 * Codex also discovers .agents/skills, so its dedicated copy is a leftover. When
 * the Codex skill directory resolves to the shared or Claude copy, it is that
 * copy, and retiring it would delete the install.
 */
export declare function isLegacyCodexCopy(skillName: string, targets: RemoveSkillTargets): Promise<boolean>;
export declare function syncSkills(options: SkillSyncOptions): Promise<SkillSyncResult>;
export {};
//# sourceMappingURL=sync.d.ts.map