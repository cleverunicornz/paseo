import { resolve } from "node:path";
import { createLinuxBackend } from "./internal/linux.js";
import { createNativeRecursiveBackend } from "./internal/native-recursive.js";
import { createManagedObservation } from "./internal/observation.js";
import { createObserverPaths } from "./internal/paths.js";
export function createFileObserver() {
    const platform = process.platform;
    const paths = createObserverPaths(platform);
    const createBackend = platform === "darwin" || platform === "win32"
        ? (host) => createNativeRecursiveBackend(host, paths)
        : (host) => createLinuxBackend(host, paths);
    return new FileObserverService(createBackend, paths);
}
class FileObserverService {
    constructor(createBackend, paths) {
        this.createBackend = createBackend;
        this.paths = paths;
        this.state = {
            status: "open",
            observations: new Set(),
            metrics: createObserverMetrics(),
        };
        this.closePromise = null;
    }
    async subscribe(directory, callback, options = {}) {
        if (this.state.status === "closed")
            throw new Error("File observer is closed");
        const state = this.state;
        let observation;
        observation = createManagedObservation({
            root: resolve(directory),
            callback,
            options,
            paths: this.paths,
            metrics: state.metrics,
            createBackend: this.createBackend,
            onClosed: () => state.observations.delete(observation),
        });
        await observation.start();
        if (this.closePromise) {
            await observation.close();
            throw new Error("File observer is closed");
        }
        state.observations.add(observation);
        return observation.subscription();
    }
    getDiagnostics() {
        if (this.state.status === "closed")
            return emptyDiagnostics();
        const { observations, metrics } = this.state;
        let nativeHandleCount = 0;
        let nativeTrackedFileCount = 0;
        let pendingEventCount = 0;
        let pendingReconciliationWorkCount = 0;
        let pendingClassificationCount = 0;
        let reconciliationInFlightCount = 0;
        for (const observation of observations) {
            const diagnostics = observation.getDiagnostics();
            nativeHandleCount += diagnostics.nativeHandleCount;
            nativeTrackedFileCount += diagnostics.nativeTrackedFileCount;
            pendingEventCount += diagnostics.pendingEventCount;
            pendingReconciliationWorkCount += diagnostics.pendingReconciliationWorkCount;
            pendingClassificationCount += diagnostics.pendingClassificationCount;
            reconciliationInFlightCount += Number(diagnostics.reconciliationInFlight);
        }
        return {
            activeObservationCount: observations.size,
            nativeHandleCount,
            nativeTrackedFileCount,
            pendingEventCount,
            pendingReconciliationWorkCount,
            pendingClassificationCount,
            reconciliationInFlightCount,
            ...metrics,
        };
    }
    close() {
        if (this.closePromise)
            return this.closePromise;
        if (this.state.status === "closed")
            return Promise.resolve();
        const observations = [...this.state.observations];
        this.state = { status: "closed" };
        this.closePromise = Promise.allSettled(observations.map((observation) => observation.close())).then(() => undefined);
        return this.closePromise;
    }
}
function createObserverMetrics() {
    return {
        reconciliationCount: 0,
        scopedReconciliationCount: 0,
        fullReconciliationCount: 0,
        reconciliationFailureCount: 0,
        observerFailureCount: 0,
        directoryLimitFailureCount: 0,
        nativeEventCount: 0,
        nativeChangeEventCount: 0,
        nativeRenameEventCount: 0,
        nativePathlessEventCount: 0,
        nativeClassificationCount: 0,
        nativeShallowScanCount: 0,
        lastReconciliationDurationMs: 0,
        maxReconciliationDurationMs: 0,
    };
}
function emptyDiagnostics() {
    return {
        activeObservationCount: 0,
        nativeHandleCount: 0,
        nativeTrackedFileCount: 0,
        pendingEventCount: 0,
        pendingReconciliationWorkCount: 0,
        pendingClassificationCount: 0,
        reconciliationInFlightCount: 0,
        ...createObserverMetrics(),
    };
}
//# sourceMappingURL=index.js.map