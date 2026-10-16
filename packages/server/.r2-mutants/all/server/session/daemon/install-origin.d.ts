import { type NpmGlobalPaseoInstall } from "./npm-global-cli.js";
export interface DaemonInstallOriginRuntime {
    resolveCurrentServerPackageRoot(): string | null;
}
export declare const daemonInstallOriginRuntime: DaemonInstallOriginRuntime;
export declare function resolveNpmGlobalPrefix(serverPackageRoot: string | null): string | undefined;
export declare function validateDaemonInstallOrigin(install: NpmGlobalPaseoInstall, daemonVersion: string | null, runtime?: DaemonInstallOriginRuntime): string | null;
//# sourceMappingURL=install-origin.d.ts.map