import { type DaemonInstallOriginRuntime } from "./install-origin.js";
import { type NpmGlobalPaseoCli } from "./npm-global-cli.js";
export type DaemonSelfUpdatePhase = "starting" | "downloading" | "installing" | "complete";
export interface DaemonSelfUpdateResult {
    success: boolean;
    error: string | null;
    newVersion: string | null;
}
export interface DaemonSelfUpdateInput {
    daemonVersion: string | null;
    desktopManaged: boolean;
    onProgress: (phase: DaemonSelfUpdatePhase) => void;
    logger: DaemonSelfUpdateLogger;
}
export interface DaemonSelfUpdateLogger {
    error(obj: object, msg?: string): void;
    warn(obj: object, msg?: string): void;
}
export interface DaemonSelfUpdateRuntime {
    npm: NpmGlobalPaseoCli;
    installOrigin: DaemonInstallOriginRuntime;
}
export declare class DaemonSelfUpdateInProgressError extends Error {
    constructor();
}
export declare class DaemonSelfUpdater {
    private readonly runtime;
    private inProgress;
    constructor(runtime?: DaemonSelfUpdateRuntime);
    update(input: DaemonSelfUpdateInput): Promise<DaemonSelfUpdateResult>;
}
export declare const daemonSelfUpdater: DaemonSelfUpdater;
//# sourceMappingURL=daemon-self-updater.d.ts.map