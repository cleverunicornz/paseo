import type { FileChange } from "./file-observer/index.js";
export declare const WATCHER_LIVENESS_CANARY_TIMEOUT_MS = 10000;
export interface WatcherLivenessCanary {
    readonly path: string;
    filterEvents(events: FileChange[]): FileChange[];
    verify(signal?: AbortSignal): Promise<void>;
}
export declare function createWatcherLivenessCanary(watchRoot: string, options?: {
    timeoutMs?: number;
}): WatcherLivenessCanary;
//# sourceMappingURL=watcher-liveness-canary.d.ts.map