import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
export function resolveBundledSkillsDir(moduleUrl = import.meta.url) {
    const moduleDir = path.dirname(fileURLToPath(moduleUrl));
    const candidates = [
        path.resolve(moduleDir, "..", "..", "..", "skills"),
        path.resolve(moduleDir, "..", "..", "..", "..", "..", "..", "skills"),
    ];
    return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0];
}
export function resolveSkillTargets(home = os.homedir()) {
    return {
        sourceDir: resolveBundledSkillsDir(),
        agentsDir: path.join(home, ".agents", "skills"),
        claudeDir: path.join(home, ".claude", "skills"),
        codexDir: path.join(home, ".codex", "skills"),
    };
}
//# sourceMappingURL=paths.js.map