import { createRequire } from "node:module";
import path from "node:path";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { applySherpaLoaderEnv, resolveSherpaLoaderEnv, sherpaPlatformPackageName, } from "./sherpa-runtime-env.js";
import { createExternalCommandProcessEnv } from "../../../../paseo-env.js";
let cached = null;
function appendAttempt(attempts, target, error) {
    attempts.push({ target, error });
}
function formatError(error) {
    if (!error) {
        return "unknown error";
    }
    if (error instanceof Error) {
        return error.message;
    }
    return String(error);
}
function maybePatchLinuxAddonRunpath(addonPath) {
    if (process.platform !== "linux") {
        return;
    }
    const patchelfEnv = createExternalCommandProcessEnv("patchelf", process.env);
    const patchelfCheck = spawnSync("patchelf", ["--version"], {
        env: patchelfEnv,
        stdio: "ignore",
    });
    if (patchelfCheck.status !== 0) {
        return;
    }
    const currentRpath = spawnSync("patchelf", ["--print-rpath", addonPath], {
        encoding: "utf8",
        env: patchelfEnv,
    });
    if (currentRpath.status !== 0) {
        return;
    }
    const rpath = (currentRpath.stdout ?? "").trim();
    if (rpath.includes("$ORIGIN")) {
        return;
    }
    spawnSync("patchelf", ["--set-rpath", "$ORIGIN", addonPath], {
        env: patchelfEnv,
        stdio: "ignore",
    });
}
function loadWithRequire(requireFn, target, attempts) {
    try {
        return requireFn(target);
    }
    catch (error) {
        appendAttempt(attempts, target, error);
        return null;
    }
}
function buildFailure(attempts, pkgName) {
    const details = attempts
        .map((attempt) => `- ${attempt.target}: ${formatError(attempt.error)}`)
        .join("\n");
    const message = [
        `Failed to load sherpa-onnx-node for ${process.platform}-${process.arch}.`,
        `Node ${process.version} (ABI ${process.versions.modules}).`,
        `Platform package: ${pkgName}.`,
        "Load attempts:",
        details || "- (no attempts made)",
    ].join("\n");
    return new Error(message);
}
export function loadSherpaOnnxNode() {
    if (cached) {
        return cached;
    }
    const require = createRequire(import.meta.url);
    const attempts = [];
    // Pass through upstream support matrix first.
    const direct = loadWithRequire(require, "sherpa-onnx-node", attempts);
    if (direct) {
        cached = direct;
        return cached;
    }
    // sherpa-onnx-node depends on a platform-specific package (e.g. sherpa-onnx-darwin-arm64)
    // that contains the native addon and shared libraries.
    const pkgName = sherpaPlatformPackageName();
    const resolvedEnv = resolveSherpaLoaderEnv();
    const platformPkgDir = resolvedEnv?.libDir ?? null;
    if (platformPkgDir) {
        applySherpaLoaderEnv(process.env);
        const addonPath = path.join(platformPkgDir, "sherpa-onnx.node");
        if (existsSync(addonPath)) {
            const byPath = loadWithRequire(require, addonPath, attempts);
            if (byPath) {
                cached = byPath;
                return cached;
            }
            // Linux fallback for broken prebuilt RUNPATHs.
            maybePatchLinuxAddonRunpath(addonPath);
            const afterPatch = loadWithRequire(require, addonPath, attempts);
            if (afterPatch) {
                cached = afterPatch;
                return cached;
            }
        }
    }
    throw buildFailure(attempts, pkgName);
}
//# sourceMappingURL=sherpa-onnx-node-loader.js.map