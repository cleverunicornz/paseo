/**
 * Expand tilde in path to home directory
 */
export declare function expandTilde(path: string): string;
/**
 * Compare two path strings as filesystem-equivalent for cwd filtering.
 *
 * This is a string-only comparison: it normalizes separators and dot segments,
 * ignores trailing separators, strips Windows namespace prefixes, and
 * case-folds only when comparing as Windows. It does not resolve symlinks or
 * check whether either path exists.
 */
export declare function areEquivalentPaths(left: string, right: string): boolean;
export declare function createPathEquivalenceMatcher(target: string): (candidate: string) => boolean;
export declare function createRealpathAwarePathMatcher(target: string): (candidate: string) => boolean;
export declare function startPathContainmentMetrics(): void;
export declare function stopPathContainmentMetrics(): number;
export declare function isPathInsideRoot(root: string, candidate: string): boolean;
export declare function normalizePathForIdentity(value: string): string;
/**
 * Returns the candidate's relative suffix when it is inside root.
 *
 * The suffix is derived from the same lexical path pair used to prove
 * containment. Callers that map an existing filesystem path into a new root
 * must keep those two operations coupled.
 */
export declare function getRealpathAwareRelativePath(root: string, candidate: string): string | null;
export declare function isRealpathInsideRoot(root: string, candidate: string): boolean;
/**
 * True when `value`'s shape identifies it as a Windows path (drive letter,
 * `\\?\` device namespace, or UNC), independent of the host platform. Callers
 * that fold case for Windows-looking paths (this module's own comparisons,
 * and `pruneKnownDirectories` in `workspace-git-service.ts`, which needs the
 * same decision without paying for a realpath syscall) must all agree on this
 * one rule — do not reimplement the pattern.
 */
export declare function looksLikeDefiniteWindowsPath(value: string): boolean;
//# sourceMappingURL=path.d.ts.map