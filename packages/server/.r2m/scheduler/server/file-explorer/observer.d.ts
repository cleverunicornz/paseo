import type { FileVersion } from "@getpaseo/protocol/messages";
interface FileWatch {
    close(): void;
}
export interface FileObserverDependencies {
    watchDirectory(directory: string, onChange: (filename: string | null) => void, onError: () => void): FileWatch;
    setTimeout(callback: () => void | Promise<void>, delayMs: number): ReturnType<typeof setTimeout>;
    clearTimeout(handle: ReturnType<typeof setTimeout>): void;
    setInterval(callback: () => void | Promise<void>, delayMs: number): ReturnType<typeof setInterval>;
    clearInterval(handle: ReturnType<typeof setInterval>): void;
}
export declare class FileObserver {
    private readonly dependencies;
    private readonly observed;
    constructor(dependencies?: FileObserverDependencies);
    subscribe(input: {
        cwd: string;
        path: string;
    }, listener: (version: FileVersion) => void): Promise<{
        initial: FileVersion;
        unsubscribe: () => void;
    }>;
    dispose(): void;
    private startWatching;
    private useFallback;
    private scheduleRestat;
    private restate;
    private stopWatching;
}
export declare const workspaceFileObserver: FileObserver;
export {};
//# sourceMappingURL=observer.d.ts.map