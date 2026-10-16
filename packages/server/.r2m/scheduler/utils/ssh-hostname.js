import { normalizeHost } from "@getpaseo/protocol/git-remote";
import { findExecutable } from "../executable-resolution/executable-resolution.js";
import { execCommand } from "./spawn.js";
const SSH_HOSTNAME_RESOLVE_TIMEOUT_MS = 5000;
let sshExecutableLookup = null;
const sshHostnameResolutionCache = new Map();
/**
 * Resolve an SSH host alias (e.g. `github-work` from ~/.ssh/config) to its
 * configured HostName via `ssh -G`. Results are cached for the daemon's
 * lifetime; a host that isn't an alias resolves to itself.
 */
export async function resolveSshHostname(host) {
    const normalized = normalizeHost(host);
    if (!normalized) {
        return null;
    }
    const cached = sshHostnameResolutionCache.get(normalized);
    if (cached) {
        return cached;
    }
    const resolution = runSshHostnameLookup(normalized);
    sshHostnameResolutionCache.set(normalized, resolution);
    return resolution;
}
async function runSshHostnameLookup(host) {
    sshExecutableLookup ?? (sshExecutableLookup = findExecutable("ssh"));
    const sshPath = await sshExecutableLookup;
    if (!sshPath) {
        return null;
    }
    try {
        const { stdout } = await execCommand(sshPath, ["-G", host], {
            env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
            maxBuffer: 1024 * 1024,
            timeout: SSH_HOSTNAME_RESOLVE_TIMEOUT_MS,
        });
        return parseSshHostname(stdout);
    }
    catch {
        return null;
    }
}
function parseSshHostname(stdout) {
    for (const line of stdout.split(/\r?\n/u)) {
        const trimmed = line.trim();
        if (!trimmed) {
            continue;
        }
        const [key, value] = trimmed.split(/\s+/u);
        if (key?.toLowerCase() !== "hostname") {
            continue;
        }
        const normalized = normalizeHost(value ?? "");
        if (normalized) {
            return normalized;
        }
    }
    return null;
}
//# sourceMappingURL=ssh-hostname.js.map