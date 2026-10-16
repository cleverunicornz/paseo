import os from "node:os";
import path from "node:path";
function expandHomeDir(input) {
    if (input.startsWith("~/")) {
        return path.join(os.homedir(), input.slice(2));
    }
    if (input === "~") {
        return os.homedir();
    }
    return input;
}
export function resolvePaseoHome(env = process.env) {
    const raw = env.PASEO_HOME ?? "~/.paseo";
    const resolved = path.resolve(expandHomeDir(raw));
    return resolved;
}
//# sourceMappingURL=paseo-home.js.map