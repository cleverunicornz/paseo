export { PaseoConfigRawSchema, PaseoLifecycleCommandRawSchema, PaseoScriptEntryRawSchema, PaseoWorktreeConfigRawSchema, PaseoConfigSchema, type PaseoConfig, type PaseoConfigRaw, } from "@getpaseo/protocol/paseo-config-schema";
import { type PaseoConfig } from "@getpaseo/protocol/paseo-config-schema";
export { slugify, validateBranchSlug } from "@getpaseo/protocol/branch-slug";
export interface WorktreeConfig {
    branchName: string;
    worktreePath: string;
}
export interface CreatedWorktree extends WorktreeConfig {
    comparisonBaseRef: string | null;
}
export interface WorktreeRuntimeEnv {
    [key: string]: string;
    PASEO_SOURCE_CHECKOUT_PATH: string;
    PASEO_ROOT_PATH: string;
    PASEO_WORKTREE_PATH: string;
    PASEO_BRANCH_NAME: string;
    PASEO_WORKTREE_PORT: string;
}
export interface WorktreeSetupCommandResult {
    command: string;
    cwd: string;
    stdout: string;
    stderr: string;
    exitCode: number | null;
    durationMs: number;
}
export type WorktreeSetupCommandProgressEvent = {
    type: "command_started";
    index: number;
    total: number;
    command: string;
    cwd: string;
} | {
    type: "output";
    index: number;
    total: number;
    command: string;
    cwd: string;
    stream: "stdout" | "stderr";
    chunk: string;
} | {
    type: "command_completed";
    index: number;
    total: number;
    command: string;
    cwd: string;
    exitCode: number | null;
    durationMs: number;
    stdout: string;
    stderr: string;
};
export interface WorktreeTerminalConfig {
    name?: string;
    command: string;
}
export interface PlainScriptConfig {
    type?: undefined;
    command: string;
    port?: undefined;
}
export interface ServiceScriptConfig {
    type: "service";
    command: string;
    port?: number;
}
export type ScriptConfig = PlainScriptConfig | ServiceScriptConfig;
export declare function isServiceScript(config: ScriptConfig): config is ServiceScriptConfig;
export declare class WorktreeSetupError extends Error {
    readonly results: WorktreeSetupCommandResult[];
    constructor(message: string, results: WorktreeSetupCommandResult[]);
}
export type WorktreeTeardownCommandResult = WorktreeSetupCommandResult;
export declare class WorktreeTeardownError extends Error {
    readonly results: WorktreeTeardownCommandResult[];
    constructor(message: string, results: WorktreeTeardownCommandResult[]);
}
export interface PaseoWorktreeInfo {
    path: string;
    createdAt: string;
    branchName?: string;
    head?: string;
}
export interface PaseoWorktreeOwnership {
    allowed: boolean;
    repoRoot?: string;
    worktreeRoot?: string;
    worktreePath?: string;
}
export interface PaseoWorktreeOwnershipOptions extends WorktreeRootOptions {
    knownGitCommonDir?: string | null;
}
export interface WorktreeRootOptions {
    paseoHome?: string;
    worktreesRoot?: string;
}
export interface WorktreeCheckoutRef {
    remoteName?: string;
    remoteRef: string;
}
export type WorktreeSource = {
    kind: "branch-off";
    baseBranch: string;
    branchName: string;
} | {
    kind: "checkout-branch";
    branchName: string;
} | {
    kind: "restore";
    branchName: string;
    baseRef: string | null;
} | {
    kind: "restore-from-base";
    baseRef: string;
    branchName: string;
} | {
    kind: "checkout-change-request";
    forge: string;
    changeRequestNumber: number;
    headRef: string;
    headRepositoryOwner?: string;
    headRepository?: string;
    baseRefName: string;
    checkoutRefs?: WorktreeCheckoutRef[];
    localBranchName?: string;
    pushRemoteUrl?: string;
    trackOriginHead?: boolean;
} | {
    kind: "checkout-github-pr";
    githubPrNumber: number;
    headRef: string;
    headRepositoryOwner?: string;
    baseRefName: string;
    checkoutRefs?: WorktreeCheckoutRef[];
    localBranchName?: string;
    pushRemoteUrl?: string;
    trackOriginHead?: boolean;
};
export interface CreateWorktreeOptions {
    cwd: string;
    worktreeSlug: string;
    source: WorktreeSource;
    runSetup: boolean;
    paseoHome?: string;
    worktreesRoot?: string;
}
export declare class BranchAlreadyCheckedOutError extends Error {
    readonly branchName: string;
    constructor(branchName: string);
}
export declare class UnknownBranchError extends Error {
    readonly branchName: string;
    readonly cwd: string;
    constructor(params: {
        branchName: string;
        cwd: string;
    });
}
export declare class InvalidGitBranchNameError extends Error {
    readonly branchName: string;
    constructor(branchName: string);
}
export type ReadPaseoConfigResult = {
    ok: true;
    config: PaseoConfig | null;
} | {
    ok: false;
    configPath: string;
    error: unknown;
};
export declare function readPaseoConfig(repoRoot: string): ReadPaseoConfigResult;
export declare function paseoConfigParseError(failure: {
    configPath: string;
    error: unknown;
}): Error;
export declare function getWorktreeSetupCommands(repoRoot: string): string[];
export declare function getWorktreeTeardownCommands(repoRoot: string): string[];
export declare function getWorktreeTerminalSpecs(repoRoot: string): WorktreeTerminalConfig[];
export declare function getScriptConfigs(config: PaseoConfig | null): Map<string, ScriptConfig>;
export declare function processCarriageReturns(text: string): string;
export declare function runWorktreeSetupCommands(options: {
    worktreePath: string;
    branchName: string;
    cleanupOnFailure: boolean;
    repoRootPath?: string;
    runtimeEnv?: WorktreeRuntimeEnv;
    signal?: AbortSignal;
    onEvent?: (event: WorktreeSetupCommandProgressEvent) => void;
}): Promise<WorktreeSetupCommandResult[]>;
export declare function resolveWorktreeRuntimeEnv(options: {
    worktreePath: string;
    branchName?: string;
    repoRootPath?: string;
}): Promise<WorktreeRuntimeEnv>;
export declare function runWorktreeTeardownCommands(options: {
    worktreePath: string;
    teardownCwd?: string;
    branchName?: string;
    repoRootPath?: string;
}): Promise<WorktreeTeardownCommandResult[]>;
export declare function seedPaseoConfigFile(options: {
    sourceCwd: string;
    targetCwd: string;
}): Promise<void>;
/**
 * Get the git common directory (shared across worktrees) for a given cwd.
 * This is where refs, objects, etc. are stored.
 */
