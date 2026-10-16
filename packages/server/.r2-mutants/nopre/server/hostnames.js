import net from "node:net";
function normalizeHostname(hostname) {
    return hostname.trim().toLowerCase();
}
function parseHostnameFromHostHeader(hostHeader) {
    const trimmed = hostHeader.trim();
    if (!trimmed)
        return null;
    // IPv6 in brackets: [::1]:6767
    if (trimmed.startsWith("[")) {
        const end = trimmed.indexOf("]");
        if (end === -1)
            return null;
        return normalizeHostname(trimmed.slice(1, end));
    }
    // IPv4/hostname with optional port: localhost:6767
    const colonIndex = trimmed.indexOf(":");
    if (colonIndex === -1) {
        return normalizeHostname(trimmed);
    }
    return normalizeHostname(trimmed.slice(0, colonIndex));
}
function matchesHostnamePattern(hostname, pattern) {
    const normalizedPattern = normalizeHostname(pattern);
    if (!normalizedPattern)
        return false;
    if (normalizedPattern.startsWith(".")) {
        const base = normalizedPattern.slice(1);
        if (!base)
            return false;
        return hostname === base || hostname.endsWith(`.${base}`);
    }
    return hostname === normalizedPattern;
}
function isDefaultAllowedHostname(hostname) {
    // Vite-style defaults: localhost, *.localhost, and all IP addresses.
    if (hostname === "localhost")
        return true;
    if (hostname.endsWith(".localhost"))
        return true;
    if (net.isIP(hostname) !== 0)
        return true;
    return false;
}
/**
 * Vite-style hostname allowlist check, adapted to raw Host headers.
 *
 * Semantics:
 * - `hostnames === true` => allow any host.
 * - `hostnames === []` or `undefined` => allow localhost, *.localhost, and all IPs.
 * - `hostnames === ['.example.com', 'myhost']` => allow those *in addition* to defaults.
 */
export function isHostnameAllowed(hostHeader, hostnames) {
    const hostname = hostHeader ? parseHostnameFromHostHeader(hostHeader) : null;
    if (!hostname)
        return false;
    if (hostnames === true)
        return true;
    // Defaults are always allowed.
    if (isDefaultAllowedHostname(hostname))
        return true;
    const patterns = hostnames ?? [];
    for (const pattern of patterns) {
        if (matchesHostnamePattern(hostname, pattern))
            return true;
    }
    return false;
}
export function mergeHostnames(values) {
    let merged = [];
    for (const value of values) {
        if (value === true)
            return true;
        if (!value)
            continue;
        merged = merged.concat(value);
    }
    const deduped = Array.from(new Set(merged.map((v) => v.trim()).filter((v) => v.length > 0)));
    return deduped;
}
export function parseHostnamesEnv(raw) {
    if (!raw)
        return undefined;
    const trimmed = raw.trim();
    if (!trimmed)
        return undefined;
    if (trimmed.toLowerCase() === "true")
        return true;
    return trimmed
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
}
//# sourceMappingURL=hostnames.js.map