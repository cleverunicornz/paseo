export interface ObserverPaths {
    isInside(root: string, path: string): boolean;
    normalizeIgnoredRoots(root: string, paths: string[]): string[];
    collapse(paths: string[]): string[];
    isExpectedWatchDisappearance(error: unknown): boolean;
}
export declare function createObserverPaths(platform: NodeJS.Platform): ObserverPaths;
export declare function isMissingPathError(error: unknown): boolean;
export declare function toError(value: unknown): Error;
//# sourceMappingURL=paths.d.ts.map