export declare function getGitCommonDir(cwd: string): Promise<string>;
export declare function deriveWorktreeProjectHash(cwd: string): Promise<string>;
export declare function resolvePaseoWorktreesBaseRoot(options?: WorktreeRootOptions): string;
export declare function getPaseoWorktreesRoot(cwd: string, paseoHome?: string, worktreesRoot?: string): Promise<string>;
export declare function computeWorktreePath(cwd: string, slug: string, paseoHome?: string, worktreesRoot?: string): Promise<string>;
export declare function mapWorkspaceCwdToWorktree(input: {
    sourceWorktreePath: string;
    workspaceCwd: string;
    targetWorktreePath: string;
}): string;
export declare function mapWorkspaceRelativeCwdToWorktree(input: {
    relativeWorkspaceCwd: string;
    targetWorktreePath: string;
}): string;
export declare function isPaseoOwnedWorktreeCwd(cwd: string, options?: PaseoWorktreeOwnershipOptions): Promise<PaseoWorktreeOwnership>;
export declare function listPaseoWorktrees({ cwd, paseoHome, worktreesRoot, }: {
    cwd: string;
    paseoHome?: string;
    worktreesRoot?: string;
}): Promise<PaseoWorktreeInfo[]>;
export interface DeletePaseoWorktreeOptions {
    cwd: string | null;
    worktreePath?: string;
    teardownCwds?: string[];
    worktreeSlug?: string;
    worktreesRoot?: string;
    paseoHome?: string;
    worktreesBaseRoot?: string;
}
export declare function deletePaseoWorktree({ cwd, worktreePath, teardownCwds, worktreeSlug, worktreesRoot, paseoHome, worktreesBaseRoot, }: DeletePaseoWorktreeOptions): Promise<void>;
export declare function rollbackCreatedPaseoWorktree(options: DeletePaseoWorktreeOptions, cause: unknown): Promise<never>;
/**
 * Create a git worktree with proper naming conventions
 */
export declare const createWorktree: ({ cwd, source, worktreeSlug, runSetup, paseoHome, worktreesRoot, }: CreateWorktreeOptions) => Promise<CreatedWorktree>;
//# sourceMappingURL=worktree.d.ts.map