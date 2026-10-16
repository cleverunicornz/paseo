export interface DownloadTokenEntry {
    token: string;
    path: string;
    absolutePath: string;
    fileName: string;
    mimeType: string;
    size: number;
    expiresAt: number;
}
interface DownloadTokenStoreOptions {
    ttlMs: number;
    now?: () => number;
}
export declare class DownloadTokenStore {
    private readonly ttlMs;
    private readonly now;
    private readonly tokens;
    constructor(options: DownloadTokenStoreOptions);
    issueToken(input: Omit<DownloadTokenEntry, "token" | "expiresAt">): DownloadTokenEntry;
    consumeToken(token: string): DownloadTokenEntry | null;
    private pruneExpired;
}
export {};
//# sourceMappingURL=token-store.d.ts.map