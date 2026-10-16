import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { execCommand } from "../utils/spawn.js";
import { windowsExecutableResolution } from "./windows.js";
const require = createRequire(import.meta.url);
const which = require("which");
const PROBE_TIMEOUT_MS = 2000;
function hasPathSeparator(value) {
    return value.includes("/") || value.includes("\\");
}
async function enumerateCandidates(name, env) {
    if (process.platform !== "win32" && existsSync("/usr/bin/which")) {
        return enumerateCandidatesViaSystemWhich(name, env);
    }
    return enumerateCandidatesViaLibrary(name, env);
}
async function enumerateCandidatesViaSystemWhich(name, env) {
    try {
        const { stdout } = await execCommand("/usr/bin/which", ["-a", name], {
            baseEnv: env,
            timeout: 3000,
            killSignal: "SIGKILL",
        });
        return Array.from(new Set(stdout.trim().split("\n").filter(Boolean)));
    }
    catch (error) {
        // which exits 1 for a missing command. A failed lookup is not evidence of absence.
        if (error instanceof Error && "code" in error && error.code === 1)
            return [];
        throw error;
    }
}
async function enumerateCandidatesViaLibrary(name, env) {
    let candidates;
    try {
        candidates = await which(name, { all: true, path: env?.PATH, pathExt: env?.PATHEXT });
    }
    catch (error) {
        // `which` throws ENOENT when the command is absent from PATH.
        if (error.code === "ENOENT") {
            return [];
        }
        throw error;
    }
    const seen = new Set();
    return candidates.filter((candidate) => {
        if (seen.has(candidate)) {
            return false;
        }
        seen.add(candidate);
        return true;
    });
}
export async function probeExecutable(executablePath, options = PROBE_TIMEOUT_MS) {
    const { probeTimeoutMs: timeoutMs = PROBE_TIMEOUT_MS, env } = typeof options === "number" ? { probeTimeoutMs: options } : options;
    try {
        await execCommand(executablePath, ["--version"], {
            baseEnv: env,
            timeout: timeoutMs,
            killSignal: "SIGKILL",
            maxBuffer: 64 * 1024,
        });
        return true;
    }
    catch (error) {
        return classifyProbeError(error);
    }
}
function classifyProbeError(error) {
    const err = error;
    if (err.killed) {
        return true;
    }
    if (typeof err.code === "number") {
        return true;
    }
    if (err.code === "ENOENT" ||
        err.code === "EACCES" ||
        err.code === "ENOEXEC" ||
        err.code === "UNKNOWN") {
        return false;
    }
    return false;
}
/**
 * Check a literal executable path. PATH search is handled by findExecutable().
 */
export function executableExists(executablePath, exists = existsSync) {
    if (process.platform === "win32") {
        return windowsExecutableResolution.exists(executablePath, { exists });
    }
    return exists(executablePath) ? executablePath : null;
}
export async function findExecutable(name, options = PROBE_TIMEOUT_MS) {
    const { probeTimeoutMs = PROBE_TIMEOUT_MS, env } = typeof options === "number" ? { probeTimeoutMs: options } : options;
    const trimmed = name.trim();
    if (!trimmed) {
        return null;
    }
    if (process.platform === "win32") {
        return windowsExecutableResolution.find(trimmed, {
            enumeratePathCandidates: (command) => enumerateCandidates(command, env),
            probeExecutable: (command, timeout) => probeExecutable(command, { probeTimeoutMs: timeout, env }),
            exists: existsSync,
            probeTimeoutMs,
        });
    }
    if (hasPathSeparator(trimmed)) {
        return (await probeExecutable(trimmed, { probeTimeoutMs, env })) ? trimmed : null;
    }
    const candidates = await enumerateCandidates(trimmed, env);
    for (const candidate of candidates) {
        if (await probeExecutable(candidate, { probeTimeoutMs, env })) {
            return candidate;
        }
    }
    return null;
}
export async function isCommandAvailable(command) {
    return (await findExecutable(command)) !== null;
}
//# sourceMappingURL=executable-resolution.js.map