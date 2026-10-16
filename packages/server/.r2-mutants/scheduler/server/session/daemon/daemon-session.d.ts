import type pino from "pino";
import type { ProviderAvailability } from "../../agent/agent-manager.js";
import type { SessionInboundMessage, SessionOutboundMessage } from "../../messages.js";
import { type DaemonWebSocketRuntimeDiagnosticSnapshot } from "./diagnostics.js";
import type { ManagedAgent } from "../../agent/agent-manager.js";
import type { PersistedProjectRecord, PersistedWorkspaceRecord } from "../../workspace-registry.js";
import type { HubRelationshipManagement } from "../../hub/relationship-controller.js";
import type { DaemonConfigReloadResult } from "../../daemon-config-store.js";
export interface DaemonRuntimeConfig {
    listen: string | null;
    worktreesRoot?: string;
    appBaseUrl?: string;
    desktopManaged?: boolean;
    getRelayConfig(): {
        enabled: boolean;
        endpoint: string;
        publicEndpoint: string;
        useTls: boolean;
        publicUseTls: boolean;
    } | null;
}
export interface DaemonSessionHost {
    emit(msg: SessionOutboundMessage): void;
    emitLifecycleIntent(intent: {
        type: "restart";
        clientId: string;
        requestId: string;
        reason: string;
    }): void;
}
export interface DaemonSessionOptions {
    host: DaemonSessionHost;
    clientId: string;
    paseoHome: string;
    serverId: string | undefined;
    daemonVersion: string | undefined;
    daemonRuntimeConfig: DaemonRuntimeConfig | undefined;
    listAgents: () => ManagedAgent[];
    listProjects: () => Promise<PersistedProjectRecord[]>;
    listWorkspaces: () => Promise<PersistedWorkspaceRecord[]>;
    listProviderAvailability: () => Promise<ProviderAvailability[]>;
    getWebSocketRuntimeMetrics?: () => DaemonWebSocketRuntimeDiagnosticSnapshot | null;
    getObservationMetrics?: () => Record<string, number>;
    logger: pino.Logger;
    hubRelationships?: HubRelationshipManagement;
    reloadConfig: () => DaemonConfigReloadResult;
}
/**
 * A client's read surface for the daemon process itself: its runtime status
 * (pid-lock start time, listen address, relay config, provider availability) and
 * a fresh local pairing offer for connecting a new client. Owns the `daemon.*`
 * RPCs. Reaches no state beyond the never-mutated runtime values injected at
 * construction and the outbound channel.
 */
export declare class DaemonSession {
    private readonly host;
    private readonly clientId;
    private readonly paseoHome;
    private readonly serverId;
    private readonly daemonVersion;
    private readonly daemonRuntimeConfig;
    private readonly listAgents;
    private readonly listProjects;
    private readonly listWorkspaces;
    private readonly listProviderAvailability;
    private readonly getWebSocketRuntimeMetrics;
    private readonly getObservationMetrics;
    private readonly logger;
    private readonly selfUpdate;
    private readonly hubRelationships;
    private readonly reloadConfig;
    constructor(options: DaemonSessionOptions);
    handleHubRelationshipRequest(msg: Extract<SessionInboundMessage, {
        type: "hub.management.daemon.connect.request" | "hub.management.daemon.get_status.request" | "hub.management.daemon.disconnect.request" | "hub.management.daemon.permissions.update.request";
    }>): Promise<void>;
    handleGetStatusRequest(msg: Extract<SessionInboundMessage, {
        type: "daemon.get_status.request";
    }>): Promise<void>;
    handleGetPairingOfferRequest(msg: Extract<SessionInboundMessage, {
        type: "daemon.get_pairing_offer.request";
    }>): Promise<void>;
    handleConfigReloadRequest(msg: Extract<SessionInboundMessage, {
        type: "daemon.config.reload.request";
    }>): void;
    handleDiagnosticsRequest(msg: Extract<SessionInboundMessage, {
        type: "diagnostics.request";
    }>): Promise<void>;
    handleUpdateRequest(msg: Extract<SessionInboundMessage, {
        type: "daemon.update.request";
    }>): Promise<void>;
}
//# sourceMappingURL=daemon-session.d.ts.map