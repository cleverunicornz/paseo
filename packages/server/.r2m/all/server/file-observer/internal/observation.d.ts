import type { FileObserverCallback, FileObserverOptions, FileObserverSubscription } from "../index.js";
import type { BackendDiagnostics, CreateObservationBackend, ObserverMetrics } from "./contracts.js";
import type { ObserverPaths } from "./paths.js";
export interface ManagedObservation {
    start(): Promise<void>;
    subscription(): FileObserverSubscription;
    close(): Promise<void>;
    getDiagnostics(): BackendDiagnostics & {
        pendingEventCount: number;
    };
}
export declare function createManagedObservation(input: {
    root: string;
    callback: FileObserverCallback;
    options: FileObserverOptions;
    paths: ObserverPaths;
    metrics: ObserverMetrics;
    createBackend: CreateObservationBackend;
    onClosed: () => void;
}): ManagedObservation;
//# sourceMappingURL=observation.d.ts.map