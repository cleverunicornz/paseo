import { z } from "zod";
declare const ChangeRequestLookupTargetSchema: z.ZodObject<{
    headRef: z.ZodString;
    headRepositoryOwner: z.ZodOptional<z.ZodString>;
    changeRequestNumber: z.ZodOptional<z.ZodNumber>;
    localBranchName: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
declare const PaseoWorktreeMetadataSchema: z.ZodUnion<readonly [z.ZodObject<{
    version: z.ZodLiteral<1>;
    baseRefName: z.ZodString;
    baseRef: z.ZodOptional<z.ZodString>;
    changeRequestLookupTarget: z.ZodOptional<z.ZodObject<{
        headRef: z.ZodString;
        headRepositoryOwner: z.ZodOptional<z.ZodString>;
        changeRequestNumber: z.ZodOptional<z.ZodNumber>;
        localBranchName: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
}, z.core.$strip>, z.ZodObject<{
    version: z.ZodLiteral<2>;
    baseRefName: z.ZodString;
    baseRef: z.ZodOptional<z.ZodString>;
    changeRequestLookupTarget: z.ZodOptional<z.ZodObject<{
        headRef: z.ZodString;
        headRepositoryOwner: z.ZodOptional<z.ZodString>;
        changeRequestNumber: z.ZodOptional<z.ZodNumber>;
        localBranchName: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
    firstAgentBranchAutoName: z.ZodOptional<z.ZodDiscriminatedUnion<[z.ZodObject<{
        status: z.ZodLiteral<"pending">;
        placeholderBranchName: z.ZodString;
    }, z.core.$strip>, z.ZodObject<{
        status: z.ZodLiteral<"attempted">;
        placeholderBranchName: z.ZodString;
        attemptedAt: z.ZodString;
    }, z.core.$strip>], "status">>;
    runtime: z.ZodOptional<z.ZodObject<{
        worktreePort: z.ZodNumber;
    }, z.core.$strip>>;
}, z.core.$strip>]>;
export type PaseoWorktreeMetadata = z.infer<typeof PaseoWorktreeMetadataSchema>;
export type PaseoWorktreeChangeRequestHint = z.infer<typeof ChangeRequestLookupTargetSchema>;
export declare function createPaseoWorktreeChangeRequestHint(input: PaseoWorktreeChangeRequestHint): PaseoWorktreeChangeRequestHint;
export declare function getPaseoWorktreeChangeRequestHintForBranch(metadata: PaseoWorktreeMetadata | null, currentBranch: string): PaseoWorktreeChangeRequestHint | null;
export declare function rebindPaseoWorktreeChangeRequestHint(worktreeRoot: string, previousBranch: string, currentBranch: string): boolean;
export declare function pinPaseoWorktreeBranchIdentityIfMissing(worktreeRoot: string, branch: string): boolean;
export declare function getPaseoWorktreeMetadataPath(worktreeRoot: string): string;
export declare function isQualifiedRef(ref: string): boolean;
/**
 * The human-readable branch name behind a ref. Display and legacy identity only — it cannot
 * round-trip, so anything that has to resolve to a commit keeps the exact ref instead.
 *
 * refs/remotes/<remote>/<branch> works for any remote, not just origin. Git allows slashes in
 * remote names, so refs/remotes/a/b/c is ambiguous and the first segment is read as the
 * remote: slashes are everywhere in branch names and rare in remote names. A remote genuinely
 * named "team/upstream" therefore displays as "upstream/main" rather than "main"; the exact
 * ref is unaffected, which is why this is display-only.
 */
export declare function branchNameFromRef(ref: string): string;
export declare function normalizeBaseRefName(input: string): string;
export declare function writePaseoWorktreeMetadata(worktreeRoot: string, options: {
    baseRefName: string;
    baseRef?: string;
    changeRequestLookupTarget?: PaseoWorktreeChangeRequestHint;
}): void;
export declare function writePaseoWorktreeRuntimeMetadata(worktreeRoot: string, options: {
    worktreePort: number;
}): void;
export declare function writePaseoWorktreeFirstAgentBranchAutoNameMetadata(worktreeRoot: string, options: {
    placeholderBranchName: string;
}): void;
export declare function markPaseoWorktreeFirstAgentBranchAutoNameAttempted(worktreeRoot: string, options?: {
    attemptedAt?: string;
}): PaseoWorktreeMetadata | null;
export declare function readPaseoWorktreeMetadata(worktreeRoot: string): PaseoWorktreeMetadata | null;
export declare function requirePaseoWorktreeBaseRefName(worktreeRoot: string): string;
export declare function readPaseoWorktreeRuntimePort(worktreeRoot: string): number | null;
export {};
//# sourceMappingURL=worktree-metadata.d.ts.map