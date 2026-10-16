import type pino from "pino";
import type { ManagedAgent, ProviderAvailability } from "../../agent/agent-manager.js";
import type { WebSocketRuntimeDiagnosticSnapshot } from "../../websocket/runtime-metrics.js";
import type { PersistedProjectRecord, PersistedWorkspaceRecord } from "../../workspace-registry.js";
import type { DaemonRuntimeConfig } from "./daemon-session.js";
export interface DaemonDiagnosticsOptions {
    paseoHome: string;
    serverId: string | undefined;
    daemonVersion: string | undefined;
    daemonRuntimeConfig: DaemonRuntimeConfig | undefined;
    listAgents: () => ManagedAgent[];
    listProjects: () => Promise<PersistedProjectRecord[]>;
    listWorkspaces: () => Promise<PersistedWorkspaceRecord[]>;
    listProviderAvailability: () => Promise<ProviderAvailability[]>;
    getWebSocketRuntimeMetrics: () => DaemonWebSocketRuntimeDiagnosticSnapshot | null;
    getObservationMetrics?: () => Record<string, number>;
    logger: pino.Logger;
}
interface DiagnosticWebSocketRuntimeMetrics {
    terminalDirectorySubscriptionCount: number;
    terminalSubscriptionCount: number;
    inflightRequests: number;
    peakInflightRequests: number;
    checkoutDiffTargetCount: number;
    checkoutDiffSubscriptionCount: number;
    checkoutDiffWatcherCount: number;
    checkoutDiffFallbackRefreshTargetCount: number;
}
interface DiagnosticAgentRuntimeMetrics {
    total: number;
    byLifecycle: Record<string, number>;
    withActiveForegroundTurn: number;
    timelineStats: {
        totalItems: number;
        maxItemsPerAgent: number;
    };
}
export type DaemonWebSocketRuntimeDiagnosticSnapshot = WebSocketRuntimeDiagnosticSnapshot<DiagnosticWebSocketRuntimeMetrics, DiagnosticAgentRuntimeMetrics>;
export declare function collectDaemonDiagnostics(options: DaemonDiagnosticsOptions): Promise<string>;
export declare function redactDiagnostic(value: string, options?: Partial<DaemonDiagnosticsOptions>): string;
export {};
//# sourceMappingURL=diagnostics.d.ts.map