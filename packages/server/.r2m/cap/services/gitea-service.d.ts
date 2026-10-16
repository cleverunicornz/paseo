import { ForgeAuthenticationError, ForgeCliMissingError, ForgeCommandError, type ForgeCommandFailureParams } from "./forge-cli-command.js";
import type { ForgeService } from "./forge-service.js";
export declare class TeaCliMissingError extends ForgeCliMissingError {
    constructor();
}
export declare class TeaAuthenticationError extends ForgeAuthenticationError {
    constructor(params: {
        stderr: string;
    });
}
export declare class TeaCommandError extends ForgeCommandError {
    constructor(params: ForgeCommandFailureParams);
}
export interface TeaCommandRunnerOptions {
    cwd: string;
    envOverlay?: Record<string, string>;
}
export interface TeaCommandResult {
    stdout: string;
    stderr: string;
}
export type TeaCommandRunner = (args: string[], options: TeaCommandRunnerOptions) => Promise<TeaCommandResult>;
export interface CreateGiteaServiceOptions {
    runner?: TeaCommandRunner;
    resolveTeaPath?: () => Promise<string | null>;
    resolveRemoteUrl?: (cwd: string) => Promise<string | null>;
    resolveCurrentBranch?: (cwd: string) => Promise<string | null>;
    now?: () => number;
}
export declare function parseGiteaHostFromRemoteUrl(url: string): string | null;
/**
 * Probe whether a host is a Gitea instance Paseo can talk to. tea has no
 * per-repo auth check (it keeps per-instance logins), so a configured tea login
 * for the host is the signal: it means tea both recognizes the host as Gitea and
 * holds a usable token for it. Mirrors the role of `glab auth status` for GitLab.
 */
export declare function probeGiteaHost(host: string): Promise<boolean>;
export type GiteaFamilySoftware = "gitea" | "forgejo";
type TeaApiRunner = (args: string[]) => Promise<{
    stdout: string;
    stderr: string;
}>;
export interface DetectGiteaFamilyOptions {
    /** Authenticated tier transport; defaults to spawning `tea`. */
    runTea?: TeaApiRunner;
}
/**
 * Decide whether a Gitea-family host runs Forgejo or Gitea through authenticated
 * tea only. Inconclusive detection keeps the historical Gitea default.
 */
export declare function detectGiteaFamilySoftware(host: string, options?: DetectGiteaFamilyOptions): Promise<GiteaFamilySoftware>;
/**
 * Resolve which Gitea-family forge id a host maps to for the open registry:
 * null when there is no usable `tea` login (Paseo cannot operate the host),
 * otherwise the detected software. Concurrent calls for the same host — the
 * gitea and forgejo registrations probing in parallel — share one probe so
 * detection runs once.
 */
export declare function resolveGiteaFamilyForge(host: string): Promise<GiteaFamilySoftware | null>;
export declare function createGiteaService(options?: CreateGiteaServiceOptions): ForgeService;
export {};
//# sourceMappingURL=gitea-service.d.ts.map