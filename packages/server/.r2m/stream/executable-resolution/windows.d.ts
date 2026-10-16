interface WindowsFindExecutableOptions {
    enumeratePathCandidates: (name: string) => Promise<string[]>;
    probeExecutable: (executablePath: string, timeoutMs: number) => Promise<boolean>;
    exists: (path: string) => boolean;
    localAppData?: string;
    probeTimeoutMs: number;
}
interface WindowsExecutableExistsOptions {
    exists: (path: string) => boolean;
}
declare function find(input: string, options: WindowsFindExecutableOptions): Promise<string | null>;
declare function exists(executablePath: string, options: WindowsExecutableExistsOptions): string | null;
export declare const windowsExecutableResolution: {
    exists: typeof exists;
    find: typeof find;
};
export {};
//# sourceMappingURL=windows.d.ts.map