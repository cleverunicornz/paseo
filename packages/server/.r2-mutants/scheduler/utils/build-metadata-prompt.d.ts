export type MetadataConfigKey = "title" | "branchName" | "commitMessage" | "pullRequest";
export interface RepoRootResolver {
    resolveRepoRoot: (cwd: string) => Promise<string>;
}
export interface MetadataStyleSection {
    configKey: MetadataConfigKey;
    default: string;
    label?: string;
}
export interface BuildMetadataPromptOptions {
    cwd: string;
    contract: string;
    styles: MetadataStyleSection[];
    after: string;
    trailing?: string;
    workspaceGitService?: RepoRootResolver;
}
export declare function buildMetadataPrompt(options: BuildMetadataPromptOptions): Promise<string>;
//# sourceMappingURL=build-metadata-prompt.d.ts.map