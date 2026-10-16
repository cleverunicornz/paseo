import { watch } from "node:fs";
import path from "node:path";
import { getExplorerFileVersion, resolveExplorerFilePath } from "./service.js";
const nodeDependencies = {
    watchDirectory(directory, onChange, onError) {
        const watcher = watch(directory, (_event, filename) => {
            onChange(filename === null ? null : filename.toString());
        });
        watcher.on("error", onError);
        return watcher;
    },
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
};
export class FileObserver {
    constructor(dependencies = nodeDependencies) {
        this.observed = new Map();
        this.dependencies = dependencies;
    }
    async subscribe(input, listener) {
        const target = await resolveExplorerFilePath({ root: input.cwd, relativePath: input.path });
        let observed = this.observed.get(target);
        if (!observed) {
            const initial = await getExplorerFileVersion({ root: input.cwd, relativePath: input.path });
            observed = this.observed.get(target);
            if (!observed) {
                observed = {
                    cwd: input.cwd,
                    path: input.path,
                    basename: path.basename(target),
                    listeners: new Map(),
                    fingerprint: fingerprint(initial),
                    watcher: null,
                    debounce: null,
                    fallback: null,
                };
                this.observed.set(target, observed);
                this.startWatching(target, path.dirname(target), observed);
            }
        }
        const initial = await getExplorerFileVersion({
            root: input.cwd,
            relativePath: input.path,
        });
        observed.listeners.set(listener, { cwd: initial.cwd, path: initial.path });
        observed.fingerprint = fingerprint(initial);
        let active = true;
        return {
            initial,
            unsubscribe: () => {
                if (!active)
                    return;
                active = false;
                observed?.listeners.delete(listener);
                if (observed && observed.listeners.size === 0) {
                    this.stopWatching(observed);
                    this.observed.delete(target);
                }
            },
        };
    }
    dispose() {
        for (const observed of this.observed.values()) {
            this.stopWatching(observed);
        }
        this.observed.clear();
    }
    startWatching(target, directory, observed) {
        try {
            observed.watcher = this.dependencies.watchDirectory(directory, (filename) => {
                if (filename === null || filename === observed.basename) {
                    this.scheduleRestat(target, observed);
                }
            }, () => this.useFallback(target, observed));
        }
        catch {
            this.useFallback(target, observed);
        }
    }
    useFallback(target, observed) {
        observed.watcher?.close();
        observed.watcher = null;
        if (observed.fallback)
            return;
        observed.fallback = this.dependencies.setInterval(() => this.restate(target, observed), 5000);
    }
    scheduleRestat(target, observed) {
        if (observed.debounce) {
            this.dependencies.clearTimeout(observed.debounce);
        }
        observed.debounce = this.dependencies.setTimeout(() => {
            observed.debounce = null;
            return this.restate(target, observed);
        }, 50);
    }
    async restate(target, observed) {
        if (this.observed.get(target) !== observed)
            return;
        const version = await getExplorerFileVersion({
            root: observed.cwd,
            relativePath: observed.path,
        });
        const nextFingerprint = fingerprint(version);
        if (nextFingerprint === observed.fingerprint)
            return;
        observed.fingerprint = nextFingerprint;
        for (const [listener, identity] of observed.listeners) {
            listener({ ...version, ...identity });
        }
    }
    stopWatching(observed) {
        observed.watcher?.close();
        if (observed.debounce)
            this.dependencies.clearTimeout(observed.debounce);
        if (observed.fallback)
            this.dependencies.clearInterval(observed.fallback);
        observed.watcher = null;
        observed.debounce = null;
        observed.fallback = null;
    }
}
function fingerprint(version) {
    if (version.status !== "ready")
        return version.status;
    return `${version.status}:${version.revision ?? `${version.size}:${version.modifiedAt}`}`;
}
export const workspaceFileObserver = new FileObserver();
//# sourceMappingURL=observer.js.map