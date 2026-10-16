import net from "node:net";
export class ScriptHealthMonitor {
    constructor({ serviceProxy, onChange, pollIntervalMs = 3000, probeTimeoutMs = 500, graceMs = 5000, failuresBeforeStopped = 2, }) {
        this.routeStates = new Map();
        this.lastEmittedSnapshots = new Map();
        this.intervalHandle = null;
        this.pollInFlight = false;
        this.serviceProxy = serviceProxy;
        this.onChange = onChange;
        this.pollIntervalMs = pollIntervalMs;
        this.probeTimeoutMs = probeTimeoutMs;
        this.graceMs = graceMs;
        this.failuresBeforeStopped = failuresBeforeStopped;
    }
    start() {
        if (this.intervalHandle) {
            return;
        }
        const now = Date.now();
        for (const route of this.serviceProxy.getHealthCheckTargets()) {
            this.getOrCreateState(route, now);
        }
        this.intervalHandle = setInterval(() => {
            void this.poll();
        }, this.pollIntervalMs);
    }
    stop() {
        if (this.intervalHandle) {
            clearInterval(this.intervalHandle);
            this.intervalHandle = null;
        }
    }
    invalidateWorkspace(workspaceId) {
        const scripts = this.buildWorkspaceScriptList(workspaceId);
        const snapshot = JSON.stringify(scripts);
        if (snapshot === this.lastEmittedSnapshots.get(workspaceId)) {
            return;
        }
        this.lastEmittedSnapshots.set(workspaceId, snapshot);
        this.onChange(workspaceId, scripts);
    }
    async poll() {
        if (this.pollInFlight) {
            return;
        }
        this.pollInFlight = true;
        try {
            const routes = this.serviceProxy.getHealthCheckTargets();
            const activeHostnames = new Set(routes.map((route) => route.hostname));
            const changedWorkspaceIds = new Set();
            const now = Date.now();
            const probeTargets = routes
                .map((route) => ({ route, state: this.getOrCreateState(route, now) }))
                .filter(({ state }) => now - state.registeredAt >= this.graceMs);
            const healthResults = await Promise.all(probeTargets.map(({ route }) => this.probeRoute(route.port)));
            for (let i = 0; i < probeTargets.length; i += 1) {
                const { route, state } = probeTargets[i];
                const isHealthy = healthResults[i];
                const previousHealth = state.health;
                if (isHealthy) {
                    state.consecutiveFailures = 0;
                    state.health = "healthy";
                }
                else {
                    state.consecutiveFailures += 1;
                    if (state.consecutiveFailures >= this.failuresBeforeStopped) {
                        state.health = "unhealthy";
                    }
                }
                if (state.health !== previousHealth) {
                    changedWorkspaceIds.add(route.workspaceId);
                }
            }
            this.pruneRemovedRoutes(activeHostnames);
            for (const workspaceId of changedWorkspaceIds) {
                const scripts = this.buildWorkspaceScriptList(workspaceId);
                const snapshot = JSON.stringify(scripts);
                if (snapshot === this.lastEmittedSnapshots.get(workspaceId)) {
                    continue;
                }
                this.lastEmittedSnapshots.set(workspaceId, snapshot);
                this.onChange(workspaceId, scripts);
            }
        }
        finally {
            this.pollInFlight = false;
        }
    }
    getOrCreateState(route, registeredAt) {
        const existing = this.routeStates.get(route.hostname);
        if (existing) {
            return existing;
        }
        const state = {
            workspaceId: route.workspaceId,
            health: "pending",
            consecutiveFailures: 0,
            registeredAt,
        };
        this.routeStates.set(route.hostname, state);
        return state;
    }
    pruneRemovedRoutes(activeHostnames) {
        for (const [hostname, state] of this.routeStates.entries()) {
            if (activeHostnames.has(hostname)) {
                continue;
            }
            this.routeStates.delete(hostname);
            this.lastEmittedSnapshots.delete(state.workspaceId);
        }
    }
    buildWorkspaceScriptList(workspaceId) {
        return this.serviceProxy.getWorkspaceHealthTargets(workspaceId).flatMap((route) => {
            const state = this.routeStates.get(route.hostname);
            if (!state) {
                return [];
            }
            return [this.toScriptHealthEntry(route, state.health)];
        });
    }
    getHealthForHostname(hostname) {
        const state = this.routeStates.get(hostname);
        if (state) {
            return state.health;
        }
        const route = this.serviceProxy.getHealthTargetForHostname(hostname);
        if (!route) {
            return null;
        }
        return this.getOrCreateState(route, Date.now()).health;
    }
    toScriptHealthEntry(route, health) {
        return {
            scriptName: route.scriptName,
            hostname: route.hostname,
            port: route.port,
            health,
        };
    }
    probeRoute(port) {
        return new Promise((resolve) => {
            const socket = net.connect({ host: "127.0.0.1", port });
            let settled = false;
            const finish = (healthy) => {
                if (settled) {
                    return;
                }
                settled = true;
                socket.destroy();
                resolve(healthy);
            };
            socket.setTimeout(this.probeTimeoutMs);
            socket.once("connect", () => finish(true));
            socket.once("timeout", () => finish(false));
            socket.once("error", () => finish(false));
        });
    }
}
//# sourceMappingURL=script-health-monitor.js.map