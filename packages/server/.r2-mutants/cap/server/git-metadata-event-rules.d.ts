export type GitMetadataScope = "worktree" | "common";
export type GitMetadataEffect = {
    kind: "ignore";
} | {
    kind: "owner" | "all";
    refreshBase: boolean;
} | {
    kind: "ref";
    namespace: "local" | "remote";
    ref: string;
};
export declare const GIT_METADATA_EVENT_RULES: readonly [{
    readonly id: "lock";
    readonly scope: "both";
    readonly match: "suffix";
    readonly path: ".lock";
    readonly route: "ignore";
}, {
    readonly id: "worktree-index";
    readonly scope: "worktree";
    readonly match: "exact";
    readonly path: "index";
    readonly route: "owner";
    readonly refreshBase: false;
}, {
    readonly id: "worktree-head";
    readonly scope: "worktree";
    readonly match: "exact";
    readonly path: "HEAD";
    readonly route: "owner";
    readonly refreshBase: true;
}, {
    readonly id: "worktree-config";
    readonly scope: "worktree";
    readonly match: "exact";
    readonly path: "config.worktree";
    readonly route: "owner";
    readonly refreshBase: true;
}, {
    readonly id: "paseo-worktree-metadata";
    readonly scope: "worktree";
    readonly match: "exact";
    readonly path: "paseo/worktree.json";
    readonly route: "owner";
    readonly refreshBase: true;
}, {
    readonly id: "main-index";
    readonly scope: "common";
    readonly match: "exact";
    readonly path: "index";
    readonly route: "owner";
    readonly refreshBase: false;
}, {
    readonly id: "main-head";
    readonly scope: "common";
    readonly match: "exact";
    readonly path: "HEAD";
    readonly route: "owner";
    readonly refreshBase: true;
}, {
    readonly id: "local-branch";
    readonly scope: "common";
    readonly match: "prefix";
    readonly path: "refs/heads/";
    readonly route: "local-ref";
}, {
    readonly id: "remote-branch";
    readonly scope: "common";
    readonly match: "prefix";
    readonly path: "refs/remotes/";
    readonly route: "remote-ref";
}, {
    readonly id: "packed-refs";
    readonly scope: "common";
    readonly match: "exact";
    readonly path: "packed-refs";
    readonly route: "all";
    readonly refreshBase: true;
}, {
    readonly id: "reftable";
    readonly scope: "common";
    readonly match: "prefix";
    readonly path: "reftable/";
    readonly route: "all";
    readonly refreshBase: true;
}, {
    readonly id: "shared-config";
    readonly scope: "common";
    readonly match: "exact";
    readonly path: "config";
    readonly route: "all";
    readonly refreshBase: true;
}, {
    readonly id: "worktree-administration";
    readonly scope: "common";
    readonly match: "prefix";
    readonly path: "worktrees/";
    readonly route: "ignore";
}, {
    readonly id: "hooks";
    readonly scope: "common";
    readonly match: "prefix";
    readonly path: "hooks/";
    readonly route: "ignore";
    readonly prune: true;
}, {
    readonly id: "ref-logs";
    readonly scope: "common";
    readonly match: "prefix";
    readonly path: "logs/";
    readonly route: "ignore";
    readonly prune: true;
}, {
    readonly id: "object-database";
    readonly scope: "common";
    readonly match: "prefix";
    readonly path: "objects/";
    readonly route: "ignore";
    readonly prune: true;
}];
export declare function getPrunedGitMetadataPaths(scope: GitMetadataScope): string[];
export declare function classifyGitMetadataPath(scope: GitMetadataScope, inputPath: string): GitMetadataEffect;
//# sourceMappingURL=git-metadata-event-rules.d.ts.map