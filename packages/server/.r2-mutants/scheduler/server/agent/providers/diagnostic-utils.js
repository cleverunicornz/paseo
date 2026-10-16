import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import path from "node:path";
import { createProviderEnvSpec, } from "../provider-launch-config.js";
import { execCommand } from "../../../utils/spawn.js";
export function formatProviderDiagnostic(providerName, entries) {
    return [providerName, ...entries.map((entry) => `  ${entry.label}: ${entry.value}`)].join("\n");
}
export function formatProviderDiagnosticError(providerName, error) {
    return formatProviderDiagnostic(providerName, [
        {
            label: "Error",
            value: toDiagnosticErrorMessage(error),
        },
    ]);
}
export function formatAvailabilityStatus(available) {
    return available ? "Available" : "Unavailable";
}
export function formatDiagnosticStatus(available, error) {
    if (error) {
        return `Error (${error.source} failed: ${toDiagnosticErrorMessage(error.cause)})`;
    }
    return formatAvailabilityStatus(available);
}
const DIAGNOSTIC_OUTPUT_CAP = 4096;
export function truncateForDiagnostic(value) {
    const trimmed = value.trim();
    if (trimmed.length <= DIAGNOSTIC_OUTPUT_CAP) {
        return trimmed;
    }
    return `${trimmed.slice(0, DIAGNOSTIC_OUTPUT_CAP)}…(truncated)`;
}
function readStringProperty(error, key) {
    if (!(key in error))
        return undefined;
    const value = error[key];
    if (typeof value === "string") {
        return value;
    }
    if (typeof value === "number" || typeof value === "bigint") {
        return String(value);
    }
    return undefined;
}
function readUnknownProperty(error, key) {
    if (!(key in error))
        return undefined;
    return error[key];
}
function pushIfNonEmpty(sections, label, value) {
    if (value && value.trim().length > 0) {
        sections.push(`${label}: ${value.trim()}`);
    }
}
function pushTruncatedIfNonEmpty(sections, label, value) {
    if (value && value.trim().length > 0) {
        sections.push(`${label}: ${truncateForDiagnostic(value)}`);
    }
}
function formatErrorDiagnostic(error) {
    const sections = [];
    if (error.message && error.message.trim().length > 0) {
        sections.push(error.message.trim());
    }
    pushIfNonEmpty(sections, "exit code", readStringProperty(error, "code"));
    pushIfNonEmpty(sections, "signal", readStringProperty(error, "signal"));
    pushTruncatedIfNonEmpty(sections, "stderr", readStringProperty(error, "stderr"));
    pushTruncatedIfNonEmpty(sections, "stdout", readStringProperty(error, "stdout"));
    const cause = readUnknownProperty(error, "cause");
    if (cause !== undefined && cause !== null) {
        const causeMessage = toDiagnosticErrorMessage(cause);
        if (causeMessage && causeMessage !== "Unknown error") {
            sections.push(`caused by: ${causeMessage}`);
        }
    }
    return sections.length > 0 ? sections.join("\n") : "Unknown error";
}
function formatNonErrorDiagnostic(error) {
    try {
        const serialized = JSON.stringify(error);
        if (serialized && serialized !== "{}" && serialized !== '""') {
            return serialized;
        }
    }
    catch {
        // fall through to String() below
    }
    const stringified = String(error);
    if (stringified.length > 0 && stringified !== "[object Object]") {
        return stringified;
    }
    return "Unknown error";
}
export function toDiagnosticErrorMessage(error) {
    if (error instanceof Error) {
        return formatErrorDiagnostic(error);
    }
    if (typeof error === "string") {
        const trimmed = error.trim();
        return trimmed.length > 0 ? trimmed : "Unknown error";
    }
    if (error === null || error === undefined) {
        return "Unknown error";
    }
    return formatNonErrorDiagnostic(error);
}
export async function resolveBinaryVersion(binaryPath, signal) {
    try {
        const { stdout } = await execCommand(binaryPath, ["--version"], {
            ...createProviderEnvSpec(),
            timeout: 5000,
            signal,
        });
        return stdout.trim() || "unknown";
    }
    catch (error) {
        return `error: ${toDiagnosticErrorMessage(error)}`;
    }
}
const COMMAND_PROBE_TIMEOUT_MS = 3000;
const COMMAND_PROBE_MAX_BUFFER = 32 * 1024;
function resolvePlatform(options) {
    return options?.platform ?? process.platform;
}
function resolvePathValue(options) {
    return options?.pathValue ?? process.env["PATH"] ?? process.env["Path"] ?? "";
}
function resolveShellValue(options) {
    if (options?.shell) {
        return options.shell;
    }
    if (resolvePlatform(options) === "win32") {
        return process.env["ComSpec"] ?? "cmd.exe";
    }
    return process.env["SHELL"] ?? "/bin/sh";
}
async function isExecutableFile(filePath, platform) {
    try {
        const candidate = await stat(filePath);
        if (!candidate.isFile()) {
            return false;
        }
        if (platform === "win32") {
            return true;
        }
        await access(filePath, constants.X_OK);
        return true;
    }
    catch {
        return false;
    }
}
function resolveSearchableNames(binaryNames) {
    return binaryNames.filter((binaryName) => binaryName.trim().length > 0 && !binaryName.includes("/") && !binaryName.includes("\\"));
}
function resolveWindowsPathExt(options) {
    const value = options.pathext ?? process.env["PATHEXT"] ?? ".COM;.EXE;.BAT;.CMD";
    return value
        .split(";")
        .map((extension) => extension.trim())
        .filter(Boolean)
        .map((extension) => (extension.startsWith(".") ? extension : `.${extension}`));
}
function resolveBinaryCandidateNames(binaryName, options) {
    if (resolvePlatform(options) !== "win32" || path.win32.extname(binaryName)) {
        return [binaryName];
    }
    return [binaryName, ...resolveWindowsPathExt(options).map((extension) => binaryName + extension)];
}
async function formatPathMatches(options) {
    const binaryNames = options.knownBinaryNames;
    const searchableNames = resolveSearchableNames(binaryNames);
    if (searchableNames.length === 0) {
        return "not checked";
    }
    const pathDelimiter = resolvePlatform(options) === "win32" ? ";" : path.delimiter;
    const pathEntries = resolvePathValue(options).split(pathDelimiter).filter(Boolean);
    const matches = [];
    const seen = new Set();
    const platform = resolvePlatform(options);
    for (const directory of pathEntries) {
        for (const binaryName of searchableNames) {
            for (const candidateName of resolveBinaryCandidateNames(binaryName, options)) {
                const candidate = path.join(directory, candidateName);
                if (seen.has(candidate)) {
                    continue;
                }
                seen.add(candidate);
                if (await isExecutableFile(candidate, platform)) {
                    matches.push(candidate);
                }
            }
        }
    }
    return matches.length > 0 ? matches.join("\n    ") : "none";
}
function shellToken(value) {
    return `'${value.replace(/'/g, "'\\''")}'`;
}
function formatCommandProbeOutput(stdout, stderr) {
    const sections = [];
    const trimmedStdout = truncateForDiagnostic(stdout);
    const trimmedStderr = truncateForDiagnostic(stderr);
    if (trimmedStdout.length > 0) {
        sections.push(trimmedStdout);
    }
    if (trimmedStderr.length > 0) {
        sections.push(`stderr: ${trimmedStderr}`);
    }
    return sections.length > 0 ? sections.join("\n") : "(no output)";
}
function formatCommandProbeError(error) {
    return toDiagnosticErrorMessage(error);
}
async function runCommandProbe(command, args) {
    try {
        const { stdout, stderr } = await execCommand(command, args, {
            timeout: COMMAND_PROBE_TIMEOUT_MS,
            killSignal: "SIGKILL",
            maxBuffer: COMMAND_PROBE_MAX_BUFFER,
        });
        return formatCommandProbeOutput(stdout, stderr);
    }
    catch (error) {
        return formatCommandProbeError(error);
    }
}
async function buildPosixCommandProbeRows(binaryName) {
    const shell = resolveShellValue();
    const typeCommand = `type -a ${shellToken(binaryName)}`;
    return [
        {
            label: `which -a ${binaryName}`,
            value: await runCommandProbe("/usr/bin/which", ["-a", binaryName]),
        },
        {
            label: `${path.basename(shell)} -lc type -a ${binaryName}`,
            value: await runCommandProbe(shell, ["-lc", typeCommand]),
        },
    ];
}
async function buildWindowsCommandProbeRows(binaryName) {
    const powershellCommand = [
        "$ErrorActionPreference = 'Continue';",
        `Get-Command -All ${JSON.stringify(binaryName)} |`,
        "Select-Object CommandType,Source,Name,Definition |",
        "Format-List",
    ].join(" ");
    return [
        {
            label: `where.exe ${binaryName}`,
            value: await runCommandProbe("where.exe", [binaryName]),
        },
        {
            label: `powershell Get-Command -All ${binaryName}`,
            value: await runCommandProbe("powershell.exe", [
                "-NoProfile",
                "-ExecutionPolicy",
                "Bypass",
                "-Command",
                powershellCommand,
            ]),
        },
    ];
}
async function buildCommandProbeRows(binaryNames) {
    const searchableNames = resolveSearchableNames(binaryNames);
    if (searchableNames.length === 0) {
        return [];
    }
    const rows = [];
    for (const binaryName of searchableNames) {
        rows.push(...(process.platform === "win32"
            ? await buildWindowsCommandProbeRows(binaryName)
            : await buildPosixCommandProbeRows(binaryName)));
    }
    return rows;
}
export async function buildCommandResolutionDiagnosticRows(launch, options) {
    const includeCommandProbes = options.includeCommandProbes ?? true;
    return [
        {
            label: "Command source",
            value: launch.source,
        },
        {
            label: "Configured command",
            value: [launch.command, ...launch.args].join(" "),
        },
        {
            label: "Daemon PATH",
            value: truncateForDiagnostic(resolvePathValue(options)) || "(empty)",
        },
        {
            label: "Daemon shell",
            value: resolveShellValue(options),
        },
        {
            label: "PATH matches",
            value: await formatPathMatches(options),
        },
        ...(includeCommandProbes ? await buildCommandProbeRows(options.knownBinaryNames) : []),
    ];
}
async function resolveCommandVersion(invocation) {
    try {
        const { stdout, stderr } = await execCommand(invocation.command, invocation.args, {
            ...createProviderEnvSpec({ runtimeSettings: { env: invocation.env } }),
            timeout: 5000,
        });
        return stdout.trim() || stderr.trim() || "unknown";
    }
    catch (error) {
        return `error: ${toDiagnosticErrorMessage(error)}`;
    }
}
export async function buildBinaryDiagnosticRows(launch, availability, options = {}) {
    const defaultBinaryLabel = launch.source === "override" ? "Binary (override)" : "Binary";
    const binaryLabel = options.binaryLabel ?? defaultBinaryLabel;
    let version = "unknown";
    if (options.versionCommand && availability.available) {
        version = await resolveCommandVersion(options.versionCommand);
    }
    else if (availability.available) {
        version = await resolveCommandVersion({
            command: availability.resolvedPath ?? launch.command,
            args: [...launch.args, "--version"],
        });
    }
    return [
        {
            label: binaryLabel,
            value: launch.command,
        },
        {
            label: "Resolved path",
            value: availability.resolvedPath ?? "not found",
        },
        {
            label: "Version",
            value: version,
        },
    ];
}
export function formatConfiguredCommand(defaultArgv, runtimeSettings) {
    const command = runtimeSettings?.command;
    if (!command || command.mode === "default") {
        return `${defaultArgv.join(" ")} (default)`;
    }
    if (command.mode === "append") {
        return [defaultArgv[0], ...(command.args ?? []), ...defaultArgv.slice(1)].join(" ");
    }
    return command.argv.join(" ");
}
//# sourceMappingURL=diagnostic-utils.js.map