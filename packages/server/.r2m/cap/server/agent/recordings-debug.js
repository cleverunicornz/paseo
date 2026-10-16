import { resolve } from "path";
function isTruthyEnv(value) {
    const normalized = (value ?? "").trim().toLowerCase();
    return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}
export function isPaseoDictationDebugEnabled() {
    return isTruthyEnv(process.env.PASEO_DICTATION_DEBUG);
}
export function resolveRecordingsDebugDir(explicitEnvVarName) {
    const explicit = process.env[explicitEnvVarName];
    if (explicit && explicit.trim()) {
        return resolve(explicit.trim());
    }
    if (!isPaseoDictationDebugEnabled()) {
        return null;
    }
    return resolve(process.cwd(), ".debug/recordings");
}
//# sourceMappingURL=recordings-debug.js.map