import { ForgeAuthenticationError, ForgeCliMissingError, ForgeCommandError, type ForgeCommandFailureParams } from "./forge-cli-command.js";
import type { CurrentPullRequestStatus, DisablePullRequestAutoMergeOptions, EnablePullRequestAutoMergeOptions, ForgeService, PullRequestCheck, PullRequestMergeMethod } from "./forge-service.js";
import { type GitHubPullRequestStatusFacts } from "./github-facts.js";
export type { CheckAnnotation, CheckDetails, CheckFailedJob, CreatePullRequestOptions, CurrentPullRequestStatus, DisablePullRequestAutoMergeOptions, EnablePullRequestAutoMergeOptions, ForgeAuthState, ForgeReadOptions, ForgeService, ForgeSpecificStatusFacts, GetCheckDetailsOptions, GetPullRequestOptions, GetPullRequestTimelineOptions, IssueSummary, ListIssuesOptions, ListPullRequestsOptions, MergePullRequestOptions, PullRequestAutoMergeResult, PullRequestCheck, PullRequestCheckoutTarget, PullRequestChecksStatus, PullRequestCheckStatus, PullRequestCommandStatus, PullRequestCreateResult, PullRequestMergeable, PullRequestMergeMethod, PullRequestMergeResult, PullRequestReviewDecision, PullRequestSummary, PullRequestTimeline, PullRequestTimelineCommentLocation, PullRequestTimelineError, PullRequestTimelineErrorKind, PullRequestTimelineItem, PullRequestTimelineReviewState, SearchIssuesAndPrsOptions, SearchResult, } from "./forge-service.js";
export type { GitHubPullRequestStatusFacts } from "./github-facts.js";
export declare const GITHUB_POLL_FAST_INTERVAL_MS = 20000;
export declare const GITHUB_POLL_SLOW_INTERVAL_MS = 120000;
export declare const GITHUB_POLL_ERROR_BACKOFF_CAP_MS = 300000;
export declare const GITHUB_POLL_BATCH_MAX = 25;
export declare const GITHUB_POLL_ALIGNMENT_MS = 5000;
export interface GitHubCommandRunnerOptions {
    cwd: string;
    envOverlay?: Record<string, string>;
}
export interface GitHubCommandResult {
    stdout: string;
    stderr: string;
}
export type GitHubCommandRunner = (args: string[], options: GitHubCommandRunnerOptions) => Promise<GitHubCommandResult>;
export interface GitHubRepositorySummary {
    id: string;
    name: string;
    nameWithOwner: string;
    description: string | null;
    visibility: "public" | "private" | "internal";
    updatedAt: string;
    cloneUrl: string;
}
export interface SearchGitHubRepositoriesOptions {
    cwd: string;
    query: string;
    limit?: number;
}
export interface GitHubService extends ForgeService {
    searchRepositories(options: SearchGitHubRepositoriesOptions): Promise<GitHubRepositorySummary[]>;
}
export declare class GitHubCliMissingError extends ForgeCliMissingError {
    constructor();
}
export declare class GitHubAuthenticationError extends ForgeAuthenticationError {
    constructor(params: {
        stderr: string;
    });
}
export declare class GitHubCommandError extends ForgeCommandError {
    constructor(params: ForgeCommandFailureParams);
}
export declare class GitHubEnterpriseHostProbeError extends Error {
    readonly host: string;
    readonly cause: Error;
    constructor(params: {
        host: string;
        cause: Error;
    });
}
interface CreateGitHubServiceOptions {
    ttlMs?: number;
    runner?: GitHubCommandRunner;
    resolveGhPath?: () => Promise<string | null>;
    now?: () => number;
    resolveRepoHost?: (cwd: string) => Promise<string | null>;
    resolveRepoSlug?: (cwd: string) => Promise<string | null>;
}
export declare function createGitHubService(options?: CreateGitHubServiceOptions): GitHubService;
export declare function assertPullRequestAutoMergeEnableReady(input: Pick<EnablePullRequestAutoMergeOptions, "mergeMethod" | "status">): void;
export declare function assertPullRequestAutoMergeDisableReady(input: Pick<DisablePullRequestAutoMergeOptions, "status">): void;
export declare function isPullRequestMergeMethodAllowed(repository: GitHubPullRequestStatusFacts["repository"], method: PullRequestMergeMethod): boolean;
export declare function computeGithubNextInterval(status: CurrentPullRequestStatus | null, consecutiveErrors: number): number;
/**
 * Detect whether a self-hosted host is GitHub Enterprise Server by asking the
 * local gh CLI whether it is already authenticated to that exact hostname.
 * Cloud github.com short-circuits via the registry's host match before this runs.
 */
export declare function probeGitHubHost(host: string): Promise<boolean>;
export declare function parseStatusCheckRollup(value: unknown, nowMs?: number): PullRequestCheck[];
//# sourceMappingURL=github-service.d.ts.map