import type { ObservationBackend, ObservationHost } from "./contracts.js";
import type { ObserverPaths } from "./paths.js";
type WatchDirectory = (root: string, listener: (eventType: string, filename: string | null) => void) => {
    close(): void;
    on(event: "error", listener: (error: Error) => void): unknown;
};
export declare function createNativeRecursiveBackend(host: ObservationHost, paths: ObserverPaths, observe?: WatchDirectory): ObservationBackend;
export {};
//# sourceMappingURL=native-recursive.d.ts.map