import { getPidLockInfo } from "../../pid-lock.js";
import { generateLocalPairingOffer } from "../../pairing-offer.js";
import { collectDaemonDiagnostics, } from "./diagnostics.js";
import { DaemonSelfUpdateSessionController } from "./daemon-self-update-session-controller.js";
/**
 * A client's read surface for the daemon process itself: its runtime status
 * (pid-lock start time, listen address, relay config, provider availability) and
 * a fresh local pairing offer for connecting a new client. Owns the `daemon.*`
 * RPCs. Reaches no state beyond the never-mutated runtime values injected at
 * construction and the outbound channel.
 */
export class DaemonSession {
    constructor(options) {
        this.host = options.host;
        this.clientId = options.clientId;
        this.paseoHome = options.paseoHome;
        this.serverId = options.serverId;
        this.daemonVersion = options.daemonVersion;
        this.daemonRuntimeConfig = options.daemonRuntimeConfig;
        this.listAgents = options.listAgents;
        this.listProjects = options.listProjects;
        this.listWorkspaces = options.listWorkspaces;
        this.listProviderAvailability = options.listProviderAvailability;
        this.getWebSocketRuntimeMetrics = options.getWebSocketRuntimeMetrics ?? (() => null);
        this.getObservationMetrics = options.getObservationMetrics;
        this.logger = options.logger;
        this.hubRelationships = options.hubRelationships ?? null;
        this.reloadConfig = options.reloadConfig;
        this.selfUpdate = new DaemonSelfUpdateSessionController({
            clientId: this.clientId,
            daemonVersion: this.daemonVersion ?? null,
            desktopManaged: this.daemonRuntimeConfig?.desktopManaged === true,
            emit: (msg) => this.host.emit(msg),
            emitLifecycleIntent: (intent) => this.host.emitLifecycleIntent(intent),
            sessionLogger: this.logger,
        });
    }
    async handleHubRelationshipRequest(msg) {
        try {
            if (!this.hubRelationships)
                throw new Error("Hub relationship management is unavailable");
            if (msg.type === "hub.management.daemon.connect.request") {
                const status = await this.hubRelationships.connect({
                    hubUrl: msg.hubUrl,
                    token: msg.token,
                    permissions: msg.permissions,
                });
                this.host.emit({
                    type: "hub.management.daemon.connect.response",
                    payload: { requestId: msg.requestId, status },
                });
                return;
            }
            if (msg.type === "hub.management.daemon.permissions.update.request") {
                const status = await this.hubRelationships.updatePermissions({
                    grant: msg.grant,
                    revoke: msg.revoke,
                });
                this.host.emit({
                    type: "hub.management.daemon.permissions.update.response",
                    payload: { requestId: msg.requestId, status },
                });
                return;
            }
            if (msg.type === "hub.management.daemon.disconnect.request") {
                const result = await this.hubRelationships.disconnect({ force: msg.force ?? false });
                this.host.emit({
                    type: "hub.management.daemon.disconnect.response",
                    payload: { requestId: msg.requestId, ...result },
                });
                return;
            }
            this.host.emit({
                type: "hub.management.daemon.get_status.response",
                payload: { requestId: msg.requestId, status: this.hubRelationships.status() },
            });
        }
        catch (error) {
            this.logger.error({ err: error }, "Failed to handle Hub relationship request");
            this.host.emit({
                type: "rpc_error",
                payload: {
                    requestId: msg.requestId,
                    requestType: msg.type,
                    error: error instanceof Error ? error.message : String(error),
                    code: "handler_error",
                },
            });
        }
    }
    async handleGetStatusRequest(msg) {
        try {
            const pidInfo = await getPidLockInfo(this.paseoHome);
            const providers = (await this.listProviderAvailability()).map((p) => ({
                provider: p.provider,
                available: p.available,
                error: p.error ?? null,
            }));
            this.host.emit({
                type: "daemon.get_status.response",
                payload: {
                    requestId: msg.requestId,
                    serverId: this.serverId ?? "",
                    version: this.daemonVersion ?? null,
                    pid: process.pid,
                    nodePath: process.execPath,
                    startedAt: pidInfo?.startedAt ?? null,
                    listen: this.daemonRuntimeConfig?.listen ?? null,
                    relay: this.daemonRuntimeConfig?.getRelayConfig() ?? null,
                    providers,
                },
            });
        }
        catch (error) {
            this.logger.error({ err: error }, "Failed to handle daemon status request");
            this.host.emit({
                type: "daemon.get_status.response",
                payload: {
                    requestId: msg.requestId,
                    serverId: this.serverId ?? "",
                    version: this.daemonVersion ?? null,
                    pid: process.pid,
                    nodePath: process.execPath,
                    startedAt: null,
                    listen: null,
                    relay: null,
                    providers: [],
                },
            });
        }
    }
    async handleGetPairingOfferRequest(msg) {
        try {
            const relay = this.daemonRuntimeConfig?.getRelayConfig();
            const pairing = await generateLocalPairingOffer({
                paseoHome: this.paseoHome,
                relayEnabled: relay?.enabled ?? false,
                relayEndpoint: relay?.endpoint,
                relayPublicEndpoint: relay?.publicEndpoint,
                relayUseTls: relay?.useTls,
                relayPublicUseTls: relay?.publicUseTls,
                appBaseUrl: this.daemonRuntimeConfig?.appBaseUrl,
                includeQr: true,
                logger: this.logger,
            });
            this.host.emit({
                type: "daemon.get_pairing_offer.response",
                payload: {
                    requestId: msg.requestId,
                    url: pairing.url ?? "",
                    qr: pairing.qr ?? null,
                    relayEnabled: pairing.relayEnabled,
                },
            });
        }
        catch (error) {
            this.logger.error({ err: error }, "Failed to handle daemon pairing offer request");
            this.host.emit({
                type: "rpc_error",
                payload: {
                    requestId: msg.requestId,
                    requestType: "daemon.get_pairing_offer.request",
                    error: error instanceof Error ? error.message : String(error),
                },
            });
        }
    }
    handleConfigReloadRequest(msg) {
        try {
            this.host.emit({
                type: "daemon.config.reload.response",
                payload: { requestId: msg.requestId, ...this.reloadConfig() },
            });
        }
        catch (error) {
            this.logger.error({ err: error }, "Failed to reload daemon config");
            this.host.emit({
                type: "rpc_error",
                payload: {
                    requestId: msg.requestId,
                    requestType: msg.type,
                    error: error instanceof Error ? error.message : String(error),
                    code: "handler_error",
                },
            });
        }
    }
    async handleDiagnosticsRequest(msg) {
        try {
            const diagnostic = await collectDaemonDiagnostics({
                paseoHome: this.paseoHome,
                serverId: this.serverId,
                daemonVersion: this.daemonVersion,
                daemonRuntimeConfig: this.daemonRuntimeConfig,
                listAgents: this.listAgents,
                listProjects: this.listProjects,
                listWorkspaces: this.listWorkspaces,
                listProviderAvailability: this.listProviderAvailability,
                getWebSocketRuntimeMetrics: this.getWebSocketRuntimeMetrics,
                getObservationMetrics: this.getObservationMetrics,
                logger: this.logger,
            });
            this.host.emit({
                type: "diagnostics.response",
                payload: {
                    requestId: msg.requestId,
                    diagnostic,
                },
            });
        }
        catch (error) {
            this.logger.error({ err: error }, "Failed to handle diagnostics request");
            this.host.emit({
                type: "diagnostics.response",
                payload: {
                    requestId: msg.requestId,
                    diagnostic: `Paseo diagnostics\n  Error: ${error instanceof Error ? error.message : String(error)}`,
                },
            });
        }
    }
    async handleUpdateRequest(msg) {
        await this.selfUpdate.dispatch(msg);
    }
}
//# sourceMappingURL=daemon-session.js.map