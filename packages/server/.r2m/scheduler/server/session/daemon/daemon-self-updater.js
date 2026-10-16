import { getErrorMessage } from "@getpaseo/protocol/error-utils";
import { daemonInstallOriginRuntime, resolveNpmGlobalPrefix, validateDaemonInstallOrigin, } from "./install-origin.js";
import { npmGlobalPaseoCli } from "./npm-global-cli.js";
export class DaemonSelfUpdateInProgressError extends Error {
    constructor() {
        super("An update is already in progress");
        this.name = "DaemonSelfUpdateInProgressError";
    }
}
const defaultRuntime = {
    npm: npmGlobalPaseoCli,
    installOrigin: daemonInstallOriginRuntime,
};
const DESKTOP_MANAGED_UPDATE_ERROR = "This daemon is managed by Paseo Desktop. Update Paseo Desktop on the host.";
export class DaemonSelfUpdater {
    constructor(runtime = defaultRuntime) {
        this.runtime = runtime;
        this.inProgress = false;
    }
    async update(input) {
        if (input.desktopManaged) {
            return { success: false, error: DESKTOP_MANAGED_UPDATE_ERROR, newVersion: null };
        }
        if (this.inProgress) {
            throw new DaemonSelfUpdateInProgressError();
        }
        this.inProgress = true;
        try {
            input.onProgress("starting");
            const npmOptions = {
                prefix: resolveNpmGlobalPrefix(this.runtime.installOrigin.resolveCurrentServerPackageRoot()),
            };
            const install = await this.runtime.npm.inspect(npmOptions);
            const unsupportedReason = validateDaemonInstallOrigin(install, input.daemonVersion, this.runtime.installOrigin);
            if (unsupportedReason) {
                return { success: false, error: unsupportedReason, newVersion: null };
            }
            input.onProgress("downloading");
            input.onProgress("installing");
            const result = await this.runtime.npm.installLatest(npmOptions);
            if (result.exitCode !== 0) {
                const error = result.stderr.trim() || result.stdout.trim() || `npm exited with code ${result.exitCode}`;
                input.logger.error({ exitCode: result.exitCode, stderr: result.stderr }, "Daemon self-update failed");
                return { success: false, error, newVersion: null };
            }
            const updatedInstall = await this.runtime.npm.inspect(npmOptions).catch((error) => {
                input.logger.warn({ err: error }, "Unable to read updated npm package version");
                return null;
            });
            input.onProgress("complete");
            return { success: true, error: null, newVersion: updatedInstall?.version ?? null };
        }
        catch (error) {
            input.logger.error({ err: error }, "Daemon self-update failed with exception");
            return { success: false, error: getErrorMessage(error), newVersion: null };
        }
        finally {
            this.inProgress = false;
        }
    }
}
export const daemonSelfUpdater = new DaemonSelfUpdater();
//# sourceMappingURL=daemon-self-updater.js.map