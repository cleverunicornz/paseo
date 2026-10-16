import { findExecutable } from "../executable-resolution/executable-resolution.js";
import { runGitCommand } from "../utils/run-git-command.js";
import { execCommand } from "../utils/spawn.js";
/**
 * Timeout for the per-host CLI auth probe (`gh`/`glab`/`tea` auth status) used
 * to detect a self-hosted forge. This intentionally has no anonymous HTTP
 * fallback: a remote-derived host is trusted only when the CLI already knows it.
 */
export const CLI_AUTH_PROBE_TIMEOUT_MS = 10000;
/**
 * Shared shape behind the gh/glab/tea CLI adapters: an exec wrapper (10MB
 * maxBuffer, per-call env overlay merged over the binary's defaults, a
 * timeout) plus error normalization through the binary's own error-class
 * trio. The three adapters differ only in the params passed here.
 */
export function createForgeCliRunner(options) {
    const run = (args, runOptions) => execCommand(options.binary, args, {
        cwd: runOptions.cwd,
        envOverlay: { ...options.envOverlay, ...runOptions.envOverlay },
        maxBuffer: 10 * 1024 * 1024,
        timeout: options.timeoutMs,
    });
    function normalizeError(error, context) {
        return normalizeCliCommandError({
            error,
            args: context.args,
            cwd: context.cwd,
            commandName: options.binary,
            timeoutMs: context.timeoutMs ?? options.timeoutMs,
            isAlreadyClassified: options.errorClasses.isAlreadyClassified,
            isCommandError: options.errorClasses.isCommandError,
            isAuthFailureText: options.isAuthFailureText,
            createAuthError: options.errorClasses.createAuthError,
            createMissingError: options.errorClasses.createMissingError,
            createCommandError: options.errorClasses.createCommandError,
        });
    }
    return { run, normalizeError };
}
export class ForgeCliMissingError extends Error {
    constructor() {
        super(...arguments);
        this.kind = "missing-cli";
    }
}
export class ForgeAuthenticationError extends Error {
    constructor(message, params) {
        super(message);
        this.kind = "auth-failure";
        this.stderr = params.stderr;
    }
}
export class ForgeCommandError extends Error {
    constructor(label, params) {
        super(`${label.brand} CLI command failed: ${label.binary} ${params.args.join(" ")}`);
        this.kind = "command-error";
        this.args = [...params.args];
        this.cwd = params.cwd;
        this.exitCode = params.exitCode;
        this.stderr = params.stderr;
        if (params.stdout !== undefined) {
            this.stdout = params.stdout;
        }
    }
}
/**
 * Memoize a CLI path resolver (`findExecutable`) for the lifetime of a service
 * instance. A found path is cached permanently; a miss (or a rejected probe)
 * evicts the cache so a CLI installed after the daemon started is picked up
 * on the next call instead of requiring a restart. Concurrent callers during
 * resolution share the same in-flight promise.
 */
export function createCachedCliPathResolver(resolve) {
    let pending = null;
    return function resolveCliPath() {
        if (pending) {
            return pending;
        }
        const current = resolve()
            .then((path) => {
            if (path === null && pending === current) {
                pending = null;
            }
            return path;
        })
            .catch((error) => {
            if (pending === current) {
                pending = null;
            }
            throw error;
        });
        pending = current;
        return current;
    };
}
export function bufferOrStringToString(value) {
    if (typeof value === "string") {
        return value;
    }
    if (Buffer.isBuffer(value)) {
        return value.toString("utf8");
    }
    return "";
}
export function normalizeCliCommandError(options) {
    if (options.isAlreadyClassified(options.error)) {
        return options.error;
    }
    if (options.isCommandError(options.error)) {
        if (options.isAuthFailureText(options.error.stderr)) {
            return options.createAuthError(options.error.stderr);
        }
        return options.error;
    }
    const failure = toCommandFailureLike(options.error);
    if (failure.code === "ENOENT") {
        return options.createMissingError();
    }
    const stderr = bufferOrStringToString(failure.stderr);
    const stdout = bufferOrStringToString(failure.stdout);
    const message = failure.message ?? "";
    if (options.isAuthFailureText(stderr) || options.isAuthFailureText(message)) {
        return options.createAuthError(stderr);
    }
    if (failure.killed === true && options.timeoutMs !== undefined) {
        return options.createCommandError({
            args: options.args,
            cwd: options.cwd,
            exitCode: null,
            stderr: stderr ||
                `${options.commandName} was terminated before completing (timed out after ${options.timeoutMs}ms or exceeded the output limit)`,
            ...(stdout ? { stdout } : {}),
        });
    }
    return options.createCommandError({
        args: options.args,
        cwd: options.cwd,
        exitCode: typeof failure.code === "number" ? failure.code : null,
        stderr: stderr || message,
        ...(stdout ? { stdout } : {}),
    });
}
export function parseCliJsonOutput(options) {
    let data;
    try {
        data = JSON.parse(options.stdout);
    }
    catch {
        throw options.createCommandError({
            args: options.args,
            cwd: options.cwd,
            exitCode: null,
            stderr: `${options.commandName} did not return valid JSON (${options.stdout.length} bytes)`,
        });
    }
    const parsed = options.schema.safeParse(data);
    if (!parsed.success) {
        throw options.createCommandError({
            args: options.args,
            cwd: options.cwd,
            exitCode: null,
            stderr: `${options.commandName} JSON did not match the expected schema: ${parsed.error.message}`,
        });
    }
    return parsed.data;
}
export async function defaultResolveRemoteUrl(cwd) {
    try {
        const { stdout } = await runGitCommand(["config", "--get", "remote.origin.url"], { cwd });
        const url = stdout.trim();
        return url.length > 0 ? url : null;
    }
    catch {
        return null;
    }
}
export async function probeHostViaCliAuthStatus(options) {
    const cliPath = await findExecutable(options.cli);
    if (!cliPath) {
        return false;
    }
    try {
        await execCommand(options.cli, ["auth", "status", "--hostname", options.host], {
            envOverlay: options.envOverlay,
            timeout: CLI_AUTH_PROBE_TIMEOUT_MS,
        });
        return true;
    }
    catch {
        return false;
    }
}
function toCommandFailureLike(error) {
    if (!error || typeof error !== "object") {
        return { message: String(error) };
    }
    const record = error;
    return {
        code: typeof record.code === "string" || typeof record.code === "number" || record.code === null
            ? record.code
            : undefined,
        killed: typeof record.killed === "boolean" ? record.killed : undefined,
        stderr: typeof record.stderr === "string" || Buffer.isBuffer(record.stderr)
            ? record.stderr
            : undefined,
        stdout: typeof record.stdout === "string" || Buffer.isBuffer(record.stdout)
            ? record.stdout
            : undefined,
        message: typeof record.message === "string" ? record.message : undefined,
    };
}
//# sourceMappingURL=forge-cli-command.js.map