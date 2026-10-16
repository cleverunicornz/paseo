import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { isRealpathInsideRoot } from "../../../utils/path.js";
import { PASEO_CLI_PACKAGE } from "./npm-global-cli.js";
const PackageJsonSchema = z.object({ name: z.string().optional() }).passthrough();
export const daemonInstallOriginRuntime = {
    resolveCurrentServerPackageRoot,
};
export function resolveNpmGlobalPrefix(serverPackageRoot) {
    if (!serverPackageRoot)
        return undefined;
    let directory = serverPackageRoot;
    let prefix;
    while (path.dirname(directory) !== directory) {
        if (path.basename(directory) === "node_modules") {
            const root = path.dirname(directory);
            if (process.platform === "win32")
                prefix = root;
            else if (path.basename(root) === "lib")
                prefix = path.dirname(root);
        }
        directory = path.dirname(directory);
    }
    return prefix;
}
export function validateDaemonInstallOrigin(install, daemonVersion, runtime = daemonInstallOriginRuntime) {
    if (install.isLinked) {
        return `The global ${PASEO_CLI_PACKAGE} install is linked; self-update only supports normal npm global installs.`;
    }
    if (daemonVersion && install.version !== daemonVersion) {
        return `This daemon is not running from the npm global ${PASEO_CLI_PACKAGE} install (global npm has ${install.version}, daemon is ${daemonVersion}).`;
    }
    const currentServerPackageRoot = runtime.resolveCurrentServerPackageRoot();
    if (!currentServerPackageRoot) {
        return "Unable to verify that this daemon is running from an npm global install.";
    }
    if (!isCurrentServerUnderNpmInstall(currentServerPackageRoot, install)) {
        return `This daemon is not running from the npm global ${PASEO_CLI_PACKAGE} install.`;
    }
    return null;
}
function isCurrentServerUnderNpmInstall(currentServerPackageRoot, install) {
    const roots = install.globalRootPath
        ? [install.packagePath, globalNodeModulesPath(install.globalRootPath)]
        : [install.packagePath];
    return roots.some((root) => isRealpathInsideRoot(root, currentServerPackageRoot));
}
function globalNodeModulesPath(globalRootPath) {
    const normalized = path.normalize(globalRootPath);
    return path.basename(normalized) === "node_modules"
        ? normalized
        : path.join(normalized, "node_modules");
}
function resolveCurrentServerPackageRoot() {
    return resolvePackageRootFrom(fileURLToPath(import.meta.url), "@getpaseo/server");
}
function resolvePackageRootFrom(startPath, packageName) {
    let currentDir = path.dirname(startPath);
    while (true) {
        const packageJsonPath = path.join(currentDir, "package.json");
        if (existsSync(packageJsonPath)) {
            try {
                const packageJson = PackageJsonSchema.parse(JSON.parse(readFileSync(packageJsonPath, "utf8")));
                if (packageJson.name === packageName) {
                    return currentDir;
                }
            }
            catch {
                return null;
            }
        }
        const parentDir = path.dirname(currentDir);
        if (parentDir === currentDir) {
            return null;
        }
        currentDir = parentDir;
    }
}
//# sourceMappingURL=install-origin.js.map