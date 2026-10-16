import type { ServiceProxySubsystem } from "./service-proxy.js";
export type ScriptHealthState = "pending" | "healthy" | "unhealthy";
export interface ScriptHealthEntry {
    scriptName: string;
    hostname: string;
    port: number;
    health: ScriptHealthState;
}
export declare class ScriptHealthMonitor {
    private readonly serviceProxy;
    private readonly onChange;
    private readonly pollIntervalMs;
    private readonly probeTimeoutMs;
    private readonly graceMs;
    private readonly failuresBeforeStopped;
    private readonly routeStates;
    private readonly lastEmittedSnapshots;
    private intervalHandle;
    private pollInFlight;
    constructor({ serviceProxy, onChange, pollIntervalMs, probeTimeoutMs, graceMs, failuresBeforeStopped, }: {
        serviceProxy: ServiceProxySubsystem;
        onChange: (workspaceId: string, scripts: ScriptHealthEntry[]) => void;
        pollIntervalMs?: number;
        probeTimeoutMs?: number;
        graceMs?: number;
        failuresBeforeStopped?: number;
    });
    start(): void;
    stop(): void;
    invalidateWorkspace(workspaceId: string): void;
    private poll;
    private getOrCreateState;
    private pruneRemovedRoutes;
    private buildWorkspaceScriptList;
    getHealthForHostname(hostname: string): ScriptHealthState | null;
    private toScriptHealthEntry;
    private probeRoute;
}
//# sourceMappingURL=script-health-monitor.d.ts.map