import { type PidLockInfo } from "./pid-lock.js";
export { resolvePaseoHome } from "./paseo-home.js";
export { ensurePrivateDirectory } from "./private-files.js";
export { daemonLaunchEnvironment } from "./config-environment.js";
export { readLocalCredentialForTarget } from "./local-credential.js";
export { isSamePidLock as isSameDaemonInstance, type PidLockInfo as DaemonInstance, } from "./pid-lock.js";
export declare class DaemonInstanceError extends Error {
    readonly code: string;
    constructor(code: string, message: string);
}
export declare function readDaemonInstance(home: string): Promise<PidLockInfo | null>;
export declare function daemonLogPath(home: string): string;
export declare function waitForDaemonReady(home: string, options?: {
    timeoutMs?: number;
    instance?: PidLockInfo;
    signal?: AbortSignal;
}): Promise<PidLockInfo & {
    listen: string;
}>;
export declare function stopDaemonInstance(home: string, options?: {
    instance?: PidLockInfo;
    force?: boolean;
    timeoutMs?: number;
    killTimeoutMs?: number;
    requestShutdown?: (instance: PidLockInfo & {
        listen: string;
    }) => Promise<void>;
}): Promise<{
    action: "stopped" | "not_running";
    pid: number | null;
    forced: boolean;
    usedLifecycleRpc: boolean;
}>;
export declare function startDaemonInstance(input: {
    home: string;
    command: string;
    args: string[];
    env: NodeJS.ProcessEnv;
    mode: "managed" | "deployment";
    desktopManaged?: boolean;
    foreground?: boolean;
    timeoutMs?: number;
    signal?: AbortSignal;
    onAcquired?: (instance: PidLockInfo) => void;
    onReady?: (instance: PidLockInfo & {
        listen: string;
    }) => void;
}): Promise<{
    instance: PidLockInfo;
    spawned: boolean;
    exitCode?: number;
}>;
//# sourceMappingURL=daemon-instance.d.ts.map