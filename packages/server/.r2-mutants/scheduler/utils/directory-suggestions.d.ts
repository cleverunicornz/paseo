export type DirectorySuggestionKind = "file" | "directory";
export type DirectorySuggestionPathFormat = "absolute" | "relative";
export type DirectorySuggestionMatchMode = "fuzzy" | "suffix";
export type PathQueryPolicy = "rooted" | "slashes";
export type BlankQueryBehavior = "none" | "children";
export interface DirectorySuggestionEntry {
    path: string;
    kind: DirectorySuggestionKind;
}
export interface SearchDirectoryEntriesOptions {
    root: string;
    query: string;
    pathFormat: DirectorySuggestionPathFormat;
    includeFiles?: boolean;
    includeDirectories?: boolean;
    matchMode?: DirectorySuggestionMatchMode;
    pathQueryPolicy?: PathQueryPolicy;
    rootAliases?: string[];
    blankQueryBehavior?: BlankQueryBehavior;
    traversableHiddenDirectoryNames?: readonly string[];
    limit?: number;
    maxDepth?: number;
    maxEntriesScanned?: number;
    confidentResultScanThreshold?: number;
    respectGitIgnore?: boolean;
}
export declare const WORKSPACE_SEARCH_HIDDEN_DIRECTORIES: readonly [".agents", ".claude", ".codex", ".github", ".opencode", ".paseo", ".vscode"];
export declare function searchDirectoryEntries(options: SearchDirectoryEntriesOptions): Promise<DirectorySuggestionEntry[]>;
//# sourceMappingURL=directory-suggestions.d.ts.map