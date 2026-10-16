export declare function parseGitHubRepoFromRemote(remoteUrl: string): string | null;
export declare function parseGitHubRepoNameFromRemote(remoteUrl: string): string | null;
export declare function deriveProjectSlug(cwd: string, remoteUrl?: string | null): string;
export declare function deriveProjectServiceSlug(project: {
    projectId: string;
    rootPath: string;
}): string;
//# sourceMappingURL=workspace-git-metadata.d.ts.map