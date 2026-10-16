import { posix, win32 } from "node:path";
export function createObserverPaths(platform) {
    const pathApi = platform === "win32" ? win32 : posix;
    function comparable(path) {
        return platform === "win32" ? path.toLowerCase() : path;
    }
    function isInside(root, path) {
        const comparedRoot = comparable(root);
        const comparedPath = comparable(path);
        return (comparedPath === comparedRoot || comparedPath.startsWith(`${comparedRoot}${pathApi.sep}`));
    }
    function collapse(paths) {
        // Plain lexicographic sort does not put a parent immediately before its
        // descendants: a sibling whose name extends the parent's with a
        // character that sorts below the separator (e.g. "app" vs "app-web")
        // lands between them. Sort on a key with the separator swapped for a
        // character below everything instead, so "app" < "app/src" < "app-web"
        // holds and one backward look is enough.
        const decorated = [...new Set(paths)].map((path) => ({
            path,
            key: comparable(path).split(pathApi.sep).join("\0"),
        }));
        decorated.sort((left, right) => {
            if (left.key < right.key)
                return -1;
            if (left.key > right.key)
                return 1;
            return 0;
        });
        const kept = [];
        for (const { path } of decorated) {
            const previous = kept[kept.length - 1];
            if (previous !== undefined && isInside(previous, path))
                continue;
            kept.push(path);
        }
        return kept;
    }
    return {
        isInside,
        collapse,
        normalizeIgnoredRoots(root, paths) {
            const inside = paths
                .map((path) => pathApi.resolve(path))
                .filter((path) => path !== root && isInside(root, path));
            return collapse(inside);
        },
        isExpectedWatchDisappearance(error) {
            const code = getErrorCode(error);
            return code === "ENOENT" || (platform === "win32" && code === "EPERM");
        },
    };
}
export function isMissingPathError(error) {
    const code = getErrorCode(error);
    return code === "ENOENT" || code === "ENOTDIR";
}
export function toError(value) {
    return value instanceof Error ? value : new Error(String(value));
}
function getErrorCode(error) {
    if (typeof error !== "object" || error === null || !("code" in error))
        return null;
    return typeof error.code === "string" ? error.code : null;
}
//# sourceMappingURL=paths.js.map