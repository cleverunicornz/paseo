export type FileChangeType = "create" | "update" | "delete";
export interface FileChange {
    path: string;
    type: FileChangeType;
}
export interface FileObserverOptions {
    ignore?: string[];
}
export type FileObserverCallback = (error: Error | null, events: FileChange[]) => void;
export interface FileObserverSubscription {
    updateIgnore(paths: string[]): Promise<void>;
    unsubscribe(): Promise<void>;
}
export interface FileObserverDiagnostics {
    activeObservationCount: number;
    nativeHandleCount: number;
    nativeTrackedFileCount: number;
    pendingEventCount: number;
    pendingReconciliationWorkCount: number;
    pendingClassificationCount: number;
    reconciliationInFlightCount: number;
    reconciliationCount: number;
    scopedReconciliationCount: number;
    fullReconciliationCount: number;
    reconciliationFailureCount: number;
    observerFailureCount: number;
    directoryLimitFailureCount: number;
    nativeEventCount: number;
    nativeChangeEventCount: number;
    nativeRenameEventCount: number;
    nativePathlessEventCount: number;
    nativeClassificationCount: number;
    nativeShallowScanCount: number;
    lastReconciliationDurationMs: number;
    maxReconciliationDurationMs: number;
}
export interface FileObserver {
    subscribe(directory: string, callback: FileObserverCallback, options?: FileObserverOptions): Promise<FileObserverSubscription>;
    getDiagnostics(): FileObserverDiagnostics;
    close(): Promise<void>;
}
export type SubscribeToFileChanges = FileObserver["subscribe"];
export declare function createFileObserver(): FileObserver;
//# sourceMappingURL=index.d.ts.map