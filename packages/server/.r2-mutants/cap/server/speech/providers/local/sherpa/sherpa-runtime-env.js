import { createRequire } from "node:module";
import path from "node:path";
export function sherpaPlatformArch(platform = process.platform, arch = process.arch) {
    const normalizedPlatform = platform === "win32" ? "win" : platform;
    return `${normalizedPlatform}-${arch}`;
}
export function sherpaPlatformPackageName(platform = process.platform, arch = process.arch) {
    return `sherpa-onnx-${sherpaPlatformArch(platform, arch)}`;
}
export function sherpaLoaderEnvKey(platform = process.platform) {
    if (platform === "linux") {
        return "LD_LIBRARY_PATH";
    }
    if (platform === "darwin") {
        return "DYLD_LIBRARY_PATH";
    }
    if (platform === "win32") {
        return "PATH";
    }
    return null;
}
export function prependEnvPath(existing, value) {
    const parts = (existing ?? "").split(path.delimiter).filter(Boolean);
    if (parts.includes(value)) {
        return parts.join(path.delimiter);
    }
    return [value, ...parts].join(path.delimiter);
}
export function resolveSherpaLoaderEnv(platform = process.platform, arch = process.arch) {
    const key = sherpaLoaderEnvKey(platform);
    if (!key) {
        return null;
    }
    const packageName = sherpaPlatformPackageName(platform, arch);
    const require = createRequire(import.meta.url);
    try {
        const pkgJson = require.resolve(`${packageName}/package.json`);
        return {
            key,
            libDir: path.dirname(pkgJson),
            packageName,
        };
    }
    catch {
        return null;
    }
}
/**
 * Find the actual case-sensitive key in a plain object that matches the given
 * key case-insensitively. On Windows, `{...process.env}` produces a plain
 * (case-sensitive) object where PATH is typically stored as `Path`. Using a
 * hardcoded `"PATH"` would miss the existing key and create a duplicate,
 * breaking the child process's PATH.
 */
function findEnvKey(env, key) {
    const lower = key.toLowerCase();
    for (const k of Object.keys(env)) {
        if (k.toLowerCase() === lower)
            return k;
    }
    return key;
}
export function applySherpaLoaderEnv(env, platform = process.platform, arch = process.arch) {
    const resolved = resolveSherpaLoaderEnv(platform, arch);
    if (!resolved) {
        return {
            changed: false,
            key: null,
            libDir: null,
            packageName: null,
        };
    }
    const actualKey = findEnvKey(env, resolved.key);
    const next = prependEnvPath(env[actualKey], resolved.libDir);
    const changed = next !== (env[actualKey] ?? "");
    env[actualKey] = next;
    return {
        changed,
        key: resolved.key,
        libDir: resolved.libDir,
        packageName: resolved.packageName,
    };
}
//# sourceMappingURL=sherpa-runtime-env.js.map