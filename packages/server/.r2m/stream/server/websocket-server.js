import { stat } from "node:fs/promises";
import { CreationService } from "./creation/index.js";
import { MessageReceipts } from "./message-receipts/index.js";
import { WebSocketServer } from "ws";
import { join } from "path";
import { getHostName } from "./host-name.js";
import { randomUUID } from "node:crypto";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { LoopHealthMonitor } from "./loop-health.js";
import { WSInboundMessageSchema, wrapSessionMessage, } from "./messages.js";
import { asUint8Array, decodeBinaryFrame } from "@getpaseo/protocol/binary-frames/index";
import { isHostnameAllowed } from "./hostnames.js";
import { Session, } from "./session.js";
import { WorkspaceSetupRuntime } from "./workspace-setup-runtime.js";
import { attachMutableProviderConfigOwner } from "./agent/mutable-provider-config-owner.js";
import { snapshotGitCommandRuntimeMetrics } from "../utils/run-git-command.js";
import { createPluginClientId, isPluginClientId } from "./plugins/plugin-session-identity.js";
import { deriveProjectSlug } from "./workspace-git-metadata.js";
import { createPushNotifications, } from "./push/index.js";
import { computeNotificationPlan, isPushEligibleAttentionReason, } from "./agent-attention-policy.js";
import { buildAgentAttentionNotificationPayload, findLatestPermissionRequest, } from "@getpaseo/protocol/agent-attention-notification";
import { createGitHubService } from "../services/github-service.js";
import { extractHttpBearerToken, extractWsBearerProtocol, extractWsBearerToken, isBearerTokenValidAsync, } from "./auth.js";
import { resolveSessionAdmission } from "./session-admission-auth.js";
import { WebSocketRuntimeMetricsWindow, } from "./websocket/runtime-metrics.js";
import { getProcessMemoryDiagnostics, getProcessUptimeSeconds } from "./process-diagnostics.js";
import { CLIENT_SHUTDOWN_RPC_REASON, normalizeClientRestartRpcReason, } from "./lifecycle-reasons.js";
import { CLIENT_CAPS } from "@getpaseo/protocol/client-capabilities";
import { DirectorySyncService } from "./directory-sync/index.js";
import { OWNER_PERMISSIONS } from "./authorization/index.js";
import { APPLICATION_SOCKET_LEASE_CHECK_INTERVAL_MS, ApplicationSocketLease, MAX_PHYSICAL_SOCKET_BUFFERED_BYTES, outboundFrameByteLength, physicalSocketHasCapacity, sendBoundedPhysicalFrame, sendBoundedPhysicalFrameAndWait, } from "./websocket/physical-socket.js";
const WS_CLOSE_DAEMON_AUTH_FAILED = 4401;
function resolveTerminalAttentionReason(input) {
    if (input.attentionReason === "finished")
        return "finished";
    if (input.attentionReason === "needs_input")
        return "needs_input";
    if (input.state === "attention")
        return "needs_input";
    if (input.previousState === "working" && input.state === "idle")
        return "finished";
    return null;
}
function terminalAttentionTitle(reason) {
    return reason === "needs_input" ? "Terminal needs input" : "Terminal finished";
}
function createFallbackWorkspaceGitSnapshot(cwd) {
    return {
        cwd,
        git: {
            isGit: false,
            repoRoot: null,
            mainRepoRoot: null,
            currentBranch: null,
            remoteUrl: null,
            isPaseoOwnedWorktree: false,
            isDirty: null,
            baseRef: null,
            aheadBehind: null,
            upstreamRef: null,
            aheadOfOrigin: null,
            behindOfOrigin: null,
            hasRemote: false,
            diffStat: null,
        },
        forge: {
            featuresEnabled: false,
            authState: "no_remote",
            pullRequest: null,
            error: null,
        },
    };
}
function createFallbackWorkspaceGitService() {
    return {
        registerWorkspace: () => ({
            unsubscribe: () => { },
        }),
        onSnapshotUpdated: () => ({
            unsubscribe: () => { },
        }),
        peekSnapshot: () => null,
        peekCachedCheckout: () => null,
        getCheckout: async (cwd) => ({
            cwd,
            isGit: false,
            currentBranch: null,
            remoteUrl: null,
            worktreeRoot: null,
            isPaseoOwnedWorktree: false,
            mainRepoRoot: null,
        }),
        getSnapshot: async (cwd) => createFallbackWorkspaceGitSnapshot(cwd),
        resolveForge: async () => null,
        getCheckoutDiff: async () => ({ diff: "" }),
        validateBranchRef: async () => ({ kind: "not-found" }),
        hasLocalBranch: async () => false,
        suggestBranchesForCwd: async () => [],
        listStashes: async () => [],
        listWorktrees: async () => [],
        getProjectSlug: async (cwd) => {
            const snapshot = createFallbackWorkspaceGitSnapshot(cwd);
            return deriveProjectSlug(cwd, snapshot.git.isGit ? snapshot.git.remoteUrl : null);
        },
        resolveRepoRoot: async (cwd) => cwd,
        resolveDefaultBranch: async () => "main",
        resolveRepoRemoteUrl: async () => null,
        refresh: async () => { },
        requestWorkingTreeWatch: async () => ({
            repoRoot: null,
            unsubscribe: () => { },
        }),
        scheduleRefreshForCwd: () => { },
        onWorkspaceStateMayHaveChanged: () => { },
        invalidateForge: () => { },
        getMetrics: () => ({
            workspaceTargetCount: 0,
            workspaceListenerCount: 0,
            repositoryTargetCount: 0,
            repositoryWorkspaceLinkCount: 0,
            workingTreeWatchTargetCount: 0,
            workingTreeWatchListenerCount: 0,
            workspaceObservationSetupInFlightCount: 0,
            workingTreeWatchSetupInFlightCount: 0,
            workspaceRefreshInFlightCount: 0,
            workspaceRefreshQueuedCount: 0,
            workspaceRefreshAdmissionActiveCount: 0,
            workspaceRefreshAdmissionPendingCount: 0,
            workspaceObservationSetupAdmissionActiveCount: 0,
            workspaceObservationSetupAdmissionPendingCount: 0,
            fetchInFlightCount: 0,
            snapshotUpdatedListenerCount: 0,
            watcherErrorCallbackCount: 0,
            fileObserver: {
                activeObservationCount: 0,
                nativeHandleCount: 0,
                nativeTrackedFileCount: 0,
                pendingEventCount: 0,
                pendingReconciliationWorkCount: 0,
                pendingClassificationCount: 0,
                reconciliationInFlightCount: 0,
                reconciliationCount: 0,
                scopedReconciliationCount: 0,
                fullReconciliationCount: 0,
                reconciliationFailureCount: 0,
                observerFailureCount: 0,
                directoryLimitFailureCount: 0,
                nativeEventCount: 0,
                nativeChangeEventCount: 0,
                nativeRenameEventCount: 0,
                nativePathlessEventCount: 0,
                nativeClassificationCount: 0,
                nativeShallowScanCount: 0,
                lastReconciliationDurationMs: 0,
                maxReconciliationDurationMs: 0,
            },
        }),
        dispose: async () => { },
    };
}
function createNoopProjectRegistry() {
    return {
        initialize: async () => { },
        existsOnDisk: async () => true,
        list: async () => [],
        get: async () => null,
        getOrCreateActiveByRoot: async (input) => ({
            projectId: "prj_noop",
            rootPath: input.rootPath,
            kind: input.kind,
            displayName: input.displayName,
            projectKey: input.projectKey ?? null,
            customName: null,
            customIconRevision: null,
            createdAt: input.timestamp,
            updatedAt: input.timestamp,
            archivedAt: null,
        }),
        upsert: async () => { },
        update: async () => null,
        archive: async () => { },
        remove: async () => { },
    };
}
function createNoopWorkspaceRegistry() {
    return {
        initialize: async () => { },
        existsOnDisk: async () => true,
        list: async () => [],
        get: async () => null,
        update: async () => null,
        upsert: async () => { },
        archive: async () => { },
        remove: async () => { },
    };
}
function toServerCapabilityState(params) {
    const { state, reason } = params;
    return {
        enabled: state.enabled,
        reason,
    };
}
function resolveCapabilityReason(params) {
    const { state, readiness } = params;
    if (state.available) {
        return "";
    }
    if (readiness.voiceFeature.reasonCode === "model_download_in_progress") {
        const baseMessage = readiness.voiceFeature.message.trim();
        if (baseMessage.includes("Try again in a few minutes")) {
            return baseMessage;
        }
        return `${baseMessage} Try again in a few minutes.`;
    }
    return state.message;
}
function buildServerCapabilities(params) {
    const readiness = params.readiness;
    if (!readiness) {
        return undefined;
    }
    return {
        voice: {
            dictation: toServerCapabilityState({
                state: readiness.dictation,
                reason: resolveCapabilityReason({
                    state: readiness.dictation,
                    readiness,
                }),
            }),
            voice: toServerCapabilityState({
                state: readiness.realtimeVoice,
                reason: resolveCapabilityReason({
                    state: readiness.realtimeVoice,
                    readiness,
                }),
            }),
        },
    };
}
function areServerCapabilitiesEqual(current, next) {
    return JSON.stringify(current ?? null) === JSON.stringify(next ?? null);
}
function bufferFromWsData(data) {
    if (typeof data === "string")
        return Buffer.from(data, "utf8");
    if (Array.isArray(data)) {
        return Buffer.concat(data.map((item) => (Buffer.isBuffer(item) ? item : Buffer.from(item))));
    }
    if (Buffer.isBuffer(data))
        return data;
    return Buffer.from(data);
}
const SLOW_REQUEST_THRESHOLD_MS = 500;
const EXTERNAL_SESSION_DISCONNECT_GRACE_MS = 90000;
const HELLO_TIMEOUT_MS = 15000;
const WS_CLOSE_HELLO_TIMEOUT = 4001;
const WS_CLOSE_INVALID_HELLO = 4002;
const WS_CLOSE_INCOMPATIBLE_PROTOCOL = 4003;
const WS_CLOSE_SERVER_SHUTDOWN = 1001;
const WS_PROTOCOL_VERSION = 1;
const WS_RUNTIME_METRICS_FLUSH_MS = 30000;
const OWNER_SESSION_ADMISSION = {
    principalId: "owner",
    permissions: OWNER_PERMISSIONS,
};
export class MissingDaemonVersionError extends Error {
    constructor() {
        super("VoiceAssistantWebSocketServer requires a non-empty daemonVersion.");
        this.name = "MissingDaemonVersionError";
    }
}
function requireWebSocketServices(params) {
    const { scheduleService, checkoutDiffManager } = params;
    if (!scheduleService) {
        throw new Error("VoiceAssistantWebSocketServer requires a schedule service.");
    }
    if (!checkoutDiffManager) {
        throw new Error("VoiceAssistantWebSocketServer requires a checkout diff manager.");
    }
    return { scheduleService, checkoutDiffManager };
}
/**
 * WebSocket server that only accepts sockets + parses/forwards messages to the session layer.
 */
