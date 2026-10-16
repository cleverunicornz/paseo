import type { ForgeService } from "../services/forge-service.js";
import type { WorktreeSource } from "../utils/worktree.js";
export type WorktreeCreationIntent = Exclude<WorktreeSource, {
    kind: "restore" | "restore-from-base";
}>;
export interface ResolveWorktreeCreationIntentInput {
    worktreeSlug?: string;
    branchName?: string;
    refName?: string;
    action?: "branch-off" | "checkout";
    checkoutSource?: {
        kind: "change_request";
        forge?: string;
        number: number;
        projectPath?: string;
    };
    /**
     * COMPAT(githubPrNumber): legacy GitHub checkout input retained when
     * checkoutSource shipped in v0.2.0-beta.1. Remove after 2027-01-17 once the
     * supported client floor is >= v0.2.0.
     */
    githubPrNumber?: number;
}
export interface ResolveWorktreeCreationIntentDeps {
    forge: string;
    forgeService: ForgeService;
    resolveDefaultBranch: (repoRoot: string) => Promise<string>;
}
export declare class MissingCheckoutTargetError extends Error {
    readonly action = "checkout";
    constructor();
}
export declare class UnsupportedForgeCheckoutTargetError extends Error {
    readonly forge: string;
    constructor(forge: string);
}
export declare class CheckoutSourceForgeMismatchError extends Error {
    readonly checkoutSourceForge: string;
    readonly workspaceForge: string;
    constructor(params: {
        checkoutSourceForge: string;
        workspaceForge: string;
    });
}
export declare function resolveWorktreeCreationIntent(input: ResolveWorktreeCreationIntentInput, repoRoot: string, deps: ResolveWorktreeCreationIntentDeps): Promise<WorktreeCreationIntent>;
//# sourceMappingURL=resolve-worktree-creation-intent.d.ts.map