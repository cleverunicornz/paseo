import { stat } from "node:fs/promises";
import { toError } from "./paths.js";
const EVENT_BATCH_DELAY_MS = 10;
export function createManagedObservation(input) {
    return new Observation(input);
}
class Observation {
    constructor(input) {
        this.input = input;
        this.status = "open";
        this.pendingEvents = new Map();
        this.flushTimer = null;
        this.closePromise = null;
        this.root = input.root;
        this.metrics = input.metrics;
        this.ignoredRoots = input.paths.normalizeIgnoredRoots(input.root, input.options.ignore ?? []);
        this.backend = input.createBackend(this);
    }
    async start() {
        const rootStats = await stat(this.root);
        if (!rootStats.isDirectory()) {
            throw new Error(`File observation requires a directory: ${this.root}`);
        }
        try {
            await this.backend.start();
        }
        catch (error) {
            await this.close();
            throw error;
        }
    }
    subscription() {
        return {
            updateIgnore: (paths) => this.updateIgnore(paths),
            unsubscribe: () => this.close(),
        };
    }
    async updateIgnore(paths) {
        if (!this.isActive())
            return;
        const next = this.input.paths.normalizeIgnoredRoots(this.root, paths);
        if (samePaths(this.ignoredRoots, next))
            return;
        this.ignoredRoots = next;
        for (const path of this.pendingEvents.keys()) {
            if (this.isIgnored(path))
                this.pendingEvents.delete(path);
        }
        try {
            await this.backend.updateIgnore();
        }
        catch (error) {
            this.fail(toError(error));
            throw error;
        }
    }
    close() {
        if (this.closePromise)
            return this.closePromise;
        this.status = "closed";
        this.cancelDelivery();
        this.closePromise = this.backend.close().finally(this.input.onClosed);
        return this.closePromise;
    }
    getDiagnostics() {
        return {
            ...this.backend.getDiagnostics(),
            pendingEventCount: this.pendingEvents.size,
        };
    }
    isActive() {
        return this.status === "open";
    }
    isIgnored(path) {
        return this.ignoredRoots.some((root) => this.input.paths.isInside(root, path));
    }
    isPathInside(root, path) {
        return this.input.paths.isInside(root, path);
    }
    queueEvent(type, path) {
        if (!this.isActive() || this.isIgnored(path))
            return;
        const previous = this.pendingEvents.get(path);
        this.pendingEvents.set(path, mergeChange(previous, { path, type }));
        if (this.flushTimer)
            return;
        this.flushTimer = setTimeout(() => {
            this.flushTimer = null;
            if (!this.isActive() || this.pendingEvents.size === 0)
                return;
            const events = [...this.pendingEvents.values()];
            this.pendingEvents.clear();
            this.input.callback(null, events);
        }, EVENT_BATCH_DELAY_MS);
    }
    fail(error) {
        if (!this.isActive())
            return;
        this.status = "failed";
        this.metrics.observerFailureCount += 1;
        this.cancelDelivery();
        this.beginFailureClose();
        this.input.callback(error, []);
    }
    beginFailureClose() {
        this.closePromise = this.backend.close().finally(this.input.onClosed);
    }
    cancelDelivery() {
        if (this.flushTimer)
            clearTimeout(this.flushTimer);
        this.flushTimer = null;
        this.pendingEvents.clear();
    }
}
function samePaths(left, right) {
    return left.length === right.length && left.every((path, index) => path === right[index]);
}
function mergeChange(previous, next) {
    if (!previous)
        return next;
    if (previous.type === "create" && next.type === "delete")
        return { ...next, type: "update" };
    if (previous.type === "delete" && next.type === "create")
        return { ...next, type: "update" };
    if (previous.type === "create")
        return previous;
    return next;
}
//# sourceMappingURL=observation.js.map