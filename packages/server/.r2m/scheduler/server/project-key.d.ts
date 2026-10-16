/** Persisted opaque key used to join the same remote across hosts. */
export declare function deriveProjectKey(input: {
    rootPath: string;
    remoteUrl: string | null;
    worktreeRoot: string | null;
    mainRepoRoot: string | null;
    serverId?: string;
}): string;
export declare function deriveProjectGroupingDisplayName(input: {
    rootPath: string;
    remoteUrl: string | null;
    worktreeRoot: string | null;
}): string;
//# sourceMappingURL=project-key.d.ts.map