import type pino from "pino";
import { writePrivateFileAtomicSync } from "../private-files.js";
/**
 * Store for Expo push tokens.
 *
 * Tokens are persisted to disk so pushes still work after daemon restarts.
 */
export declare class PushTokenStore {
    private readonly logger;
    private subscriptions;
    private readonly filePath;
    private readonly now;
    private readonly leaseMs;
    private readonly write;
    constructor(logger: pino.Logger, filePath: string, now: () => number, leaseMs: number, write?: typeof writePrivateFileAtomicSync);
    renewToken(token: string): void;
    revokeToken(token: string): void;
    getActiveTokens(): string[];
    private loadFromDisk;
    private persist;
}
//# sourceMappingURL=token-store.d.ts.map