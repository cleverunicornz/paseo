import { randomUUID } from "node:crypto";
export class DownloadTokenStore {
    constructor(options) {
        this.tokens = new Map();
        this.ttlMs = options.ttlMs;
        this.now = options.now ?? (() => Date.now());
    }
    issueToken(input) {
        this.pruneExpired();
        const token = randomUUID();
        const expiresAt = this.now() + this.ttlMs;
        const entry = {
            ...input,
            token,
            expiresAt,
        };
        this.tokens.set(token, entry);
        return entry;
    }
    consumeToken(token) {
        const entry = this.tokens.get(token);
        if (!entry) {
            return null;
        }
        this.tokens.delete(token);
        if (entry.expiresAt <= this.now()) {
            return null;
        }
        return entry;
    }
    pruneExpired() {
        const now = this.now();
        for (const [token, entry] of this.tokens) {
            if (entry.expiresAt <= now) {
                this.tokens.delete(token);
            }
        }
    }
}
//# sourceMappingURL=token-store.js.map