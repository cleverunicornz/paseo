import type { ProjectCheckoutLitePayload, ProjectPlacementPayload } from "@getpaseo/protocol/messages";
import type { PersistedWorkspaceRecord } from "./workspace-registry.js";
export type PersistedProjectKind = "git" | "non_git";
export type PersistedWorkspaceKind = "local_checkout" | "worktree" | "directory";
export declare function generateWorkspaceId(): string;
export declare function generateProjectId(): string;
export declare function deriveProjectKind(checkout: ProjectCheckoutLitePayload): PersistedProjectKind;
export declare function deriveWorkspaceKind(checkout: ProjectCheckoutLitePayload): PersistedWorkspaceKind;
export declare function deriveWorkspaceDisplayName(input: {
    cwd: string;
    checkout: ProjectCheckoutLitePayload;
}): string;
export type PersistedWorkspacePlacement = Pick<PersistedWorkspaceRecord, "cwd" | "kind" | "displayName" | "branch" | "worktreeRoot" | "baseBranch" | "isPaseoOwnedWorktree" | "mainRepoRoot">;
export type MutableWorkspacePlacement = Pick<PersistedWorkspaceRecord, "kind" | "branch" | "worktreeRoot" | "isPaseoOwnedWorktree" | "mainRepoRoot">;
export type InitialWorkspacePlacementInput = {
    source: "checkout";
    cwd: string;
    checkout: ProjectCheckoutLitePayload;
} | {
    source: "created_worktree";
    cwd: string;
    worktreeRoot: string;
    branch: string | null;
    baseBranch: string | null;
    mainRepoRoot: string;
};
export interface WorkspacePlacementUpdate {
    workspace: PersistedWorkspaceRecord;
    fields: Partial<MutableWorkspacePlacement>;
}
/** Defines the complete persisted placement for every new workspace. */
export declare function initialWorkspacePlacement(input: InitialWorkspacePlacementInput): PersistedWorkspacePlacement;
/**
 * Applies live placement facts without rewriting the workspace's durable name
 * or its creation-time base branch.
 *
 * A null checkout is an absence, not an observation: nothing was read at the
 * workspace directory, so the recorded placement stands. Only a directory that
 * is there can show that a worktree stopped being one.
 */
export declare function reconcileWorkspacePlacement(input: {
    workspace: PersistedWorkspaceRecord;
    checkout: ProjectCheckoutLitePayload | null;
    updatedAt: string;
}): WorkspacePlacementUpdate | null;
/** Projects persisted placement onto the checkout shape sent over the wire. */
export declare function checkoutFromPersistedWorkspacePlacement(input: {
    workspace: PersistedWorkspaceRecord;
    fallbackBranch?: string | null;
    fallbackWorktreeRoot?: string | null;
}): ProjectPlacementPayload["checkout"];
export declare function checkoutLiteFromGitSnapshot(cwd: string, git: {
    isGit: boolean;
    currentBranch: string | null;
    remoteUrl: string | null;
    repoRoot: string | null;
    isPaseoOwnedWorktree: boolean;
    mainRepoRoot: string | null;
}): ProjectCheckoutLitePayload;
//# sourceMappingURL=workspace-registry-model.d.ts.map