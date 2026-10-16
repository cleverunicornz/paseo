import { ForgeAuthenticationError, ForgeCliMissingError, ForgeCommandError, type ForgeCommandFailureParams } from "./forge-cli-command.js";
import type { EnablePullRequestAutoMergeOptions, ForgeService } from "./forge-service.js";
export declare class GlabCliMissingError extends ForgeCliMissingError {
    constructor();
}
export declare class GlabAuthenticationError extends ForgeAuthenticationError {
    constructor(params: {
        stderr: string;
    });
}
export declare class GlabCommandError extends ForgeCommandError {
    constructor(params: ForgeCommandFailureParams);
}
export interface GlabCommandRunnerOptions {
    cwd: string;
    envOverlay?: Record<string, string>;
}
export interface GlabCommandResult {
    stdout: string;
    stderr: string;
}
export type GlabCommandRunner = (args: string[], options: GlabCommandRunnerOptions) => Promise<GlabCommandResult>;
export interface CreateGitLabServiceOptions {
    runner?: GlabCommandRunner;
    resolveGlabPath?: () => Promise<string | null>;
    resolveRemoteUrl?: (cwd: string) => Promise<string | null>;
}
export declare function parseGitLabHostFromRemoteUrl(url: string): string | null;
/**
 * Probe whether `host` is a GitLab instance by asking glab about its auth status
 * for that hostname (exit 0 => a configured GitLab instance, even for
 * self-managed hosts whose name carries no "gitlab" hint). The forge resolver
 * uses this to detect self-managed hosts the name heuristic can't classify.
 */
export declare function probeGitLabHost(host: string): Promise<boolean>;
/**
 * Server-side guard for GitLab auto-merge: `glab mr merge --auto-merge` only
 * schedules the merge while a pipeline is active. Without one it merges on the
 * spot, so this is enforced at execution time as well as in UI policy.
 */
export declare function assertGitLabAutoMergeEnableReady(input: Pick<EnablePullRequestAutoMergeOptions, "status">): void;
export declare function createGitLabService(options?: CreateGitLabServiceOptions): ForgeService;
//# sourceMappingURL=gitlab-service.d.ts.map