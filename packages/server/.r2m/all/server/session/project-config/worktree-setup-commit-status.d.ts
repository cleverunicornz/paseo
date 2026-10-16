import { type PaseoConfigRaw } from "@getpaseo/protocol/paseo-config-schema";
export declare function hasUncommittedWorktreeSetupChanges(input: {
    repoRoot: string;
    currentConfig: PaseoConfigRaw | null;
}): Promise<boolean>;
//# sourceMappingURL=worktree-setup-commit-status.d.ts.map