export class VoiceAssistantWebSocketServer {
    async validateCompletedCreation(snapshot) {
        if (snapshot.workspace && snapshot.kind === "workspace") {
            const workspace = await this.workspaceRegistry.get(snapshot.workspace.id);
            if (!workspace)
                throw new Error("Previously created workspace no longer exists");
            const directory = await stat(workspace.cwd).catch(() => null);
            if (!directory?.isDirectory())
                throw Object.assign(new Error(`Directory not found: ${workspace.cwd}`), {
                    code: "directory_not_found",
                });
        }
        if (snapshot.agentId &&
            !this.agentManager.getAgent(snapshot.agentId) &&
            !(await this.agentStorage.get(snapshot.agentId))) {
            throw new Error("Previously created agent no longer exists");
        }
    }
    constructor(server, logger, serverId, agentManager, agentStorage, downloadTokenStore, paseoHome, daemonConfigStore, mcpBaseUrl, wsConfig, workspaceAutoName, auth, speech, terminalManager, dictation, daemonVersion, onLifecycleIntent, projectRegistry, workspaceRegistry, scheduleService, checkoutDiffManager, serviceProxy, scriptRuntimeStore, onBranchChanged, getDaemonTcpPort, getDaemonTcpHost, resolveScriptHealth, workspaceGitService, github, pushNotificationSender, providerSnapshotManager, daemonRuntimeConfig, serviceProxyPublicBaseUrl, browserToolsBroker, hubRelationships, workspaceSetupRuntime = new WorkspaceSetupRuntime(), pluginRuntime, orchestrationSkills, workspaceLabelService) {
        this.pendingConnections = new Map();
        this.sessions = new Map();
        this.socketIdentities = new Map();
        this.externalSessionsByKey = new Map();
        this.pluginSocketIds = new WeakMap();
        this.pluginSocketCleanup = new WeakMap();
        this.voiceSpeakHandlers = new Map();
        this.voiceCallerContexts = new Map();
        this.workspaceSetupSnapshots = new Map();
        this.runtimeMetrics = new WebSocketRuntimeMetricsWindow();
        this.lastRuntimeMetricsSnapshot = null;
        this.runtimeMetricsInterval = null;
        this.applicationSocketLeaseInterval = null;
        this.applicationSocketLease = new ApplicationSocketLease();
        this.eventLoopDelayMonitor = null;
        this.loopHealthMonitor = null;
        this.unsubscribeSpeechReadiness = null;
        this.unsubscribeDaemonConfigChange = null;
        this.unsubscribeTerminalActivity = null;
        this.connectionLifecycle = "accepting";
        this.directorySync = new DirectorySyncService();
        this.logger = logger.child({ module: "websocket-server" });
        this.workspaceSetupRuntime = workspaceSetupRuntime;
        this.advertiseDaemonStatusRpc = wsConfig.daemonStatusRpc !== false;
        this.advertiseRelayConfig = wsConfig.relayConfig !== false;
        this.connectionLifecycle = wsConfig.startPaused === true ? "starting" : "accepting";
        this.serverId = serverId;
        if (typeof daemonVersion !== "string" || daemonVersion.trim().length === 0) {
            throw new MissingDaemonVersionError();
        }
        this.daemonVersion = daemonVersion.trim();
        this.credentialSource = auth;
        this.daemonRuntimeConfig = daemonRuntimeConfig;
        this.browserToolsBroker = browserToolsBroker ?? null;
        this.hubRelationships = hubRelationships ?? null;
        this.pluginRuntime = pluginRuntime;
        this.orchestrationSkills = orchestrationSkills;
        this.agentManager = agentManager;
        this.agentStorage = agentStorage;
        this.messageReceipts = new MessageReceipts(join(paseoHome, "agent-requests"));
        this.creationService = new CreationService(join(paseoHome, "creations"), this.logger.child({ module: "creation" }), (snapshot) => this.validateCompletedCreation(snapshot), join(paseoHome, "agent-requests"));
        this.projectRegistry = projectRegistry ?? createNoopProjectRegistry();
        this.workspaceRegistry = workspaceRegistry ?? createNoopWorkspaceRegistry();
        this.workspaceLabelService = workspaceLabelService ?? null;
        const requiredServices = requireWebSocketServices({
            scheduleService,
            checkoutDiffManager,
        });
        this.scheduleService = requiredServices.scheduleService;
        this.checkoutDiffManager = requiredServices.checkoutDiffManager;
        this.github = github ?? createGitHubService();
        this.workspaceGitService = workspaceGitService ?? createFallbackWorkspaceGitService();
        this.workspaceAutoName = workspaceAutoName;
        this.downloadTokenStore = downloadTokenStore;
        this.paseoHome = paseoHome;
        this.passwordHash = auth?.password;
        this.worktreesRoot = daemonRuntimeConfig?.worktreesRoot;
        this.daemonConfigStore = daemonConfigStore;
        this.mcpBaseUrl = mcpBaseUrl;
        this.assignOptionalServices({
            speech,
            terminalManager,
            dictation,
            onLifecycleIntent,
            serviceProxy,
            scriptRuntimeStore,
            onBranchChanged,
            getDaemonTcpPort,
            getDaemonTcpHost,
            serviceProxyPublicBaseUrl,
            resolveScriptHealth,
        });
        if (!providerSnapshotManager) {
            throw new Error("providerSnapshotManager is required");
        }
        this.providerSnapshotManager = providerSnapshotManager;
        this.serverCapabilities = buildServerCapabilities({
            readiness: this.speech?.getReadiness() ?? null,
        });
        this.unsubscribeSpeechReadiness =
            this.speech?.onReadinessChange((snapshot) => {
                this.publishSpeechReadiness(snapshot);
            }) ?? null;
        const unsubscribeProviderConfig = attachMutableProviderConfigOwner({
            store: this.daemonConfigStore,
            providerSnapshotManager: this.providerSnapshotManager,
            updateProviderRegistry: (state) => this.agentManager.updateProviderRegistry(state),
        });
        const unsubscribeChange = this.daemonConfigStore.onChange((config) => {
            this.broadcastDaemonConfigChanged(config);
        });
        this.unsubscribeDaemonConfigChange = () => {
            unsubscribeProviderConfig();
            unsubscribeChange();
        };
        const pushLogger = this.logger.child({ module: "push" });
        this.pushNotifications = createPushNotifications({
            logger: pushLogger,
            filePath: join(paseoHome, "push-tokens.json"),
        });
        this.pushNotificationSender = pushNotificationSender ?? this.pushNotifications;
        this.agentManager.setAgentAttentionCallback((params) => {
            void this.broadcastAgentAttention(params).catch((err) => {
                this.logger.warn({ err, agentId: params.agentId }, "Failed to broadcast agent attention");
            });
        });
        this.wss = this.createWebSocketServer(server, wsConfig, auth);
        this.startRuntimeMetricsInterval();
        this.startApplicationSocketLeaseInterval();
        this.logger.info("WebSocket server initialized on /ws");
    }
    assignOptionalServices(params) {
        this.speech = params.speech ?? null;
        this.terminalManager = params.terminalManager ?? null;
        if (this.terminalManager) {
            this.unsubscribeTerminalActivity = this.terminalManager.subscribeTerminalActivity((event) => {
                const reason = resolveTerminalAttentionReason({
                    attentionReason: event.activity?.attentionReason,
                    previousState: event.previous?.state ?? null,
                    state: event.activity?.state ?? null,
                });
                if (!reason) {
                    return;
                }
                void this.broadcastTerminalAttention({
                    terminalId: event.terminalId,
                    cwd: event.cwd,
                    ...(event.workspaceId ? { workspaceId: event.workspaceId } : {}),
                    terminalName: event.name,
                    reason,
                }).catch((err) => {
                    this.logger.warn({ err, terminalId: event.terminalId }, "Failed to broadcast terminal attention");
                });
            });
        }
        this.dictation = params.dictation ?? null;
        this.onLifecycleIntent = params.onLifecycleIntent ?? null;
        this.serviceProxy = params.serviceProxy ?? null;
        this.scriptRuntimeStore = params.scriptRuntimeStore ?? null;
        this.onBranchChanged = params.onBranchChanged ?? null;
        this.getDaemonTcpPort = params.getDaemonTcpPort ?? null;
        this.getDaemonTcpHost = params.getDaemonTcpHost ?? null;
        this.serviceProxyPublicBaseUrl = params.serviceProxyPublicBaseUrl ?? null;
        this.resolveScriptHealth = params.resolveScriptHealth ?? null;
    }
    createWebSocketServer(server, wsConfig, auth) {
        const password = auth?.password;
        const wss = new WebSocketServer({
            server,
            path: "/ws",
            handleProtocols: (protocols) => selectWebSocketProtocol(protocols, password),
            verifyClient: ({ req }, callback) => {
                this.verifyWsUpgrade(req, wsConfig.getAllowedOrigins?.() ?? wsConfig.allowedOrigins ?? new Set(), wsConfig.getHostnames?.() ?? wsConfig.hostnames, callback);
            },
        });
        wss.on("connection", (ws, request) => {
            void this.attachAuthenticatedSocket(ws, request, password);
        });
        return wss;
    }
    startRuntimeMetricsInterval() {
        this.eventLoopDelayMonitor = monitorEventLoopDelay({ resolution: 10 });
        this.eventLoopDelayMonitor.enable();
        this.loopHealthMonitor = new LoopHealthMonitor();
        this.loopHealthMonitor.start();
        const runtimeMetricsInterval = setInterval(() => {
            this.flushRuntimeMetrics();
        }, WS_RUNTIME_METRICS_FLUSH_MS);
        this.runtimeMetricsInterval = runtimeMetricsInterval;
        runtimeMetricsInterval.unref?.();
    }
    startApplicationSocketLeaseInterval() {
        const interval = setInterval(() => {
            for (const ws of this.applicationSocketLease.listExpired()) {
                this.closePhysicalSocket({
                    ws,
                    logMessage: "Closing physical WebSocket with expired application lease",
                });
            }
        }, APPLICATION_SOCKET_LEASE_CHECK_INTERVAL_MS);
        this.applicationSocketLeaseInterval = interval;
        interval.unref?.();
    }
    // Main-loop stall visibility: terminal frames and agent traffic share one event
    // loop, so delay percentiles here are the ground truth for "the daemon is busy".
    snapshotEventLoopDelay() {
        const monitor = this.eventLoopDelayMonitor;
        if (!monitor) {
            return null;
        }
        const toMs = (nanoseconds) => Math.round(nanoseconds / 1e5) / 10;
        const snapshot = {
            p50Ms: toMs(monitor.percentile(50)),
            p99Ms: toMs(monitor.percentile(99)),
            maxMs: toMs(monitor.max),
        };
        monitor.reset();
        return snapshot;
    }
    // The loop-blocker series the poll-phase gauge cannot see: true timer
    // lateness under microtask pressure, the collector's pause series, and the
    // native handle count.
    snapshotLoopHealth() {
        return this.loopHealthMonitor?.snapshot() ?? null;
    }
    verifyWsUpgrade(req, allowedOrigins, hostnames, callback) {
        if (this.connectionLifecycle !== "accepting") {
            callback(false, 503, "Server not ready");
            return;
        }
        const requestMetadata = extractSocketRequestMetadata(req);
        const origin = requestMetadata.origin;
        const requestHost = requestMetadata.host ?? null;
        if (requestHost && !isHostnameAllowed(requestHost, hostnames)) {
            this.incrementRuntimeCounter("hostRejected");
            this.logger.warn({ ...requestMetadata, host: requestHost }, "Rejected connection from disallowed host");
            callback(false, 403, "Host not allowed");
            return;
        }
        const sameOrigin = isWebSocketSameOrigin(origin, requestHost);
        if (!origin || allowedOrigins.has("*") || allowedOrigins.has(origin) || sameOrigin) {
            callback(true);
        }
        else {
            this.incrementRuntimeCounter("originRejected");
            this.logger.warn({ ...requestMetadata, origin }, "Rejected connection from origin");
            callback(false, 403, "Origin not allowed");
        }
    }
    async attachAuthenticatedSocket(ws, request, password) {
        // Header validation is asynchronous. Buffer frames until the socket has a
        // pending hello handler so an eager client cannot lose its first message.
        ws.pause();
        try {
            // COMPAT(headerAuth): added in v0.9.1, remove after 2027-03-24.
            const protocol = extractWsBearerProtocol(request.headers["sec-websocket-protocol"]);
            const token = extractHttpBearerToken(request.headers.authorization) ?? extractWsBearerToken(protocol);
            const hasHeaderCredential = token !== null;
            if (password && hasHeaderCredential) {
                const requestMetadata = extractSocketRequestMetadata(request);
                const isAuthorized = await isBearerTokenValidAsync({ password, token });
                if (!isAuthorized) {
                    const reason = "Incorrect password";
                    this.logger.warn({ ...requestMetadata, hasToken: true }, "Rejected WebSocket connection with invalid daemon password");
                    ws.close(WS_CLOSE_DAEMON_AUTH_FAILED, reason);
                    return;
                }
            }
            await this.attachSocket(ws, request, undefined, false, hasHeaderCredential ? OWNER_SESSION_ADMISSION : null);
        }
        finally {
            ws.resume();
        }
    }
    broadcast(message) {
        if (message.type === "session") {
            for (const connection of new Set(this.sessions.values())) {
                connection.session.publish(message.message);
            }
            return;
        }
        this.sendMessageToSockets(this.sessions.keys(), message);
    }
    listSessions() {
        return Array.from(new Set([...this.sessions.values(), ...this.externalSessionsByKey.values()].map((connection) => connection.session)));
    }
    publishProjectUpdate(update) {
        for (const session of this.listSessions()) {
            void session
                .emitProjectUpdate(update)
                .catch((error) => this.logger.warn({ err: error }, "Failed to publish project update"));
        }
    }
    publishScriptStatusUpdate(message) {
        for (const session of this.listSessions()) {
            session.emitServerMessage(message);
        }
    }
    publishSpeechReadiness(readiness) {
        this.updateServerCapabilities(buildServerCapabilities({ readiness }));
    }
    updateServerCapabilities(capabilities) {
        const next = capabilities ?? undefined;
        if (areServerCapabilitiesEqual(this.serverCapabilities, next)) {
            return;
        }
        this.serverCapabilities = next;
        this.broadcastCapabilitiesUpdate();
    }
    async attachExternalSocket(ws, metadata, admission = null, initialHello) {
        if (metadata?.transport === "relay") {
            this.incrementRuntimeCounter("relayExternalSocketAttached");
        }
        await this.attachSocket(ws, undefined, metadata, false, admission, initialHello);
    }
    async attachPluginSocket(pluginId, ws) {
        if (this.connectionLifecycle === "stopping") {
            throw new Error(`Cannot attach plugin session while shutting down: ${pluginId}`);
        }
        let resolve = () => undefined;
        const closed = new Promise((finish) => {
            resolve = finish;
        });
        this.pluginSocketIds.set(ws, pluginId);
        this.pluginSocketCleanup.set(ws, resolve);
        try {
            await this.attachSocket(ws, undefined, undefined, true, OWNER_SESSION_ADMISSION);
        }
        catch (error) {
            this.pluginSocketIds.delete(ws);
            this.finishPluginSocketCleanup(ws);
            throw error;
        }
        return { closed };
    }
    updatePrincipalPermissions(principalId, permissions) {
        for (const pending of this.pendingConnections.values()) {
            if (pending.admission?.principalId === principalId) {
                pending.admission = { ...pending.admission, permissions };
            }
        }
        for (const connection of new Set(this.externalSessionsByKey.values())) {
            if (connection.principalId === principalId) {
                connection.session.setPermissions(permissions);
            }
        }
    }
    prepareForShutdown() {
        this.connectionLifecycle = "stopping";
    }
    beginAcceptingConnections() {
        if (this.connectionLifecycle === "starting") {
            this.connectionLifecycle = "accepting";
        }
    }
    async close() {
        this.prepareForShutdown();
        this.unsubscribeSpeechReadiness?.();
        this.unsubscribeSpeechReadiness = null;
        this.unsubscribeDaemonConfigChange?.();
        this.unsubscribeDaemonConfigChange = null;
        this.unsubscribeTerminalActivity?.();
        this.unsubscribeTerminalActivity = null;
        if (this.runtimeMetricsInterval) {
            clearInterval(this.runtimeMetricsInterval);
            this.runtimeMetricsInterval = null;
        }
        if (this.applicationSocketLeaseInterval) {
            clearInterval(this.applicationSocketLeaseInterval);
            this.applicationSocketLeaseInterval = null;
        }
        this.applicationSocketLease.clear();
        this.flushRuntimeMetrics({ final: true });
        this.eventLoopDelayMonitor?.disable();
        this.eventLoopDelayMonitor = null;
        this.loopHealthMonitor?.stop();
        this.loopHealthMonitor = null;
        const uniqueConnections = new Set([
            ...this.sessions.values(),
            ...this.externalSessionsByKey.values(),
        ]);
        const pendingSockets = new Set(this.pendingConnections.keys());
        for (const pending of this.pendingConnections.values()) {
            if (pending.helloTimeout) {
                clearTimeout(pending.helloTimeout);
                pending.helloTimeout = null;
            }
        }
        const cleanupPromises = [];
        for (const connection of uniqueConnections) {
            if (connection.lifecycle === "reconnectable" && connection.externalDisconnectCleanupTimeout) {
                clearTimeout(connection.externalDisconnectCleanupTimeout);
                connection.externalDisconnectCleanupTimeout = null;
            }
            cleanupPromises.push(Promise.resolve(connection.session.cleanup()));
            for (const ws of connection.sockets) {
                cleanupPromises.push(new Promise((resolve) => {
                    // WebSocket.CLOSED = 3
                    if (ws.readyState === 3) {
                        resolve();
                        return;
                    }
                    ws.once("close", () => resolve());
                    ws.close();
                }));
            }
        }
        for (const ws of pendingSockets) {
            cleanupPromises.push(new Promise((resolve) => {
                if (ws.readyState === 3) {
                    resolve();
                    return;
                }
                ws.once("close", () => resolve());
                ws.close();
            }));
        }
        await Promise.all(cleanupPromises);
        this.providerSnapshotManager.destroy();
        this.checkoutDiffManager.dispose();
        await this.workspaceGitService.dispose();
        this.pendingConnections.clear();
        this.sessions.clear();
        this.socketIdentities.clear();
        this.externalSessionsByKey.clear();
        this.wss.close();
    }
    sendToClient(ws, message) {
        this.sendMessageToSockets([ws], message, true);
    }
    sendMessageToSockets(sockets, message, reportRejection = false) {
        const writableSockets = [...sockets].filter((ws) => {
            if (message.type === "session" &&
                this.sessions.get(ws)?.session.delivery.permits(ws, message.message) !== true) {
                this.incrementRuntimeCounter("applicationJsonRejected");
                // Legacy broadcasts intentionally exclude modern sockets. Targeted failures are bugs.
                if (reportRejection)
                    this.logger.warn({
                        messageType: message.message.type,
                        status: message.message.type === "status" ? message.message.payload.status : undefined,
                    }, "ws_application_delivery_denied");
                return false;
            }
            return this.ensureOutboundCapacity(ws, 0);
        });
        if (writableSockets.length === 0) {
            return;
        }
        let payload;
        try {
            payload = JSON.stringify(message);
        }
        catch (err) {
            this.logger.warn({ err }, "ws_serialize_failed");
            return;
        }
        const payloadBytes = outboundFrameByteLength(payload);
        for (const ws of writableSockets) {
            this.sendFrameToClient(ws, payload, payloadBytes, () => {
                this.runtimeMetrics.recordOutboundMessage(message, ws.bufferedAmount);
            });
        }
    }
    sendBinaryToClient(ws, frame, reportRejection = true) {
        if (!this.sessions.get(ws)?.session.delivery.permitsBinary(ws, frame)) {
            this.incrementRuntimeCounter("applicationBinaryRejected");
            if (reportRejection)
                this.logger.warn({ bytes: frame.byteLength }, "ws_application_binary_delivery_denied");
            return;
        }
        this.sendFrameToClient(ws, frame, outboundFrameByteLength(frame), () => {
            this.runtimeMetrics.recordOutboundBinaryFrame(ws.bufferedAmount);
        });
    }
    async sendBinaryToClientAndWait(ws, frame) {
        if (!this.sessions.get(ws)?.session.delivery.permitsBinary(ws, frame)) {
            this.incrementRuntimeCounter("applicationBinaryRejected");
            this.logger.warn({ bytes: frame.byteLength }, "ws_application_binary_delivery_denied");
            return;
        }
        try {
            const sent = await sendBoundedPhysicalFrameAndWait({
                socket: ws,
                frame,
                onHighWater: () => this.closeAtOutboundHighWater(ws),
            });
            if (!sent) {
                throw new Error("Physical WebSocket is not open");
            }
            this.runtimeMetrics.recordOutboundBinaryFrame(ws.bufferedAmount);
        }
        catch (err) {
            this.logger.warn({ err }, "ws_send_failed");
            throw err;
        }
    }
    sendFrameToClient(ws, frame, frameBytes, recordSent) {
        try {
            const sent = sendBoundedPhysicalFrame({
                socket: ws,
                frame,
                frameBytes,
                onHighWater: () => this.closeAtOutboundHighWater(ws),
            });
            if (sent)
                recordSent();
        }
        catch (err) {
            this.logger.warn({ err }, "ws_send_failed");
        }
    }
    ensureOutboundCapacity(ws, frameBytes) {
        if (ws.readyState !== 1)
            return false;
        if (physicalSocketHasCapacity(ws, frameBytes))
            return true;
        this.closeAtOutboundHighWater(ws);
        return false;
    }
    closeAtOutboundHighWater(ws) {
        this.closePhysicalSocket({
            ws,
            logMessage: "Closing physical WebSocket at outbound high-water mark",
            logFields: {
                bufferedAmount: ws.bufferedAmount,
                maxBufferedBytes: MAX_PHYSICAL_SOCKET_BUFFERED_BYTES,
            },
        });
    }
    closePhysicalSocket(params) {
        const { ws, logMessage, logFields } = params;
        this.applicationSocketLease.release(ws);
        if (ws.readyState !== 1) {
            return;
        }
        const identity = this.socketIdentities.get(ws);
        this.logger.warn({
            ...(identity ? toConnectionLogFields(identity) : {}),
            ...logFields,
        }, logMessage);
        try {
            // A close frame queues behind application data, so it cannot enforce a
            // hard memory cutoff. Production transports expose terminate().
            if (ws.terminate) {
                ws.terminate();
            }
            else {
                ws.close();
            }
        }
        catch (err) {
            this.logger.warn({ err, ...(identity ? toConnectionLogFields(identity) : {}) }, "ws_close_failed");
        }
    }
    sendToConnection(connection, message) {
        this.sendMessageToSockets(connection.sockets, message);
    }
    sendBinaryToConnection(connection, frame) {
        for (const ws of connection.sockets) {
            this.sendBinaryToClient(ws, frame, false);
        }
    }
    async attachSocket(ws, request, metadata, allowDuringStartup = false, admission = null, initialHello) {
        if (this.connectionLifecycle === "stopping" ||
            (this.connectionLifecycle === "starting" && !allowDuringStartup)) {
            try {
                ws.close(WS_CLOSE_SERVER_SHUTDOWN, "Server shutting down");
            }
            catch {
                // ignore close errors
            }
            return;
        }
        const requestMetadata = extractSocketRequestMetadata(request);
        const identity = createWebSocketConnectionIdentity(requestMetadata, metadata);
        this.socketIdentities.set(ws, identity);
        const connectionLogger = this.logger.child(toConnectionLogFields(identity));
        const pending = {
            connectionLogger,
            helloTimeout: null,
            identity,
            admission,
            authenticating: false,
        };
        const timeout = setTimeout(() => {
            if (this.pendingConnections.get(ws) !== pending) {
                return;
            }
            pending.helloTimeout = null;
            this.pendingConnections.delete(ws);
            pending.connectionLogger.warn({ ...toConnectionLogFields(identity), timeoutMs: HELLO_TIMEOUT_MS }, "Closing connection due to missing hello");
            try {
                ws.close(WS_CLOSE_HELLO_TIMEOUT, "Hello timeout");
            }
            catch {
                // ignore close errors
            }
        }, HELLO_TIMEOUT_MS);
        pending.helloTimeout = timeout;
        timeout.unref?.();
        this.pendingConnections.set(ws, pending);
        this.incrementRuntimeCounter("connectedAwaitingHello");
        this.bindSocketHandlers(ws);
        pending.connectionLogger.info({
            ...toConnectionLogFields(identity),
            totalPendingConnections: this.pendingConnections.size,
        }, "Client connected; awaiting hello");
        if (initialHello)
            await this.handleHelloSafely({ ws, message: initialHello, pending });
    }
    createSessionConnection(params) {
        const { ws, clientId, appVersion, clientCapabilities, connectionLogger, lifecycle, admission } = params;
        let connection = null;
        const session = this.createSocketSession({
            clientId,
            appVersion,
            clientCapabilities,
            permissions: admission.permissions,
            connectionLogger,
            onMessage: (msg) => {
                if (!connection) {
                    return;
                }
                this.sendToConnection(connection, wrapSessionMessage(msg));
            },
            onMessageToSource: (source, msg) => {
                if (!connection || !connection.sockets.has(source)) {
                    return;
                }
                this.sendToClient(source, wrapSessionMessage(msg));
            },
            onBinaryMessage: (frame) => {
                if (!connection) {
                    return;
                }
                this.sendBinaryToConnection(connection, frame);
            },
            onBinaryMessageToSource: async (source, frame) => {
                if (!connection || !connection.sockets.has(source)) {
                    throw new Error("File transfer source socket is no longer attached");
                }
                await this.sendBinaryToClientAndWait(source, frame);
            },
            getTransportBufferedAmount: (source) => {
                if (!connection) {
                    return null;
                }
                if (source)
                    return source.bufferedAmount ?? null;
                // Relay-attached sockets are a WebSocketLike that doesn't expose
                // bufferedAmount. Return null when no socket gives a signal so the
                // terminal fallback can't mistake "no signal" for "client keeping up";
                // a direct ws reports its real buffered bytes (0 when drained).
                let maxBuffered = null;
                for (const socket of connection.sockets) {
                    if (typeof socket.bufferedAmount === "number") {
                        maxBuffered = Math.max(maxBuffered ?? 0, socket.bufferedAmount);
                    }
                }
                return maxBuffered;
            },
            onLifecycleIntent: (intent) => {
                this.onLifecycleIntent?.(intent);
            },
            hubExecutionAgents: admission.hubExecutionAgents,
            hubRelationships: this.hubRelationships ?? undefined,
        });
        const base = {
            session,
            principalId: admission.principalId,
            sessionKey: sessionConnectionKey(admission.principalId, clientId),
            clientId,
            appVersion,
            clientCapabilities,
            connectionLogger,
            sockets: new Set([ws]),
        };
        connection =
            lifecycle.kind === "ephemeral-plugin"
                ? { ...base, lifecycle: "ephemeral-plugin", pluginId: lifecycle.pluginId }
                : { ...base, lifecycle: "reconnectable", externalDisconnectCleanupTimeout: null };
        session.updateClientCapabilities(clientCapabilities, ws, appVersion);
        return connection;
    }
    createSocketSession(options) {
        return new Session({
            browserToolsBroker: this.browserToolsBroker,
            clientId: options.clientId,
            appVersion: options.appVersion,
            clientCapabilities: options.clientCapabilities,
            permissions: options.permissions,
            onMessage: options.onMessage,
            onMessageToSource: options.onMessageToSource,
            onBinaryMessage: options.onBinaryMessage,
            onBinaryMessageToSource: options.onBinaryMessageToSource,
            getTransportBufferedAmount: options.getTransportBufferedAmount,
            onLifecycleIntent: options.onLifecycleIntent,
            logger: options.connectionLogger.child({ module: "session" }),
            onWorkspaceRecovered: async (workspace) => {
                await Promise.all(this.listSessions().map((activeSession) => activeSession.refreshRecoveredWorkspaceForExternalMutation(workspace)));
            },
            publishScriptStatusUpdate: (message) => this.publishScriptStatusUpdate(message),
            downloadTokenStore: this.downloadTokenStore,
            pushNotifications: this.pushNotifications,
            paseoHome: this.paseoHome,
            worktreesRoot: this.worktreesRoot,
            agentManager: this.agentManager,
            agentStorage: this.agentStorage,
            messageReceipts: this.messageReceipts,
            creationService: this.creationService,
            projectRegistry: this.projectRegistry,
            workspaceRegistry: this.workspaceRegistry,
            workspaceLabelService: this.workspaceLabelService ?? undefined,
            directorySync: this.directorySync,
            scheduleService: this.scheduleService,
            checkoutDiffManager: this.checkoutDiffManager,
            github: this.github,
            workspaceGitService: this.workspaceGitService,
            workspaceAutoName: this.workspaceAutoName,
            daemonConfigStore: this.daemonConfigStore,
            pluginRuntime: this.pluginRuntime,
            orchestrationSkills: this.orchestrationSkills,
            mcpBaseUrl: this.mcpBaseUrl,
            stt: () => this.speech?.resolveStt() ?? null,
            sttLanguage: this.speech?.resolveSttLanguage() ?? "en",
            tts: () => this.speech?.resolveTts() ?? null,
            terminalManager: this.terminalManager,
            providerSnapshotManager: this.providerSnapshotManager,
            hubExecutionAgents: options.hubExecutionAgents,
            hubRelationships: options.hubRelationships,
            serviceProxy: this.serviceProxy ?? undefined,
            scriptRuntimeStore: this.scriptRuntimeStore ?? undefined,
            workspaceSetupSnapshots: this.workspaceSetupSnapshots,
            workspaceSetupRuntime: this.workspaceSetupRuntime,
            onBranchChanged: this.onBranchChanged ?? undefined,
            getDaemonTcpPort: this.getDaemonTcpPort ?? undefined,
            getDaemonTcpHost: this.getDaemonTcpHost ?? undefined,
            serviceProxyPublicBaseUrl: this.serviceProxyPublicBaseUrl,
            resolveScriptHealth: this.resolveScriptHealth ?? undefined,
            voice: {
                turnDetection: () => this.speech?.resolveTurnDetection() ?? null,
            },
            voiceBridge: {
                registerVoiceSpeakHandler: (agentId, handler) => {
                    if (this.voiceSpeakHandlers.has(agentId))
                        throw new Error("Voice mode is already active for this agent");
                    this.voiceSpeakHandlers.set(agentId, handler);
                },
                unregisterVoiceSpeakHandler: (agentId) => {
                    this.voiceSpeakHandlers.delete(agentId);
                },
                registerVoiceCallerContext: (agentId, context) => {
                    this.voiceCallerContexts.set(agentId, context);
                },
                unregisterVoiceCallerContext: (agentId) => {
                    this.voiceCallerContexts.delete(agentId);
                },
            },
            dictation: this.dictation || this.speech
                ? {
                    finalTimeoutMs: this.dictation?.finalTimeoutMs,
                    stt: () => this.speech?.resolveDictationStt() ?? null,
                    sttLanguage: this.speech?.resolveDictationSttLanguage() ?? "en",
                    getSpeechReadiness: () => this.speech.getReadiness(),
                }
                : undefined,
            serverId: this.serverId,
            daemonVersion: this.daemonVersion,
            daemonRuntimeConfig: this.daemonRuntimeConfig,
            getWebSocketRuntimeMetrics: () => this.lastRuntimeMetricsSnapshot,
        });
    }
    clearPendingConnection(ws) {
        const pending = this.pendingConnections.get(ws);
        if (!pending) {
            return null;
        }
        if (pending.helloTimeout) {
            clearTimeout(pending.helloTimeout);
            pending.helloTimeout = null;
        }
        this.pendingConnections.delete(ws);
        return pending;
    }
    async handleHello(params) {
        const { ws, message, pending } = params;
        if (message.protocolVersion < 1) {
            this.clearPendingConnection(ws);
            pending.connectionLogger.warn({
                receivedProtocolVersion: message.protocolVersion,
                expectedProtocolVersion: WS_PROTOCOL_VERSION,
            }, "Rejected hello due to protocol version mismatch");
            await this.rejectHello(ws, message, "incompatible_protocol");
            return;
        }
        pending.authenticating = true;
        if (!pending.admission && !(await this.admitPendingHello(ws, message, pending)))
            return;
        const clientId = message.clientId.trim();
        if (clientId.length === 0) {
            this.clearPendingConnection(ws);
            pending.connectionLogger.warn("Rejected hello with empty clientId");
            try {
                ws.close(WS_CLOSE_INVALID_HELLO, "Invalid hello");
            }
            catch {
                // ignore close errors
            }
            return;
        }
        const pluginId = this.pluginSocketIds.get(ws);
        const expectedPluginClientId = pluginId ? createPluginClientId(pluginId) : null;
        if ((expectedPluginClientId !== null && clientId !== expectedPluginClientId) ||
            (expectedPluginClientId === null && isPluginClientId(clientId))) {
            this.clearPendingConnection(ws);
            pending.connectionLogger.warn({ clientId }, "Rejected reserved plugin clientId");
            ws.close(WS_CLOSE_INVALID_HELLO, "Invalid plugin clientId");
            return;
        }
        this.clearPendingConnection(ws);
        const admitted = pending.admission;
        if (!admitted)
            throw new Error("Admitted hello has no session admission");
        pending.identity.clientId = clientId;
        if (message.appVersion) {
            pending.identity.appVersion = message.appVersion;
        }
        const sessionKey = sessionConnectionKey(admitted.principalId, clientId);
        const existing = pluginId ? undefined : this.externalSessionsByKey.get(sessionKey);
        if (existing) {
            this.resumeSession({ ws, message, pending, existing });
            return;
        }
        const connectionLogger = pending.connectionLogger.child({ clientId });
        this.incrementRuntimeCounter("helloNew");
        const connection = this.createSessionConnection({
            ws,
            clientId,
            appVersion: message.appVersion ?? null,
            clientCapabilities: message.capabilities ?? null,
            connectionLogger,
            lifecycle: pluginId ? { kind: "ephemeral-plugin", pluginId } : { kind: "reconnectable" },
            admission: admitted,
        });
        this.sessions.set(ws, connection);
        if (connection.lifecycle === "reconnectable") {
            this.externalSessionsByKey.set(sessionKey, connection);
        }
        pending.identity.sessionId = connection.session.getSessionId();
        this.sendToClient(ws, this.createServerInfoMessage(connection.session));
        connection.connectionLogger.info({
            ...toConnectionLogFields(pending.identity),
            resumed: false,
            totalSessions: this.sessions.size,
        }, "Client connected via hello");
    }
    handleHelloSafely(params) {
        return this.handleHello(params).catch((error) => {
            try {
                this.handleRawMessageError({
                    ws: params.ws,
                    data: "",
                    error,
                    log: params.pending.connectionLogger,
                });
            }
            catch {
                // The error reporter must not turn a connection failure into a process failure.
            }
            finally {
                try {
                    params.ws.close(WS_CLOSE_INVALID_HELLO, "Invalid hello");
                }
                catch {
                    // The transport may already be closed.
                }
            }
        });
    }
    async admitPendingHello(ws, message, pending) {
        if (pending.admission)
            return true;
        try {
            const resolved = await resolveSessionAdmission({
                credential: message.auth,
                passwordHash: this.passwordHash,
                localCredential: this.credentialSource?.localCredential?.() ?? null,
                transport: pending.identity.transport === "relay" ? "relay" : "direct",
            });
            if (this.pendingConnections.get(ws) !== pending)
                return false;
            if ("rejection" in resolved) {
                this.clearPendingConnection(ws);
                await this.rejectHello(ws, message, resolved.rejection);
                return false;
            }
            pending.admission = resolved.admission;
            return true;
        }
        catch (error) {
            pending.connectionLogger.error({ err: error }, "Failed to resolve hello credential");
            if (this.pendingConnections.get(ws) === pending) {
                this.clearPendingConnection(ws);
                await this.rejectHello(ws, message, "incorrect_password");
            }
            return false;
        }
    }
    async rejectHello(ws, hello, reason) {
        // Older clients discard unknown frames, then use the close code and reason.
        // They never send hello.auth, so avoid sending an unknown envelope to them.
        if (hello.auth || hello.capabilities?.[CLIENT_CAPS.helloRejection] === true) {
            try {
                await ws.send(JSON.stringify({ type: "hello.rejected", reason, accepts: ["password"] }));
            }
            catch {
                // The close reason remains the compatibility signal.
            }
        }
        const closeReason = {
            password_required: "Password required",
            incorrect_password: "Incorrect password",
            incompatible_protocol: "Incompatible protocol version",
        }[reason];
        try {
            ws.close(reason === "incompatible_protocol"
                ? WS_CLOSE_INCOMPATIBLE_PROTOCOL
                : WS_CLOSE_DAEMON_AUTH_FAILED, closeReason);
        }
        catch {
            // Ignore a transport that closed while the rejection was sent.
        }
    }
    resumeSession(params) {
        const { ws, message, pending, existing } = params;
        this.incrementRuntimeCounter("helloResumed");
        if (existing.externalDisconnectCleanupTimeout) {
            clearTimeout(existing.externalDisconnectCleanupTimeout);
            existing.externalDisconnectCleanupTimeout = null;
        }
        const newAppVersion = message.appVersion ?? null;
        if (newAppVersion && newAppVersion !== existing.appVersion) {
            existing.appVersion = newAppVersion;
            existing.session.updateAppVersion(newAppVersion);
        }
        const newClientCapabilities = message.capabilities ?? null;
        // COMPAT(selectiveAgentTimeline): added in v0.1.106. Every capable resumed
        // hello resets membership before server_info so stale retained-session
        // state cannot leak. Remove after 2027-01-12.
        existing.session.updateClientCapabilities(newClientCapabilities, ws, newAppVersion);
        if (JSON.stringify(existing.clientCapabilities ?? null) !==
            JSON.stringify(newClientCapabilities ?? null)) {
            existing.clientCapabilities = newClientCapabilities;
        }
        existing.sockets.add(ws);
        this.sessions.set(ws, existing);
        pending.identity.sessionId = existing.session.getSessionId();
        this.sendToClient(ws, this.createServerInfoMessage(existing.session));
        pending.connectionLogger.info({
            ...toConnectionLogFields(pending.identity),
            resumed: true,
            totalSessions: this.sessions.size,
        }, "Client connected via hello");
    }
    buildServerInfoStatusPayload(session) {
        return {
            status: "server_info",
            protocolVersion: WS_PROTOCOL_VERSION,
            serverId: this.serverId,
            hostname: getHostName(),
            version: this.daemonVersion,
            permissions: session.getPermissions(),
            // COMPAT(desktopManaged): added in v0.1.X, remove optional parsing after 2027-01-16.
            desktopManaged: this.daemonRuntimeConfig?.desktopManaged === true,
            ...(this.serverCapabilities ? { capabilities: this.serverCapabilities } : {}),
            features: {
                usageSources: true,
                ownedSubscriptions: true,
                agentRequestReceipts: true,
                workspaceRequestReceipts: true,
                creationLifecycle: true,
                hubAgentRpc: true,
                // COMPAT(directorySync): added in v0.3.x, remove gate after 2027-02-12.
                directorySync: true,
                // COMPAT(workspaceLabels): added in v0.5.0, remove after 2027-08-14.
                ...(this.workspaceLabelService ? { workspaceLabels: true } : {}),
                // COMPAT(workspaceSetupRun): added in v0.7.3, remove gate after 2027-09-02.
                workspaceSetupRun: true,
                // COMPAT(providersSnapshot): keep optional until all clients rely on snapshot flow.
                providersSnapshot: true,
                // COMPAT(providersSnapshotCwd): added in v0.3.2, remove gate after 2027-02-10.
                providersSnapshotCwd: true,
                // COMPAT(checkoutForgeSetAutoMerge): added in v0.2.0-beta.1. Remove the
                // feature gate and legacy fallback after 2027-01-17 once the supported
                // daemon floor is >= v0.2.0.
                checkoutForgeSetAutoMerge: true,
                // COMPAT(checkoutGithubSetAutoMerge): added in v0.1.75 and retained as
                // the fallback for checkoutForgeSetAutoMerge. Stop advertising it after
                // 2027-01-17 once supported floors are >= v0.2.0.
                checkoutGithubSetAutoMerge: true,
                // COMPAT(githubCheckDetails): added in v0.1.92 and retained as the
                // fallback for forgeCheckDetails. Stop advertising it after 2027-01-17
                // once supported floors are >= v0.2.0.
                githubCheckDetails: true,
                // COMPAT(forgeCheckDetails): added in v0.2.0-beta.1. Remove the feature
                // gate and legacy fallback after 2027-01-17 once the supported daemon
                // floor is >= v0.2.0.
                forgeCheckDetails: true,
                // COMPAT(forgeSearch): added in v0.2.0-beta.1. Remove the feature gate
                // and legacy fallback after 2027-01-17 once the supported daemon floor
                // is >= v0.2.0.
                forgeSearch: true,
                // COMPAT(daemonStatusRpc): added in v0.1.76, remove gate after 2026-11-18.
                ...(this.advertiseDaemonStatusRpc ? { daemonStatusRpc: true } : {}),
                // COMPAT(daemonConfigReload): added in v0.4.0, remove gate after 2027-02-14.
                daemonConfigReload: true,
                // COMPAT(relayConfig): added in v0.2.6, remove gate after 2027-01-31.
                ...(this.advertiseRelayConfig ? { relayConfig: true } : {}),
                // COMPAT(pushTokenRevocation): added in v0.3.2, remove gate after 2027-02-10.
                pushTokenRevocation: true,
                // COMPAT(plugins): added in v0.3.0, remove gate after 2027-08-07.
                plugins: true,
                pluginManagement: true,
                pluginGitManagement: true,
                pluginSourceInstallation: true,
                pluginSourceUpdates: true,
                pluginLogs: true,
                // COMPAT(pluginThemes): added in v0.5.0, remove gate after 2027-08-20.
                pluginThemes: true,
                pluginSettings: true,
                pluginTimelineItems: true,
                // COMPAT(skillManagement): added in v0.4.0, remove gate after 2027-08-16.
                skillManagement: true,
                // COMPAT(terminalRestoreModes): added in v0.1.81, remove gate after 2026-11-23.
                "terminal-restore-modes": true,
                // COMPAT(terminalInputModeReplay): added in v0.2.6, remove gate after 2027-02-02.
                "terminal-input-mode-replay": true,
                // COMPAT(terminalSizeOwnership): added in v0.2.6, remove gate after 2027-02-02.
                "terminal-size-ownership": true,
                workspaceTerminals: true,
                // COMPAT(rewind): added in v0.1.X, drop the gate when floor >= v0.1.X.
                rewind: true,
                // COMPAT(agentTimelinePromptIndex): added in v0.2.X, drop the gate when floor >= v0.2.X.
                agentTimelinePromptIndex: true,
                // COMPAT(agentHistorySearch): added in v0.3.0, remove gate after 2027-02-07.
                agentHistorySearch: true,
                // COMPAT(checkoutRefresh): added in v0.1.86, remove gate after 2026-11-29.
                checkoutRefresh: true,
                // COMPAT(workspaceMultiplicity): added in v0.1.97, drop the gate when floor >= v0.1.97
                workspaceMultiplicity: true,
                // COMPAT(projectRemove): added in v0.1.97, drop the gate when floor >= v0.1.97.
                projectRemove: true,
                // COMPAT(projectAdd): added in v0.1.97, drop the gate when floor >= v0.1.97.
                projectAdd: true,
                // COMPAT(projectList): added in v0.2.4, drop the gate when floor >= v0.2.4.
                projectList: true,
                // COMPAT(worktreeRestore): keep through 2027-01-11 for clients older than v0.1.105.
                worktreeRestore: true,
                // COMPAT(workspaceRecovery): added in v0.1.105, remove after 2027-01-11 once daemon floor >= v0.1.105.
                workspaceRecovery: true,
                // COMPAT(workspaceFileEditing): added in v0.2.0, remove after 2027-01-18 once daemon floor >= v0.2.0.
                workspaceFileEditing: true,
                // COMPAT(providerUsageList): added in v0.1.98, drop the gate when daemon floor >= v0.1.98.
                providerUsageList: true,
                // COMPAT(agentDetach): added in v0.1.98, remove gate after 2026-12-19 once daemon floor >= v0.1.98.
                agentDetach: true,
                // COMPAT(agentThinkingUpdate): added in v0.2.4, remove gate after 2027-01-28.
                agentThinkingUpdate: true,
                // COMPAT(daemonDiagnostics): added in v0.1.100, remove gate after 2026-12-25 once daemon floor >= v0.1.100.
                daemonDiagnostics: true,
                // COMPAT(daemonSelfUpdate): added in v0.1.93, remove gate after 2026-12-13.
                daemonSelfUpdate: this.daemonRuntimeConfig?.desktopManaged !== true,
                // COMPAT(agentForkContext): added in v0.1.102, remove gate after 2026-12-28.
                agentForkContext: true,
                // COMPAT(agentForkContextCursor): added in v0.1.108, remove gate after 2027-01-14.
                agentForkContextCursor: true,
                // COMPAT(providerSubagents): added in v0.1.107, remove gate after 2027-01-12.
                providerSubagents: true,
                // COMPAT(projectedSubagentTimeline): added after v0.8.0, remove gates after 2027-03-14; retain advertisement.
                projectedSubagentTimeline: true,
                // COMPAT(providerSubagentNesting): added in v0.7, remove gate after 2027-03-04.
                providerSubagentNesting: true,
                // COMPAT(workspacePinning): added in v0.1.107, remove gate after 2027-01-12.
                workspacePinning: true,
                // COMPAT(workspaceMarkUnread): added in v0.5.0, remove after 2027-08-20.
                workspaceMarkUnread: true,
                // COMPAT(hubRelationship): added in v0.1.X, drop the gate when floor >= v0.1.X.
                hubRelationship: true,
                // COMPAT(projectGithubClone): added in v0.1.108, remove gate after 2027-01-15.
                projectGithubClone: true,
                // COMPAT(workspaceGithubRepositorySearch): added in v0.1.108, remove gate after 2027-01-15.
                workspaceGithubRepositorySearch: true,
                // COMPAT(projectCreateDirectory): added in v0.1.108, remove gate after 2027-01-15.
                projectCreateDirectory: true,
                // COMPAT(commitsList): added in v0.1.110, remove gate after 2027-01-16.
                commitsList: true,
                // COMPAT(commitBaseClassification): added in v0.2.0, remove gate after 2027-01-23.
                commitBaseClassification: true,
                // COMPAT(providerRemoval): added in v0.1.105, drop the gate when floor >= v0.1.105.
                providerRemoval: true,
                // COMPAT(importSessionWorkspaceTarget): added in v0.1.110, remove gate after 2027-01-16.
                importSessionWorkspaceTarget: true,
                // COMPAT(importSessionSearch): added in v0.7.3, remove gate after 2027-03-02.
                importSessionSearch: true,
                // COMPAT(forgeProviders): added in v0.2.0-beta.1. Drop the gate after
                // 2027-01-17 once the supported daemon floor is >= v0.2.0.
                forgeProviders: true,
                // COMPAT(selectiveAgentTimeline): added in v0.1.106, remove after 2027-01-12.
                selectiveAgentTimeline: true,
                explicitEventSubscriptions: true,
                // COMPAT(canonicalSubmittedPrompts): added in v0.2.6, remove gate after 2027-01-30.
                canonicalSubmittedPrompts: true,
                // COMPAT(stableProjectIdentity): added in v0.1.109, remove gate after 2027-01-15.
                stableProjectIdentity: true,
                // COMPAT(workspaceScriptManagement): added in v0.1.105, remove gate after 2027-01-10.
                workspaceScriptManagement: true,
                // COMPAT(projectCustomIcon): added in v0.2.0, remove after 2027-01-20.
                projectCustomIcon: true,
                // COMPAT(fsEntryOps): added in v0.3.0, remove gate after 2027-02-08.
                fsEntryOps: true,
                // COMPAT(fsEntryDuplicate): added in v0.3.0, remove gate after 2027-02-09.
                fsEntryDuplicate: true,
                // COMPAT(checkoutDiscardChanges): added in v0.3.0, remove gate after 2027-02-08.
                checkoutDiscardChanges: true,
                // COMPAT(agentProfiles): added in v0.3.2, remove gate after 2027-02-11.
                agentProfiles: true,
                // COMPAT(agentConfigApply): added in v0.3.2, remove gate after 2027-02-11.
                agentConfigApply: true,
            },
        };
    }
    createServerInfoMessage(session) {
        return {
            type: "session",
            message: {
                type: "status",
                payload: this.buildServerInfoStatusPayload(session),
            },
        };
    }
    createDaemonConfigChangedMessage(config) {
        return wrapSessionMessage({
            type: "status",
            payload: {
                status: "daemon_config_changed",
                config,
            },
        });
    }
    broadcastCapabilitiesUpdate() {
        for (const connection of new Set(this.sessions.values())) {
            if (![...connection.sockets].some((socket) => connection.session.wantsSourceEvent(socket, "status.server_info")))
                continue;
            connection.session.publish({
                type: "status",
                payload: this.buildServerInfoStatusPayload(connection.session),
            });
        }
    }
    broadcastDaemonConfigChanged(config) {
        this.broadcast(this.createDaemonConfigChangedMessage(config));
    }
    bindSocketHandlers(ws) {
        ws.on("message", (...args) => {
            const data = args[0];
            this.handleRawMessage(ws, data);
        });
        ws.on("close", async (...args) => {
            const code = args[0];
            const reason = args[1];
            await this.detachSocket(ws, {
                code: typeof code === "number" ? code : undefined,
                reason,
            });
        });
        ws.on("error", async (...args) => {
            const error = args[0];
            const err = error instanceof Error ? error : new Error(String(error));
            const active = this.sessions.get(ws);
            const pending = this.pendingConnections.get(ws);
            const log = active?.connectionLogger ?? pending?.connectionLogger ?? this.logger;
            log.error({ err }, "Client error");
            await this.detachSocket(ws, { error: err });
        });
    }
    resolveVoiceSpeakHandler(callerAgentId) {
        return this.voiceSpeakHandlers.get(callerAgentId) ?? null;
    }
    resolveVoiceCallerContext(callerAgentId) {
        return this.voiceCallerContexts.get(callerAgentId) ?? null;
    }
    async detachSocket(ws, details) {
        this.applicationSocketLease.release(ws);
        const identity = this.socketIdentities.get(ws);
        const identityFields = identity ? toConnectionLogFields(identity) : {};
        const pending = this.clearPendingConnection(ws);
        if (pending) {
            this.incrementRuntimeCounter("pendingDisconnected");
            pending.connectionLogger.info({
                ...identityFields,
                code: details.code,
                reason: stringifyCloseReason(details.reason),
            }, "Pending client disconnected");
            this.socketIdentities.delete(ws);
            this.finishPluginSocketCleanup(ws);
            return;
        }
        const connection = this.sessions.get(ws);
        if (!connection) {
            if (identity) {
                this.logger.info({
                    ...identityFields,
                    code: details.code,
                    reason: stringifyCloseReason(details.reason),
                }, "Client socket closed without active session");
                this.socketIdentities.delete(ws);
            }
            this.finishPluginSocketCleanup(ws);
            return;
        }
        this.sessions.delete(ws);
        connection.sockets.delete(ws);
        connection.session.clearAgentTimelineSubscription(ws);
        this.socketIdentities.delete(ws);
        if (connection.sockets.size === 0) {
            if (connection.lifecycle === "ephemeral-plugin") {
                this.pluginSocketIds.delete(ws);
                await this.cleanupConnection(connection, "Plugin session disconnected");
                this.finishPluginSocketCleanup(ws);
                return;
            }
            this.incrementRuntimeCounter("sessionDisconnectedWaitingReconnect");
            if (connection.externalDisconnectCleanupTimeout) {
                clearTimeout(connection.externalDisconnectCleanupTimeout);
            }
            const timeout = setTimeout(() => {
                if (connection.externalDisconnectCleanupTimeout !== timeout) {
                    return;
                }
                connection.externalDisconnectCleanupTimeout = null;
                void this.cleanupConnection(connection, "Client disconnected (grace timeout)");
            }, EXTERNAL_SESSION_DISCONNECT_GRACE_MS);
            connection.externalDisconnectCleanupTimeout = timeout;
            connection.connectionLogger.info({
                ...identityFields,
                code: details.code,
                reason: stringifyCloseReason(details.reason),
                reconnectGraceMs: EXTERNAL_SESSION_DISCONNECT_GRACE_MS,
            }, "Client disconnected; waiting for reconnect");
            return;
        }
        if (connection.sockets.size > 0) {
            this.incrementRuntimeCounter("sessionSocketDisconnectedAttached");
            connection.connectionLogger.info({
                ...identityFields,
                remainingSockets: connection.sockets.size,
                code: details.code,
                reason: stringifyCloseReason(details.reason),
            }, "Client socket disconnected; session remains attached");
            return;
        }
        await this.cleanupConnection(connection, "Client disconnected");
        this.finishPluginSocketCleanup(ws);
    }
    finishPluginSocketCleanup(ws) {
        const resolve = this.pluginSocketCleanup.get(ws);
        if (!resolve)
            return;
        this.pluginSocketCleanup.delete(ws);
        resolve();
    }
    async cleanupConnection(connection, logMessage) {
        this.incrementRuntimeCounter("sessionCleanup");
        if (connection.lifecycle === "reconnectable" && connection.externalDisconnectCleanupTimeout) {
            clearTimeout(connection.externalDisconnectCleanupTimeout);
            connection.externalDisconnectCleanupTimeout = null;
        }
        for (const socket of connection.sockets) {
            this.sessions.delete(socket);
            this.socketIdentities.delete(socket);
        }
        connection.sockets.clear();
        if (connection.lifecycle === "reconnectable") {
            const existing = this.externalSessionsByKey.get(connection.sessionKey);
            if (existing === connection) {
                this.externalSessionsByKey.delete(connection.sessionKey);
            }
        }
        connection.connectionLogger.trace({ clientId: connection.clientId, totalSessions: this.sessions.size }, logMessage);
        await connection.session.cleanup();
    }
    handleInvalidInboundMessage(args) {
        const { ws, parsed, parsedMessage, pendingConnection, activeConnection, log } = args;
        this.incrementRuntimeCounter("validationFailed");
        if (pendingConnection) {
            pendingConnection.connectionLogger.warn({ error: parsedMessage.error.message }, "Rejected pending message before hello");
            this.clearPendingConnection(ws);
            try {
                ws.close(WS_CLOSE_INVALID_HELLO, "Invalid hello");
            }
            catch {
                // ignore close errors
            }
            return;
        }
        const requestInfo = extractRequestInfoFromUnknownWsInbound(parsed);
        const isUnknownSchema = requestInfo?.requestId != null &&
            typeof parsed === "object" &&
            parsed != null &&
            "type" in parsed &&
            parsed.type === "session";
        log.warn({
            clientId: activeConnection?.clientId,
            requestId: requestInfo?.requestId,
            requestType: requestInfo?.requestType,
            error: parsedMessage.error.message,
        }, "WS inbound message validation failed");
        activeConnection?.session.delivery.protocolFailure(ws, {
            ...requestInfo,
            error: isUnknownSchema
                ? `Unknown request, try upgrading the daemon (currently v${this.daemonVersion})`
                : `Invalid message: ${parsedMessage.error.message}`,
            code: isUnknownSchema ? "unknown_schema" : "invalid_message",
        });
    }
    maybeHandleBinaryFrame(params) {
        const { ws, buffer, activeConnection, log } = params;
        const asBytes = asUint8Array(buffer);
        if (!asBytes) {
            return false;
        }
        const decodedFrame = decodeBinaryFrame(asBytes);
        if (!decodedFrame) {
            return false;
        }
        if (!activeConnection) {
            this.incrementRuntimeCounter("binaryBeforeHelloRejected");
            log.warn("Rejected binary frame before hello");
            this.clearPendingConnection(ws);
            try {
                ws.close(WS_CLOSE_INVALID_HELLO, "Session message before hello");
            }
            catch {
                // ignore close errors
            }
            return true;
        }
        void Promise.resolve(activeConnection.session.handleBinaryFrame(decodedFrame, ws)).catch((error) => {
            this.handleRawMessageError({
                ws,
                data: buffer,
                error,
                log: activeConnection.connectionLogger,
            });
        });
        return true;
    }
    handlePendingConnectionMessage(params) {
        const { ws, message, pendingConnection } = params;
        if (message.type === "hello" && !pendingConnection.authenticating) {
            void this.handleHelloSafely({
                ws,
                message,
                pending: pendingConnection,
            });
            return;
        }
        pendingConnection.connectionLogger.warn({
            messageType: message.type,
        }, "Rejected pending message before hello");
        this.incrementRuntimeCounter("pendingMessageRejectedBeforeHello");
        this.clearPendingConnection(ws);
        try {
            ws.close(WS_CLOSE_INVALID_HELLO, "Session message before hello");
        }
        catch {
            // ignore close errors
        }
    }
    handleRawMessage(ws, data) {
        if (this.connectionLifecycle === "stopping" ||
            (this.connectionLifecycle === "starting" && !this.pluginSocketIds.has(ws))) {
            return;
        }
        this.applicationSocketLease.renew(ws);
        const activeConnection = this.sessions.get(ws);
        const pendingConnection = this.pendingConnections.get(ws);
        const log = activeConnection?.connectionLogger ?? pendingConnection?.connectionLogger ?? this.logger;
        try {
            const buffer = bufferFromWsData(data);
            const binaryHandled = this.maybeHandleBinaryFrame({
                ws,
                buffer,
                activeConnection,
                log,
            });
            if (binaryHandled) {
                return;
            }
            const parsed = JSON.parse(buffer.toString());
            const parsedMessage = WSInboundMessageSchema.safeParse(parsed);
            if (!parsedMessage.success) {
                this.handleInvalidInboundMessage({
                    ws,
                    parsed,
                    parsedMessage,
                    pendingConnection,
                    activeConnection,
                    log,
                });
                return;
            }
            const message = parsedMessage.data;
            this.recordInboundMessageType(message.type);
            if (message.type === "ping" && activeConnection) {
                // A plugin socket is IPC to a child this daemon already supervises, not
                // an abandonable application socket.
                if (!this.pluginSocketIds.has(ws)) {
                    this.applicationSocketLease.claim(ws);
                }
                this.sendToClient(ws, { type: "pong" });
                return;
            }
            if (pendingConnection) {
                this.handlePendingConnectionMessage({
                    ws,
                    message,
                    pendingConnection,
                });
                return;
            }
            if (message.type === "recording_state") {
                return;
            }
            if (!activeConnection) {
                this.incrementRuntimeCounter("missingConnectionForMessage");
                this.logger.error("No connection found for websocket");
                return;
            }
            if (message.type === "hello") {
                this.incrementRuntimeCounter("unexpectedHelloOnActiveConnection");
                activeConnection.connectionLogger.warn("Received hello on active connection");
                try {
                    ws.close(WS_CLOSE_INVALID_HELLO, "Unexpected hello");
                }
                catch {
                    // ignore close errors
                }
                return;
            }
            if (message.type === "session") {
                void this.dispatchSessionMessage(ws, activeConnection, message).catch((error) => {
                    this.handleRawMessageError({ ws, data, error, log: activeConnection.connectionLogger });
                });
            }
        }
        catch (error) {
            this.handleRawMessageError({ ws, data, error, log });
        }
    }
    async dispatchSessionMessage(ws, activeConnection, message) {
        this.recordInboundSessionRequestType(message.message.type);
        const controlRpc = getControlRpcLogInfo(message.message);
        if (controlRpc) {
            const identity = this.socketIdentities.get(ws);
            let connectionFields;
            if (identity) {
                connectionFields = toConnectionLogFields(identity);
            }
            else {
                connectionFields = { clientId: activeConnection.clientId };
            }
            activeConnection.connectionLogger.warn({
                ...connectionFields,
                ...controlRpc,
            }, "ws_control_rpc_received");
        }
        const startMs = performance.now();
        await activeConnection.session.handleMessage(message.message, ws);
        const durationMs = performance.now() - startMs;
        this.recordRequestLatency(message.message.type, durationMs);
        if (durationMs >= SLOW_REQUEST_THRESHOLD_MS) {
            activeConnection.connectionLogger.warn({
                requestType: message.message.type,
                durationMs: Math.round(durationMs),
                inflightRequests: activeConnection.session.getRuntimeMetrics().inflightRequests,
            }, "ws_slow_request");
        }
    }
    handleRawMessageError(params) {
        const { ws, data, error, log } = params;
        const err = error instanceof Error ? error : new Error(String(error));
        // Inbound frames can contain hello.auth.password or session secrets.
        log.error({ errorName: err.name }, "Failed to parse/handle message");
        if (this.pendingConnections.has(ws)) {
            this.clearPendingConnection(ws);
            try {
                ws.close(WS_CLOSE_INVALID_HELLO, "Invalid hello");
            }
            catch {
                // ignore close errors
            }
            return;
        }
        const requestInfo = extractRequestInfoFromUnknownWsInbound(this.decodeRawMessagePayloadForError(data));
        this.sessions.get(ws)?.session.delivery.protocolFailure(ws, {
            ...requestInfo,
            error: `Invalid message: ${err.message}`,
            code: "invalid_message",
        });
    }
    decodeRawMessagePayloadForError(data) {
        try {
            return JSON.parse(bufferFromWsData(data).toString());
        }
        catch {
            return null;
        }
    }
    incrementRuntimeCounter(counter) {
        this.runtimeMetrics.incrementCounter(counter);
    }
    recordInboundMessageType(type) {
        this.runtimeMetrics.recordInboundMessage(type);
    }
    recordInboundSessionRequestType(type) {
        this.runtimeMetrics.recordInboundSessionRequest(type);
    }
    recordRequestLatency(type, durationMs) {
        this.runtimeMetrics.recordRequestLatency(type, durationMs);
    }
    collectSessionRuntimeMetrics() {
        const uniqueConnections = new Set(this.externalSessionsByKey.values());
        let terminalDirectorySubscriptionCount = 0;
        let terminalSubscriptionCount = 0;
        let workspaceGitWatchedDirectoryCount = 0;
        let workspaceGitWorkspaceRecordCount = 0;
        let workspaceGitSubscriptionCount = 0;
        let inflightRequests = 0;
        let peakInflightRequests = 0;
        for (const connection of uniqueConnections) {
            const sessionMetrics = connection.session.getRuntimeMetrics();
            terminalDirectorySubscriptionCount += sessionMetrics.terminalDirectorySubscriptionCount;
            terminalSubscriptionCount += sessionMetrics.terminalSubscriptionCount;
            workspaceGitWatchedDirectoryCount += sessionMetrics.workspaceGitWatchedDirectoryCount;
            workspaceGitWorkspaceRecordCount += sessionMetrics.workspaceGitWorkspaceRecordCount;
            workspaceGitSubscriptionCount += sessionMetrics.workspaceGitSubscriptionCount;
            inflightRequests += sessionMetrics.inflightRequests;
            peakInflightRequests = Math.max(peakInflightRequests, sessionMetrics.peakInflightRequests);
            connection.session.resetPeakInflight();
        }
        return {
            ...this.checkoutDiffManager.getMetrics(),
            terminalDirectorySubscriptionCount,
            terminalSubscriptionCount,
            workspaceGitWatchedDirectoryCount,
            workspaceGitWorkspaceRecordCount,
            workspaceGitSubscriptionCount,
            inflightRequests,
            peakInflightRequests,
        };
    }
    flushRuntimeMetrics(options) {
        const runtimeMetrics = this.runtimeMetrics.snapshotAndReset();
        const activeConnections = new Set(this.sessions.values()).size;
        const activeSockets = this.sessions.size;
        const pendingConnections = this.pendingConnections.size;
        const reconnectGraceSessions = [...this.externalSessionsByKey.values()].filter((connection) => connection.sockets.size === 0 && connection.externalDisconnectCleanupTimeout !== null).length;
        const sessionMetrics = this.collectSessionRuntimeMetrics();
        const agentSnapshot = this.agentManager.getMetricsSnapshot();
        const gitCommandMetrics = snapshotGitCommandRuntimeMetrics();
        const loggedMetrics = {
            windowMs: runtimeMetrics.windowMs,
            final: Boolean(options?.final),
            sessions: {
                activeConnections,
                externalSessionKeys: this.externalSessionsByKey.size,
                reconnectGraceSessions,
            },
            sockets: {
                activeSockets,
                pendingConnections,
            },
            counters: runtimeMetrics.counters,
            inboundMessageTypesTop: runtimeMetrics.inboundMessageTypesTop,
            inboundSessionRequestTypesTop: runtimeMetrics.inboundSessionRequestTypesTop,
            outboundMessageTypesTop: runtimeMetrics.outboundMessageTypesTop,
            outboundSessionMessageTypesTop: runtimeMetrics.outboundSessionMessageTypesTop,
            outboundAgentStreamTypesTop: runtimeMetrics.outboundAgentStreamTypesTop,
            outboundAgentStreamAgentsTop: runtimeMetrics.outboundAgentStreamAgentsTop,
            outboundBinaryFrameTypesTop: runtimeMetrics.outboundBinaryFrameTypesTop,
            bufferedAmount: runtimeMetrics.bufferedAmount,
            eventLoopDelay: this.snapshotEventLoopDelay(),
            loopHealth: this.snapshotLoopHealth(),
            uptimeSeconds: getProcessUptimeSeconds(),
            memory: getProcessMemoryDiagnostics(),
            runtime: sessionMetrics,
            latency: runtimeMetrics.latency,
            agents: agentSnapshot,
            git: {
                commands: gitCommandMetrics,
                workspaceService: this.workspaceGitService.getMetrics(),
            },
        };
        this.lastRuntimeMetricsSnapshot = {
            collectedAt: new Date().toISOString(),
            ...loggedMetrics,
        };
        this.logger.info(loggedMetrics, "ws_runtime_metrics");
    }
    getClientActivityState(session, source) {
        const activity = session.getClientActivity(source);
        if (!activity) {
            return {
                appVisible: false,
                focusedAgentId: null,
                focusedTerminalId: null,
                lastActivityAtMs: null,
            };
        }
        return {
            appVisible: activity.appVisible,
            focusedAgentId: activity.focusedAgentId,
            focusedTerminalId: activity.focusedTerminalId,
            lastActivityAtMs: activity.lastActivityAt.getTime(),
        };
    }
    async broadcastAgentAttention(params) {
        const agent = this.agentManager.getAgent(params.agentId);
        if (!agent?.workspaceId) {
            return;
        }
        const clientEntries = [];
        for (const [ws, connection] of this.sessions) {
            if (connection.session.delivery.isModern(ws)
                ? !connection.session.wantsSourceEvent(ws, "agent_attention_required")
                : !(await connection.session.subscribesToAgent(agent, ws)))
                continue;
            clientEntries.push({
                ws,
                state: this.getClientActivityState(connection.session, ws),
            });
        }
        const notificationEntries = clientEntries.filter(({ ws }) => this.sessions.get(ws)?.session.wantsSourceNotification(ws, "agent_attention_required"));
        const allStates = notificationEntries.map((e) => e.state);
        const nowMs = Date.now();
        const assistantMessage = await this.agentManager.getLastAssistantMessage(params.agentId);
        const notification = buildAgentAttentionNotificationPayload({
            reason: params.reason,
            serverId: this.serverId,
            workspaceId: agent.workspaceId,
            agentId: params.agentId,
            assistantMessage,
            permissionRequest: findLatestPermissionRequest(agent.pendingPermissions),
        });
        const plan = computeNotificationPlan({
            allStates,
            focusTarget: { kind: "agent", id: params.agentId },
            pushEligible: isPushEligibleAttentionReason(params.reason),
            nowMs,
        });
        if (plan.shouldPush) {
            void this.pushNotificationSender.send(notification).catch((err) => {
                this.logger.warn({ err, agentId: params.agentId }, "Failed to send push notification");
            });
        }
        for (const { ws } of clientEntries) {
            const shouldNotify = plan.inAppRecipientIndex !== null &&
                notificationEntries[plan.inAppRecipientIndex]?.ws === ws;
            const timestamp = new Date().toISOString();
            const connection = this.sessions.get(ws);
            const attentionPayload = {
                agentId: params.agentId,
                reason: params.reason,
                timestamp,
                shouldNotify,
                notification,
            };
            const message = wrapSessionMessage(connection?.session.delivery.isModern(ws) ||
                connection?.session.supportsForSource(CLIENT_CAPS.selectiveAgentTimeline, ws)
                ? {
                    type: "agent_attention_required",
                    payload: attentionPayload,
                }
                : {
                    type: "agent_stream",
                    payload: {
                        agentId: params.agentId,
                        event: {
                            type: "attention_required",
                            provider: params.provider,
                            reason: params.reason,
                            timestamp,
                            shouldNotify,
                            notification,
                        },
                        timestamp,
                    },
                });
            if (message.type === "session" && this.sessions.get(ws)?.session.delivery.isModern(ws))
                this.sessions.get(ws).session.publishToSource(ws, message.message);
            else
                this.sendToClient(ws, message);
        }
    }
    async broadcastTerminalAttention(params) {
        const clientEntries = [];
        for (const [ws, connection] of this.sessions) {
            if (connection.session.delivery.isModern(ws)
                ? !connection.session.wantsSourceEvent(ws, "terminal_attention_required")
                : !(await connection.session.subscribesToTerminalDirectory({
                    cwd: params.cwd,
                    ...(params.workspaceId ? { workspaceId: params.workspaceId } : {}),
                }, ws))) {
                continue;
            }
            clientEntries.push({
                ws,
                state: this.getClientActivityState(connection.session, ws),
            });
        }
        const notificationEntries = clientEntries.filter(({ ws }) => this.sessions.get(ws)?.session.wantsSourceNotification(ws, "terminal_attention_required"));
        const allStates = notificationEntries.map((e) => e.state);
        const nowMs = Date.now();
        const workspaceId = params.workspaceId;
        const plan = computeNotificationPlan({
            allStates,
            focusTarget: { kind: "terminal", id: params.terminalId },
            pushEligible: true,
            nowMs,
        });
        const title = terminalAttentionTitle(params.reason);
        const body = params.terminalName;
        if (plan.shouldPush) {
            void this.pushNotificationSender
                .send({
                title,
                body,
                data: {
                    serverId: this.serverId,
                    terminalId: params.terminalId,
                    cwd: params.cwd,
                    ...(workspaceId ? { workspaceId } : {}),
                },
            })
                .catch((err) => {
                this.logger.warn({ err, terminalId: params.terminalId }, "Failed to send push notification");
            });
        }
        for (const { ws } of clientEntries) {
            const shouldNotify = plan.inAppRecipientIndex !== null &&
                notificationEntries[plan.inAppRecipientIndex]?.ws === ws;
            const message = wrapSessionMessage({
                type: "terminal_attention_required",
                payload: {
                    serverId: this.serverId,
                    terminalId: params.terminalId,
                    cwd: params.cwd,
                    ...(workspaceId ? { workspaceId } : {}),
                    reason: params.reason,
                    title,
                    body,
                    shouldNotify,
                },
            });
            if (message.type === "session" && this.sessions.get(ws)?.session.delivery.isModern(ws))
                this.sessions.get(ws).session.publishToSource(ws, message.message);
            else
                this.sendToClient(ws, message);
        }
    }
}
function createWebSocketConnectionIdentity(requestMetadata, metadata) {
    return {
        connectionId: `conn_${randomUUID().replaceAll("-", "")}`,
        transport: metadata?.transport ?? "direct",
        peer: resolveConnectionPeer(requestMetadata, metadata),
        browserOrigin: requestMetadata.origin !== undefined,
        ...(requestMetadata.host ? { host: requestMetadata.host } : {}),
        ...(requestMetadata.origin ? { origin: requestMetadata.origin } : {}),
        ...(requestMetadata.userAgent ? { userAgent: requestMetadata.userAgent } : {}),
        ...(requestMetadata.remoteAddress ? { remoteAddress: requestMetadata.remoteAddress } : {}),
        ...(metadata?.relayConnectionId ? { relayConnectionId: metadata.relayConnectionId } : {}),
        ...(metadata?.hubDaemonId ? { hubDaemonId: metadata.hubDaemonId } : {}),
    };
}
function sessionConnectionKey(principalId, clientId) {
    return JSON.stringify([principalId, clientId]);
}
function toConnectionLogFields(identity) {
    return {
        connectionId: identity.connectionId,
        transport: identity.transport,
        peer: identity.peer,
        ...(identity.host ? { host: identity.host } : {}),
        ...(identity.origin ? { origin: identity.origin } : {}),
        ...(identity.userAgent ? { userAgent: identity.userAgent } : {}),
        ...(identity.remoteAddress ? { remoteAddress: identity.remoteAddress } : {}),
        ...(identity.relayConnectionId ? { relayConnectionId: identity.relayConnectionId } : {}),
        ...(identity.hubDaemonId ? { hubDaemonId: identity.hubDaemonId } : {}),
        ...(identity.clientId ? { clientId: identity.clientId } : {}),
        ...(identity.sessionId ? { sessionId: identity.sessionId } : {}),
        ...(identity.appVersion ? { appVersion: identity.appVersion } : {}),
    };
}
function resolveConnectionPeer(requestMetadata, metadata) {
    if (metadata !== undefined)
        return "external";
    if (!requestMetadata.remoteAddress)
        return "local_ipc";
    return isLoopbackAddress(requestMetadata.remoteAddress) ? "loopback" : "external";
}
function isLoopbackAddress(address) {
    const normalized = address.toLowerCase();
    if (normalized === "::1" || normalized === "0:0:0:0:0:0:0:1")
        return true;
    const ipv4 = normalized.startsWith("::ffff:") ? normalized.slice("::ffff:".length) : normalized;
    return ipv4.startsWith("127.");
}
function extractSocketRequestMetadata(request) {
    if (!request || typeof request !== "object") {
        return {};
    }
    const record = request;
    const host = typeof record.headers?.host === "string" ? record.headers.host : undefined;
    const origin = typeof record.headers?.origin === "string" ? record.headers.origin : undefined;
    const userAgent = typeof record.headers?.["user-agent"] === "string" ? record.headers["user-agent"] : undefined;
    const remoteAddress = typeof record.socket?.remoteAddress === "string" ? record.socket.remoteAddress : undefined;
    return {
        ...(host ? { host } : {}),
        ...(origin ? { origin } : {}),
        ...(userAgent ? { userAgent } : {}),
        ...(remoteAddress ? { remoteAddress } : {}),
    };
}
function stripIpv6Brackets(hostname) {
    return hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
}
function parseHostAuthority(host) {
    const trimmed = host.trim();
    if (!trimmed) {
        return null;
    }
    if (trimmed.startsWith("[")) {
        const end = trimmed.indexOf("]");
        if (end === -1) {
            return null;
        }
        const hostname = stripIpv6Brackets(trimmed.slice(0, end + 1)).toLowerCase();
        const rest = trimmed.slice(end + 1);
        if (!rest) {
            return { hostname, port: null };
        }
        if (!rest.startsWith(":")) {
            return null;
        }
        const port = rest.slice(1);
        return port ? { hostname, port } : null;
    }
    const firstColon = trimmed.indexOf(":");
    if (firstColon === -1) {
        return { hostname: trimmed.toLowerCase(), port: null };
    }
    if (trimmed.indexOf(":", firstColon + 1) !== -1) {
        return { hostname: trimmed.toLowerCase(), port: null };
    }
    const hostname = trimmed.slice(0, firstColon).toLowerCase();
    const port = trimmed.slice(firstColon + 1);
    return hostname && port ? { hostname, port } : null;
}
function defaultPortForOriginProtocol(protocol) {
    if (protocol === "http:") {
        return "80";
    }
    if (protocol === "https:") {
        return "443";
    }
    return null;
}
function isLoopbackAlias(hostname) {
    const normalized = stripIpv6Brackets(hostname).toLowerCase();
    if (normalized === "localhost" || normalized.endsWith(".localhost")) {
        return true;
    }
    if (normalized === "::1" || normalized === "0:0:0:0:0:0:0:1") {
        return true;
    }
    return /^127(?:\.\d{1,3}){3}$/.test(normalized);
}
export function isWebSocketSameOrigin(origin, requestHost) {
    if (!origin || !requestHost) {
        return false;
    }
    if (origin === `http://${requestHost}` || origin === `https://${requestHost}`) {
        return true;
    }
    let originUrl;
    try {
        originUrl = new URL(origin);
    }
    catch {
        return false;
    }
    const originPort = originUrl.port || defaultPortForOriginProtocol(originUrl.protocol);
    if (!originPort) {
        return false;
    }
    const requestAuthority = parseHostAuthority(requestHost);
    if (!requestAuthority) {
        return false;
    }
    const requestPort = requestAuthority.port || defaultPortForOriginProtocol(originUrl.protocol);
    if (originPort !== requestPort) {
        return false;
    }
    return isLoopbackAlias(originUrl.hostname) && isLoopbackAlias(requestAuthority.hostname);
}
function selectWebSocketProtocol(protocols, password) {
    if (!password) {
        return protocols.values().next().value ?? false;
    }
    for (const protocol of protocols) {
        const token = extractWsBearerToken(protocol);
        if (token !== null) {
            return protocol;
        }
    }
    return false;
}
function stringifyCloseReason(reason) {
    if (typeof reason === "string") {
        return reason.length > 0 ? reason : null;
    }
    if (Buffer.isBuffer(reason)) {
        const text = reason.toString();
        return text.length > 0 ? text : null;
    }
    if (reason == null) {
        return null;
    }
    const text = String(reason);
    return text.length > 0 ? text : null;
}
function getControlRpcLogInfo(message) {
    if (message.type === "shutdown_server_request") {
        return {
            requestType: message.type,
            requestId: message.requestId,
            reason: CLIENT_SHUTDOWN_RPC_REASON,
        };
    }
    if (message.type === "restart_server_request") {
        const reason = normalizeClientRestartRpcReason(message.reason);
        return {
            requestType: message.type,
            requestId: message.requestId,
            reason,
        };
    }
    if (message.type === "daemon.update.request") {
        return {
            requestType: message.type,
            requestId: message.requestId,
            reason: "daemon_update",
        };
    }
    return null;
}
function extractRequestInfoFromUnknownWsInbound(payload) {
    if (!payload || typeof payload !== "object") {
        return null;
    }
    const record = payload;
    // Session-wrapped messages
    if (record.type === "session" && record.message && typeof record.message === "object") {
        const msg = record.message;
        if (typeof msg.requestId === "string") {
            return {
                requestId: msg.requestId,
                ...(typeof msg.type === "string" ? { requestType: msg.type } : {}),
            };
        }
    }
    // Non-session messages (future-proof)
    if (typeof record.requestId === "string") {
        return {
            requestId: record.requestId,
            ...(typeof record.type === "string" ? { requestType: record.type } : {}),
        };
    }
    return null;
}
//# sourceMappingURL=websocket-server.js.map