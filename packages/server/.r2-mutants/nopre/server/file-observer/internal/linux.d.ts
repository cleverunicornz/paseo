import { type FSWatcher } from "node:fs";
import type { ObservationBackend, ObservationHost } from "./contracts.js";
import type { ObserverPaths } from "./paths.js";
type WatchDirectory = (directory: string, listener: (eventType: string, filename: string | null) => void) => FSWatcher;
export declare function createLinuxBackend(host: ObservationHost, paths: ObserverPaths, observe?: WatchDirectory): ObservationBackend;
export {};
//# sourceMappingURL=linux.d.ts.map