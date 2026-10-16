import { type RunGitCommand } from "../utils/run-git-command.js";
export interface WorkspaceGitFetchResult {
    changes: WorkspaceGitRemoteRefChange[] | null;
    nonRemoteRefsChanged?: boolean;
    remoteRefs?: ReadonlySet<string>;
    error: unknown | null;
}
export interface WorkspaceGitFetchObserver {
    onRefSnapshot(phase: "before" | "after"): void;
}
export type WorkspaceGitRemoteRefChange = {
    kind: "moved";
    ref: string;
    beforeOid: string;
    afterOid: string;
} | {
    kind: "added";
    ref: string;
    afterOid: string;
} | {
    kind: "deleted";
    ref: string;
    beforeOid: string;
};
export declare function fetchWorkspaceGitRemote(cwd: string, observer: WorkspaceGitFetchObserver, run?: RunGitCommand): Promise<WorkspaceGitFetchResult>;
export declare function parseWorkspaceGitRefs(stdout: string): Map<string, string>;
export interface WorkspaceGitRefDiff {
    remoteChanges: WorkspaceGitRemoteRefChange[];
    nonRemoteRefsChanged: boolean;
}
export declare function diffWorkspaceGitRefs(before: ReadonlyMap<string, string>, after: ReadonlyMap<string, string>): WorkspaceGitRefDiff;
export declare function diffWorkspaceGitRemoteRefs(before: ReadonlyMap<string, string>, after: ReadonlyMap<string, string>): WorkspaceGitRemoteRefChange[];
//# sourceMappingURL=workspace-git-fetch.d.ts.map