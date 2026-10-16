import { z } from "zod";
/**
 * Timeout for the per-host CLI auth probe (`gh`/`glab`/`tea` auth status) used
 * to detect a self-hosted forge. This intentionally has no anonymous HTTP
 * fallback: a remote-derived host is trusted only when the CLI already knows it.
 */
export declare const CLI_AUTH_PROBE_TIMEOUT_MS = 10000;
interface CliCommandErrorShape extends Error {
    stderr: string;
}
interface NormalizeCliCommandErrorOptions {
    error: unknown;
    args: string[];
    cwd: string;
    commandName: string;
    timeoutMs?: number;
    isAlreadyClassified: (error: unknown) => boolean;
    isCommandError: (error: unknown) => error is CliCommandErrorShape;
    isAuthFailureText: (text: string) => boolean;
    createAuthError: (stderr: string) => Error;
    createMissingError: () => Error;
    createCommandError: (params: {
        args: string[];
        cwd: string;
        exitCode: number | null;
        stderr: string;
    }) => Error;
}
interface ParseCliJsonOutputOptions<T> {
    commandName: string;
    args: string[];
    cwd: string;
    stdout: string;
    schema: z.ZodType<T>;
    createCommandError: NormalizeCliCommandErrorOptions["createCommandError"];
}
interface ProbeHostViaCliAuthStatusOptions {
    cli: string;
    host: string;
    envOverlay?: Record<string, string>;
}
export interface ForgeCliRunnerOptions {
    cwd: string;
    envOverlay?: Record<string, string>;
}
export interface ForgeCliRunnerResult {
    stdout: string;
    stderr: string;
}
export type ForgeCliRunner = (args: string[], options: ForgeCliRunnerOptions) => Promise<ForgeCliRunnerResult>;
export interface ForgeCliRunnerErrorClasses {
    isAlreadyClassified: (error: unknown) => boolean;
    isCommandError: (error: unknown) => error is CliCommandErrorShape;
    createAuthError: (stderr: string) => Error;
    createMissingError: () => Error;
    createCommandError: (params: ForgeCommandFailureParams) => Error;
}
export interface CreateForgeCliRunnerOptions {
    binary: string;
    envOverlay: Record<string, string>;
    timeoutMs: number;
    isAuthFailureText: (text: string) => boolean;
    errorClasses: ForgeCliRunnerErrorClasses;
}
export interface ForgeCliRunnerFactory {
    run: ForgeCliRunner;
    normalizeError: (error: unknown, context: {
        args: string[];
        cwd: string;
        timeoutMs?: number;
    }) => Error;
}
/**
 * Shared shape behind the gh/glab/tea CLI adapters: an exec wrapper (10MB
 * maxBuffer, per-call env overlay merged over the binary's defaults, a
 * timeout) plus error normalization through the binary's own error-class
 * trio. The three adapters differ only in the params passed here.
 */
export declare function createForgeCliRunner(options: CreateForgeCliRunnerOptions): ForgeCliRunnerFactory;
export declare class ForgeCliMissingError extends Error {
    readonly kind = "missing-cli";
}
export declare class ForgeAuthenticationError extends Error {
    readonly kind = "auth-failure";
    readonly stderr: string;
    constructor(message: string, params: {
        stderr: string;
    });
}
export interface ForgeCommandFailureParams {
    args: string[];
    cwd: string;
    exitCode: number | null;
    stderr: string;
    /**
     * Whatever the failing command printed to stdout. GraphQL batch callers use
     * this to salvage partial `data` when one aliased sub-query errors but the
     * others succeeded (the CLI exits non-zero yet still prints the body).
     */
    stdout?: string;
}
export declare class ForgeCommandError extends Error {
    readonly kind = "command-error";
    readonly args: string[];
    readonly cwd: string;
    readonly exitCode: number | null;
    readonly stderr: string;
    readonly stdout?: string;
    constructor(label: {
        brand: string;
        binary: string;
    }, params: ForgeCommandFailureParams);
}
/**
 * Memoize a CLI path resolver (`findExecutable`) for the lifetime of a service
 * instance. A found path is cached permanently; a miss (or a rejected probe)
 * evicts the cache so a CLI installed after the daemon started is picked up
 * on the next call instead of requiring a restart. Concurrent callers during
 * resolution share the same in-flight promise.
 */
export declare function createCachedCliPathResolver(resolve: () => Promise<string | null>): () => Promise<string | null>;
export declare function bufferOrStringToString(value: unknown): string;
export declare function normalizeCliCommandError(options: NormalizeCliCommandErrorOptions): Error;
export declare function parseCliJsonOutput<T>(options: ParseCliJsonOutputOptions<T>): T;
export declare function defaultResolveRemoteUrl(cwd: string): Promise<string | null>;
export declare function probeHostViaCliAuthStatus(options: ProbeHostViaCliAuthStatusOptions): Promise<boolean>;
export {};
//# sourceMappingURL=forge-cli-command.d.ts.map