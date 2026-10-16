import { existsSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { PaseoConfigRawSchema, } from "@getpaseo/protocol/paseo-config-schema";
export { PaseoConfigRevisionSchema, ProjectConfigRpcErrorSchema, } from "@getpaseo/protocol/paseo-config-schema";
export const PASEO_CONFIG_FILE_NAME = "paseo.json";
export function resolvePaseoConfigPath(repoRoot) {
    return join(repoRoot, PASEO_CONFIG_FILE_NAME);
}
export function statPaseoConfigPath(repoRoot) {
    const configPath = resolvePaseoConfigPath(repoRoot);
    if (!existsSync(configPath)) {
        return null;
    }
    const stats = statSync(configPath);
    return {
        mtimeMs: stats.mtimeMs,
        size: stats.size,
    };
}
export function readPaseoConfigJson(repoRoot) {
    const configPath = resolvePaseoConfigPath(repoRoot);
    if (!existsSync(configPath)) {
        return null;
    }
    return JSON.parse(readFileSync(configPath, "utf8"));
}
export function readPaseoConfigForEdit(repoRoot) {
    try {
        const json = readPaseoConfigJson(repoRoot);
        if (json === null) {
            return { ok: true, config: null, revision: null };
        }
        return {
            ok: true,
            config: PaseoConfigRawSchema.parse(json),
            revision: statPaseoConfigPath(repoRoot),
        };
    }
    catch {
        return {
            ok: false,
            error: { code: "invalid_project_config" },
        };
    }
}
export function writePaseoConfigForEdit(input) {
    const parsed = PaseoConfigRawSchema.safeParse(input.config);
    if (!parsed.success) {
        return { ok: false, error: { code: "invalid_project_config" } };
    }
    const configPath = resolvePaseoConfigPath(input.repoRoot);
    const tempPath = join(input.repoRoot, `.${PASEO_CONFIG_FILE_NAME}.${process.pid}.${randomUUID()}.tmp`);
    try {
        writeFileSync(tempPath, `${JSON.stringify(parsed.data, null, 2)}\n`);
        const currentRevision = statPaseoConfigPath(input.repoRoot);
        if (!paseoConfigRevisionsEqual(currentRevision, input.expectedRevision)) {
            removeTempPaseoConfig(tempPath);
            return {
                ok: false,
                error: { code: "stale_project_config", currentRevision },
            };
        }
        renameSync(tempPath, configPath);
        const revision = statPaseoConfigPath(input.repoRoot);
        if (!revision) {
            return { ok: false, error: { code: "write_failed" } };
        }
        return { ok: true, config: parsed.data, revision };
    }
    catch {
        removeTempPaseoConfig(tempPath);
        return { ok: false, error: { code: "write_failed" } };
    }
}
function paseoConfigRevisionsEqual(left, right) {
    if (left === null || right === null) {
        return left === right;
    }
    return left.mtimeMs === right.mtimeMs && left.size === right.size;
}
function removeTempPaseoConfig(tempPath) {
    try {
        rmSync(tempPath, { force: true });
    }
    catch {
        // Best-effort cleanup only; callers need the original write outcome.
    }
}
//# sourceMappingURL=paseo-config-file.js.map