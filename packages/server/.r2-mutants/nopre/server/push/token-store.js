import { existsSync, readFileSync } from "node:fs";
import { ensurePrivateFile, writePrivateFileAtomicSync } from "../private-files.js";
/**
 * Store for Expo push tokens.
 *
 * Tokens are persisted to disk so pushes still work after daemon restarts.
 */
export class PushTokenStore {
    constructor(logger, filePath, now, leaseMs, write = writePrivateFileAtomicSync) {
        this.subscriptions = new Map();
        this.logger = logger.child({ component: "token-store" });
        this.filePath = filePath;
        this.now = now;
        this.leaseMs = leaseMs;
        this.write = write;
        this.loadFromDisk();
    }
    renewToken(token) {
        const normalized = token.trim();
        if (!normalized)
            return;
        const now = this.now();
        const currentExpiry = this.subscriptions.get(normalized);
        if (currentExpiry !== undefined && currentExpiry - now > this.leaseMs / 2)
            return;
        const next = new Map(this.subscriptions);
        next.set(normalized, now + this.leaseMs);
        this.persist(next);
        this.subscriptions = next;
        this.logger.debug({ total: this.subscriptions.size }, "Renewed token");
    }
    revokeToken(token) {
        const normalized = token.trim();
        if (!normalized)
            return;
        if (!this.subscriptions.has(normalized))
            return;
        const next = new Map(this.subscriptions);
        next.delete(normalized);
        this.persist(next);
        this.subscriptions = next;
        this.logger.debug({ total: this.subscriptions.size }, "Revoked token");
    }
    getActiveTokens() {
        const now = this.now();
        const active = new Map(this.subscriptions);
        for (const [token, expiresAt] of this.subscriptions) {
            if (expiresAt <= now) {
                active.delete(token);
            }
        }
        if (active.size !== this.subscriptions.size) {
            try {
                this.persist(active);
                this.subscriptions = active;
            }
            catch {
                // Keep the previous state so a later send retries pruning. Expired tokens
                // are still excluded from this delivery.
            }
        }
        return Array.from(active.keys());
    }
    loadFromDisk() {
        try {
            if (!existsSync(this.filePath)) {
                return;
            }
            ensurePrivateFile(this.filePath);
            const raw = readFileSync(this.filePath, "utf-8");
            const parsed = JSON.parse(raw);
            const loaded = new Map();
            const subscriptions = Array.isArray(parsed.subscriptions) ? parsed.subscriptions : [];
            for (const value of subscriptions) {
                if (!value || typeof value !== "object")
                    continue;
                const candidate = value;
                if (typeof candidate.token !== "string" || typeof candidate.expiresAt !== "string")
                    continue;
                const token = candidate.token.trim();
                const expiresAt = Date.parse(candidate.expiresAt);
                if (token && Number.isFinite(expiresAt)) {
                    loaded.set(token, expiresAt);
                }
            }
            this.subscriptions = loaded;
            const legacyTokens = Array.isArray(parsed.tokens)
                ? parsed.tokens.filter((token) => typeof token === "string")
                : [];
            if (legacyTokens.length > 0) {
                const migrated = new Map(loaded);
                const expiresAt = this.now() + this.leaseMs;
                for (const token of legacyTokens) {
                    const normalized = token.trim();
                    if (normalized)
                        migrated.set(normalized, expiresAt);
                }
                this.persist(migrated);
                this.subscriptions = migrated;
            }
            this.logger.info({ total: this.subscriptions.size }, "Loaded push tokens");
        }
        catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            this.logger.warn({ err }, "Failed to load push tokens");
        }
    }
    persist(subscriptions) {
        try {
            const payload = JSON.stringify({
                subscriptions: Array.from(subscriptions, ([token, expiresAt]) => ({
                    token,
                    expiresAt: new Date(expiresAt).toISOString(),
                })),
            }, null, 2) + "\n";
            this.write(this.filePath, payload);
        }
        catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            this.logger.warn({ err }, "Failed to persist push tokens");
            throw err;
        }
    }
}
//# sourceMappingURL=token-store.js.map