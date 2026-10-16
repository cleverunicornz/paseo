import path from "node:path";
import { resolvePaseoHome } from "../../../paseo-home.js";
const OPENCODE_HOME_DIRNAME = "opencode-home";
export function resolveOpenCodeHomeDir(env = process.env) {
    return path.join(resolvePaseoHome(env), OPENCODE_HOME_DIRNAME);
}
//# sourceMappingURL=paths.js.map