import { z } from "zod";
export declare const pidLockInfoSchema: z.ZodObject<{
    pid: z.ZodNumber;
    startedAt: z.ZodString;
    hostname: z.ZodString;
    uid: z.ZodNumber;
    listen: z.ZodNullable<z.ZodString>;
    serverId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    desktopManaged: z.ZodOptional<z.ZodBoolean>;
    heartbeat: z.ZodOptional<z.ZodLiteral<true>>;
    bootId: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export interface PidLockInfo extends z.infer<typeof pidLockInfoSchema> {
}
export declare class PidLockError extends Error {
    readonly existingLock?: PidLockInfo | undefined;
    constructor(message: string, existingLock?: PidLockInfo | undefined);
}
/**
 * Whether the process that wrote this lock is still running.
 *
 * A PID alone does not identify the supervisor: the operating system hands the number to
 * something else once the supervisor is gone, and a reboot reassigns it freely. A process
 * cannot predate the boot it runs under, so a lock written during another boot is abandoned
 * however alive its PID looks.
 */
export declare function isPidLockOwnerRunning(lock: PidLockInfo): boolean;
interface AcquirePidLockOptions {
    ownerPid?: number;
}
export declare function isSamePidLock(left: PidLockInfo, right: PidLockInfo): boolean;
export declare function acquirePidLock(paseoHome: string, listen: string | null, options?: AcquirePidLockOptions): Promise<void>;
export declare function refreshPidLock(paseoHome: string, options?: {
    ownerPid?: number;
}): Promise<void>;
export declare function startPidLockHeartbeat(paseoHome: string, options?: {
    ownerPid?: number;
    intervalMs?: number;
    onError?: (error: unknown) => void;
}): () => void;
export declare function updatePidLock(paseoHome: string, patch: {
    listen: string;
    serverId: string;
} | {
    listen: null;
    serverId: null;
}, options?: {
    ownerPid?: number;
}): Promise<void>;
export declare function releasePidLock(paseoHome: string, options?: {
    ownerPid?: number;
    startedAt?: string;
}): Promise<void>;
export declare function getPidLockInfo(paseoHome: string): Promise<PidLockInfo | null>;
export declare function isLocked(paseoHome: string): Promise<{
    locked: boolean;
    info?: PidLockInfo;
}>;
export {};
//# sourceMappingURL=pid-lock.d.ts.map