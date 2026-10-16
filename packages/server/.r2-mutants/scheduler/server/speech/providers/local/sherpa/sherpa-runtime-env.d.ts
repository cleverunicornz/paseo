export type SherpaLoaderEnvKey = "LD_LIBRARY_PATH" | "DYLD_LIBRARY_PATH" | "PATH";
export interface SherpaLoaderEnvResolution {
    key: SherpaLoaderEnvKey;
    libDir: string;
    packageName: string;
}
export declare function sherpaPlatformArch(platform?: NodeJS.Platform, arch?: string): string;
export declare function sherpaPlatformPackageName(platform?: NodeJS.Platform, arch?: string): string;
export declare function sherpaLoaderEnvKey(platform?: NodeJS.Platform): SherpaLoaderEnvKey | null;
export declare function prependEnvPath(existing: string | undefined, value: string): string;
export declare function resolveSherpaLoaderEnv(platform?: NodeJS.Platform, arch?: string): SherpaLoaderEnvResolution | null;
export declare function applySherpaLoaderEnv(env: NodeJS.ProcessEnv, platform?: NodeJS.Platform, arch?: string): {
    changed: boolean;
    key: SherpaLoaderEnvKey | null;
    libDir: string | null;
    packageName: string | null;
};
//# sourceMappingURL=sherpa-runtime-env.d.ts.map