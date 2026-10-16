import type { BrowserToolsBroker } from "./browser-tools/broker.js";
import type { SessionEventSubscription, UsageReportEntry, ProviderUsage } from "@getpaseo/protocol/messages";
import { CreationService } from "./creation/index.js";
import type { MessageReceipts } from "./message-receipts/index.js";
import { SessionDelivery } from "./session/owned-subscriptions/index.js";
import { type ClientCapability } from "@getpaseo/protocol/client-capabilities";
import { type AgentSnapshotPayload, type SessionInboundMessage, type SessionOutboundMessage, type ScriptStatusUpdateMessage, type WorkspaceSetupSnapshot } from "./messages.js";
import type { TerminalManager } from "../terminal/terminal-manager.js";
import type { BinaryFrame } from "@getpaseo/protocol/binary-frames/index";
import type { SpeechToTextProvider, TextToSpeechProvider } from "./speech/speech-provider.js";
import type { TurnDetectionProvider } from "./speech/turn-detection-provider.js";
import type { VoiceCallerContext, VoiceSpeakHandler } from "./voice-types.js";
import type { ScriptHealthState } from "./script-health-monitor.js";
import type { WorkspaceScriptRuntimeStore } from "./workspace-script-runtime-store.js";
import type { DaemonConfigStore } from "./daemon-config-store.js";
import type { WorkspaceGitService } from "./workspace-git-service.js";
import type { ProjectUpdate } from "./workspace-reconciliation-service.js";
import { DirectorySyncService } from "./directory-sync/index.js";
import { type WorkspaceLabelService } from "./workspace-labels/index.js";
import { AgentManager } from "./agent/agent-manager.js";
import { ProviderSnapshotManager } from "./agent/provider-snapshot-manager.js";
import type { ManagedAgent } from "./agent/agent-manager.js";
import type { AgentStorage } from "./agent/agent-storage.js";
import { type PersistedWorkspaceRecord, type ProjectRegistry, type WorkspaceRegistry } from "./workspace-registry.js";
import { type DaemonRuntimeConfig } from "./session/daemon/daemon-session.js";
import type { DaemonWebSocketRuntimeDiagnosticSnapshot } from "./session/daemon/diagnostics.js";
import type { HubRelationshipManagement } from "./hub/relationship-controller.js";
import type { HubExecutionAgents } from "./hub/daemon-executions.js";
import { DownloadTokenStore } from "./file-download/token-store.js";
import type { PushNotifications } from "./push/index.js";
import type { ServiceProxySubsystem } from "./service-proxy.js";
import { renameCurrentBranch as renameCurrentBranchDefault } from "../utils/checkout-git.js";
import type { CheckoutDiffManager } from "./checkout-diff-manager.js";
import type { Resolvable } from "./speech/provider-resolver.js";
import type { SpeechReadinessSnapshot } from "./speech/speech-runtime.js";
import type pino from "pino";
import { ScheduleService } from "./schedule/service.js";
import type { ForgeService } from "../services/forge-service.js";
import { WorkspaceAutoName } from "./workspace-auto-name.js";
import { WorkspaceSetupRuntime } from "./workspace-setup-runtime.js";
import { type DaemonPermission } from "./authorization/index.js";
export declare function resolveWaitForFinishError(options: {
    status: "permission" | "error" | "idle";
    final: AgentSnapshotPayload | null;
}): string | null;
export interface SessionRuntimeMetrics {
    terminalDirectorySubscriptionCount: number;
    terminalSubscriptionCount: number;
    workspaceGitWatchedDirectoryCount: number;
    workspaceGitWorkspaceRecordCount: number;
    workspaceGitSubscriptionCount: number;
    inflightRequests: number;
    peakInflightRequests: number;
}
export interface SessionFileSystem {
    isDirectory(path: string): Promise<boolean>;
}
type AgentMcpTransportFactory = () => Promise<unknown>;
export interface SessionOptions {
    browserToolsBroker?: BrowserToolsBroker | null;
    clientId: string;
    permissions: readonly DaemonPermission[];
    appVersion?: string | null;
    clientCapabilities?: Record<string, unknown> | null;
    onMessage: (msg: SessionOutboundMessage) => void;
    onMessageToSource?: (source: object, msg: SessionOutboundMessage) => void;
    onBinaryMessage?: (frame: Uint8Array) => void;
    onBinaryMessageToSource?: (source: object, frame: Uint8Array) => Promise<void>;
    getTransportBufferedAmount?: (source?: object) => number | null;
    onLifecycleIntent?: (intent: SessionLifecycleIntent) => void;
    onWorkspaceRecovered?: (workspace: PersistedWorkspaceRecord) => Promise<void>;
    publishScriptStatusUpdate?: (message: ScriptStatusUpdateMessage) => void;
    logger: pino.Logger;
    downloadTokenStore: DownloadTokenStore;
    pushNotifications: PushNotifications;
    paseoHome: string;
    worktreesRoot?: string;
    agentManager: AgentManager;
    agentStorage: AgentStorage;
    messageReceipts: Pick<MessageReceipts, "send">;
    creationService: Pick<CreationService, "create" | "subscribe">;
    projectRegistry: ProjectRegistry;
    workspaceRegistry: WorkspaceRegistry;
    directorySync?: DirectorySyncService;
    workspaceLabelService?: WorkspaceLabelService;
    filesystem?: SessionFileSystem;
    scheduleService: ScheduleService;
    checkoutDiffManager: CheckoutDiffManager;
    github?: ForgeService;
    createAgentMcpTransport?: AgentMcpTransportFactory;
    renameCurrentBranch?: typeof renameCurrentBranchDefault;
    workspaceGitService: WorkspaceGitService;
    workspaceAutoName: WorkspaceAutoName;
    daemonConfigStore: DaemonConfigStore;
    pluginRuntime?: {
        before: import("./plugins/lifecycle/index.js").PluginLifecycle["before"];
        emit: import("./plugins/lifecycle/index.js").PluginLifecycle["emit"];
        listPlugins(): Promise<import("@getpaseo/protocol/messages").PluginListItem[]>;
        getLogs(pluginId: string): import("@getpaseo/protocol/messages").PluginLogEntry[];
        installDirectory(input: {
            path: string;
            id?: string;
        }): Promise<import("@getpaseo/protocol/messages").PluginListItem>;
        inspectDirectory(path: string): Promise<{
            id: string;
        }>;
        installSource(input: {
            source: string;
            id?: string;
            ref?: string;
        }): Promise<import("@getpaseo/protocol/messages").PluginListItem>;
        statusSources(pluginId?: string): Promise<import("@getpaseo/protocol/messages").PluginSourceStatusItem[]>;
        previewUpdates(input: {
            pluginId?: string;
            target?: import("@getpaseo/protocol/messages").PluginUpdateSelection;
        }): Promise<import("@getpaseo/protocol/messages").PluginUpdatePreview[]>;
        applyUpdates(proposals: import("@getpaseo/protocol/messages").PluginUpdateProposal[]): Promise<import("@getpaseo/protocol/messages").PluginUpdateResult[]>;
        updateSources(pluginId?: string): Promise<import("@getpaseo/protocol/messages").PluginSourceUpdateItem[]>;
        reloadPlugin(pluginId: string): Promise<import("@getpaseo/protocol/messages").PluginListItem>;
        enablePlugin(pluginId: string): Promise<import("@getpaseo/protocol/messages").PluginListItem>;
        disablePlugin(pluginId: string): Promise<import("@getpaseo/protocol/messages").PluginListItem>;
        removePlugin(pluginId: string): Promise<void>;
        subscribe(listener: (pluginId: string) => void): () => void;
        subscribeSettings?(listener: (pluginId: string, settingsId: string) => void): () => void;
        catalog(): Array<{
            id: string;
            clientBundle: string;
        }>;
        invokePluginRpc(pluginId: string, method: string, input: unknown): Promise<unknown>;
        listUsageReports(options?: {
            forceRefresh?: boolean;
            reportIds?: string[];
        }): Promise<UsageReportEntry[]>;
        listLegacyUsage(): Promise<{
            fetchedAt: string;
            providers: ProviderUsage[];
        }>;
    };
    orchestrationSkills?: import("./orchestration-skills/index.js").OrchestrationSkills;
    mcpBaseUrl?: string | null;
    stt: Resolvable<SpeechToTextProvider | null>;
    sttLanguage?: string;
    tts: Resolvable<TextToSpeechProvider | null>;
    terminalManager: TerminalManager | null;
    providerSnapshotManager: ProviderSnapshotManager;
    hubExecutionAgents?: HubExecutionAgents;
    hubRelationships?: HubRelationshipManagement;
    serviceProxy?: ServiceProxySubsystem;
    scriptRuntimeStore?: WorkspaceScriptRuntimeStore;
    workspaceSetupSnapshots?: Map<string, WorkspaceSetupSnapshot>;
    workspaceSetupRuntime?: WorkspaceSetupRuntime;
    onBranchChanged?: (workspaceId: string, oldBranch: string | null, newBranch: string | null) => void;
    getDaemonTcpPort?: () => number | null;
    getDaemonTcpHost?: () => string | null;
    serviceProxyPublicBaseUrl?: string | null;
    resolveScriptHealth?: (hostname: string) => ScriptHealthState | null;
    voice?: {
        turnDetection?: Resolvable<TurnDetectionProvider | null>;
    };
    voiceBridge?: {
        registerVoiceSpeakHandler?: (agentId: string, handler: VoiceSpeakHandler) => void;
        unregisterVoiceSpeakHandler?: (agentId: string) => void;
        registerVoiceCallerContext?: (agentId: string, context: VoiceCallerContext) => void;
        unregisterVoiceCallerContext?: (agentId: string) => void;
    };
    dictation?: {
        finalTimeoutMs?: number;
        stt?: Resolvable<SpeechToTextProvider | null>;
        sttLanguage?: string;
        getSpeechReadiness?: () => SpeechReadinessSnapshot;
    };
    serverId?: string;
    daemonVersion?: string;
    daemonRuntimeConfig?: DaemonRuntimeConfig;
    getWebSocketRuntimeMetrics?: () => DaemonWebSocketRuntimeDiagnosticSnapshot | null;
}
export type SessionLifecycleIntent = {
    type: "shutdown";
    clientId: string;
    requestId: string;
    reason: string;
} | {
    type: "restart";
    clientId: string;
    requestId: string;
    reason: string;
};
interface ClientActivity {
    deviceType: "web" | "mobile";
    focusedAgentId: string | null;
    focusedTerminalId: string | null;
    lastActivityAt: Date;
    appVisible: boolean;
    appVisibilityChangedAt: Date;
}
export declare class Session {
    readonly delivery: SessionDelivery;
    private readonly browserToolsBroker;
    private readonly clientId;
    private readonly authorization;
    private appVersion;
    private clientCapabilities;
    private readonly sessionId;
    private readonly onMessage;
    private readonly onMessageToSource;
    private readonly onBinaryMessage;
    private readonly onBinaryMessageToSource;
    private readonly getTransportBufferedAmount;
    private readonly onLifecycleIntent;
    private readonly onWorkspaceRecovered;
    private readonly sessionLogger;
    private readonly paseoHome;
    private readonly projectIcons;
    private readonly worktreesRoot;
    private readonly rewindInitiators;
    private agentManager;
    private readonly agentStorage;
    private readonly projectRegistry;
    private readonly workspaceRegistry;
    private readonly directorySync;
    private readonly filesystem;
    private readonly github;
    private readonly renameCurrentBranch;
    private readonly workspaceGitService;
    private readonly workspaceAutoName;
    private readonly gitMutation;
    private readonly workspaceProvisioning;
    private readonly workspaceRecovery;
    private readonly daemonConfigStore;
    private readonly pushNotifications;
    private readonly pluginRuntime;
    private readonly orchestrationSkills;
    private unsubscribeAgentEvents;
    private unsubscribeProjectMutations;
    private unsubscribePluginChanges;
    private unsubscribeWorkspaceMutations;
    private registryMutationQueue;
    private projectUpdateQueue;
    private isCleanedUp;
    private readonly timelineSubscriptions;
    private readonly clientSources;
    private unsubscribeTerminalWorkspaceContributionEvents;
    private readonly agentUpdates;
    private readonly workspaceUpdatesSubscriptions;
    private readonly workspaceLabelService;
    private readonly eventSubscriptions;
    private readonly workspaceUpdateTails;
    private readonly terminalManager;
    private readonly providerSnapshotManager;
    private readonly serviceProxy;
    private readonly scriptRuntimeStore;
    private readonly getDaemonTcpPort;
    private readonly getDaemonTcpHost;
    private readonly serviceProxyPublicBaseUrl;
    private readonly resolveScriptHealth;
    private readonly terminalController;
    private inflightRequests;
    private peakInflightRequests;
    private readonly workspaceSetupSnapshots;
    private readonly workspaceSetupRuntime;
    private readonly workspaceGitObserver;
    private readonly workspaceDirectory;
    private readonly voiceSessions;
    private readonly checkoutSession;
    private readonly scheduleSession;
    private readonly providerCatalogSession;
    private readonly usageSession;
    private readonly workspaceFilesSession;
    private readonly agentConfigSession;
    private readonly projectConfigSession;
    private readonly daemonSession;
    private readonly hubExecutionController;
    private readonly workspaceScripts;
    private readonly messageReceipts;
    private readonly createAgentLifecycleDispatch;
    private readonly creationService;
    constructor(options: SessionOptions);
    updateAppVersion(appVersion: string | null): void;
    updateClientCapabilities(capabilities: Record<string, unknown> | null, source?: object, appVersion?: string | null): void;
    clearAgentTimelineSubscription(source: object): void;
    private subscribeAgentTimelines;
    private supportsTimelineItem;
    private forwardAgentStream;
    supports(capability: ClientCapability): boolean;
    supportsForSource(capability: ClientCapability, source: object): boolean;
    emitProjectUpdate(update: ProjectUpdate): Promise<void>;
    private publishProjectUpdate;
    syncWorkspaceGitObserverForWorkspace(workspace: PersistedWorkspaceRecord): Promise<void>;
    emitWorkspaceUpdateForWorkspaceId(workspaceId: string): Promise<void>;
    private emitCreatedWorkspaceUpdate;
    markWorkspaceArchivingForExternalMutation(workspaceIds: Iterable<string>, archivingAt: string): void;
    clearWorkspaceArchivingForExternalMutation(workspaceIds: Iterable<string>): void;
    emitWorkspaceUpdatesForExternalWorkspaceIds(workspaceIds: Iterable<string>): Promise<void>;
    syncWorkspaceGitObserversForExternalWorkspaceIds(workspaceIds: Iterable<string>): Promise<void>;
    warmWorkspaceGitDataForWorkspace(workspace: PersistedWorkspaceRecord): Promise<void>;
    refreshRecoveredWorkspaceForExternalMutation(workspace: PersistedWorkspaceRecord): Promise<void>;
    /**
     * Get the client's current activity state
     */
    private currentClientMetadata;
    getClientActivity(source?: object | undefined): ClientActivity | null;
    private getFocusedAgentSelectionForCwd;
    private readStructuredGenerationDaemonConfig;
    getRuntimeMetrics(): SessionRuntimeMetrics;
    emitServerMessage(message: SessionOutboundMessage): void;
    /**
     * Send initial state to client after connection
     */
    sendInitialState(): Promise<void>;
    /**
     * Interrupt the agent's active run so the next prompt starts a fresh turn.
     * Returns once the manager confirms the stream has been cancelled.
     */
    private interruptAgentIfRunning;
    private hasActiveAgentRun;
    private handleAgentRunError;
    /**
     * Subscribe to AgentManager events and forward them to the client
     */
    private refreshObservationProducers;
    private refreshWorkspaceProducers;
    private refreshCatalogProducers;
    private enqueueRegistryMutation;
    private handleWorkspaceMutation;
    private syncWorkspaceMutationObserver;
    private handleProjectMutation;
    private handleProjectMutationForSubscription;
    private supportsSubagentTimelineItem;
    private forwardProviderSubagentUpdate;
    private subscribeToAgentEvents;
    private emitProviderSubagentWorkspaceUpdate;
    private buildAgentStreamPayload;
    private enrichAgentPayload;
    private buildAgentPayload;
    private buildStoredAgentPayload;
    private isProviderVisibleToClient;
    private buildProjectPlacementForWorkspace;
    private buildProjectPlacementForWorkspaceId;
    /**
     * Main entry point for processing session messages
     */
    handleMessage(msg: SessionInboundMessage, source?: object): Promise<void>;
    private handleRequest;
    setPermissions(permissions: readonly DaemonPermission[]): void;
    getPermissions(): DaemonPermission[];
    allowsInbound(message: SessionInboundMessage): boolean;
    allowsPermission(permission: DaemonPermission): boolean;
    subscribesToAgent(agent: ManagedAgent, source: object): Promise<boolean>;
    subscribesToTerminalDirectory(input: {
        cwd: string;
        workspaceId?: string;
    }, source: object): Promise<boolean>;
    publishToSource(source: object, message: SessionOutboundMessage): void;
    wantsSourceEvent(source: object, event: SessionEventSubscription): boolean;
    wantsSourceNotification(source: object, event: SessionEventSubscription): boolean;
    publish(message: SessionOutboundMessage): void;
    private registerBrowserHost;
    private dispatchSubscriptionMessage;
    private dispatchInboundMessage;
    private dispatchWorkspaceLifecycleMessage;
    private dispatchOrchestrationSkillsMessage;
    private dispatchPluginMessage;
    private dispatchPluginDirectoryMessage;
    private subscribeToPluginChanges;
    private dispatchVoiceAndControlMessage;
    private dispatchAgentRewindMessage;
    private dispatchAgentRelationshipMessage;
    private dispatchAgentTimelineMessage;
    private dispatchHubExecutionMessage;
    private dispatchCreationMessage;
    private dispatchAgentLifecycleMessage;
    private dispatchAgentConfigMessage;
    private dispatchCheckoutMessage;
    private dispatchWorkspaceAndProjectMessage;
    private dispatchWorkspaceSetupMessage;
    private dispatchWorkspaceLabelMessage;
    private dispatchWorkspaceFileMessage;
    private dispatchWorkspaceStateMessage;
    private dispatchProviderMessage;
    private dispatchTerminalMessage;
    private dispatchScheduleMessage;
    private dispatchMiscMessage;
    resetPeakInflight(): void;
    getSessionId(): string;
    handleBinaryFrame(binaryFrame: BinaryFrame, source: object): Promise<void>;
    private handleRestartServerRequest;
    private handleShutdownServerRequest;
    private emitLifecycleIntent;
    private handleDeleteAgentRequest;
    private handleArchiveAgentRequest;
    private archiveAgentForClose;
    private handleDetachAgentRequest;
    private handleCloseItemsRequest;
    private unarchiveAgentByHandle;
    private handleUpdateAgentRequest;
    private handleProjectRenameRequest;
    private handleProjectIconSetRequest;
    private handleProjectIconGetRequest;
    private handleProjectRemoveRequest;
    private handleWorkspaceTitleSetRequest;
    private handleWorkspacePinSetRequest;
    private handleWorkspaceRecoveryInspectRequest;
    private handleWorkspaceRecoveryRestoreRequest;
    /**
     * Handle text message to agent (with optional image attachments)
     */
    private handleSendAgentMessage;
    /**
     * Handle create agent request
     */
    private creationUpdate;
    private handleCreationSubscription;
    private creationResourceExists;
    private createRequestedAgent;
    private handleAgentCreation;
    private handleWorkspaceCreation;
    private handleCreateAgentRequest;
    private createSessionAgent;
    private resolveSessionCreateAgentIntent;
    private handleResumeAgentRequest;
    private handleImportAgentRequest;
    private handleRefreshAgentRequest;
    private handleCancelAgentRequest;
    private handleAgentRewindRequest;
    private deliverTimelineReplacement;
    private emitReconstructedTimelineRows;
    private buildAgentSessionConfig;
    private isPathWithinRoot;
    /**
     * Handle clearing agent attention flag
     */
    private handleClearAgentAttention;
    /**
     * Handle client heartbeat for activity tracking
     */
    private handleClientHeartbeat;
    private clearFocusedTerminalAttention;
    /**
     * Handle push token registration
     */
    private handleRegisterPushToken;
    /**
     * Handle list commands request for an agent
     */
    private handleListCommandsRequest;
    /**
     * Handle agent permission response from user
     */
    private handleAgentPermissionResponse;
    private handleDirectorySuggestionsRequest;
    private handlePaseoWorktreeListRequest;
    private handlePaseoWorktreeArchiveRequest;
    private listTerminalActivityContributions;
    /**
     * Build the current agent list payload (live + persisted), optionally filtered by labels.
     */
    private listAgentPayloads;
    private resolveAgentIdentifier;
    private getAgentPayloadById;
    private resolveDelegationRootWorkspaceId;
    private buildActiveProjectPlacementsByWorkspaceId;
    private collectFetchAgentsEntries;
    private listFetchAgentsEntries;
    private readonly agentsPager;
    private decodeAgentCursor;
    private describeWorkspaceRecord;
    private buildWorkspaceGitRuntimePayload;
    private buildWorkspaceGitHubRuntimePayload;
    private describeWorkspaceRecordWithGitData;
    private describeCreatedWorktreeWorkspace;
    private buildWorkspaceDescriptor;
    markWorkspaceArchiving(workspaceIds: Iterable<string>, archivingAt: string): void;
    clearWorkspaceArchiving(workspaceIds: Iterable<string>): void;
    private buildWorkspaceDescriptorMap;
    private findWorkspaceIdForCwd;
    private matchesWorkspaceFilter;
    private listFetchWorkspacesEntries;
    private bufferOrEmitWorkspaceUpdate;
    private flushBootstrappedWorkspaceUpdates;
    private buildProjectDescriptor;
    private restoreWorkspaceAndEmit;
    private restoreOwningWorkspaceForLegacyAgentRefresh;
    private createPaseoWorktree;
    private listActiveWorkspaceRefs;
    private archiveWorkspaceRecord;
    private teardownArchivedWorkspace;
    private emitWorkspaceUpdatesForWorkspaceIds;
    private enqueueWorkspaceUpdates;
    private emitWorkspaceUpdateBatch;
    private applyOptimisticWorkspaceStatus;
    private shouldSkipWorkspaceRemoval;
    private buildWorkspaceRemoveUpdatePayload;
    private resolveProjectWithoutActiveWorkspacesForArchivedWorkspace;
    private emitWorkspaceUpdateForTerminalContribution;
    private emitWorkspaceUpdateForCwd;
    private handleFetchAgents;
    private handleFetchAgentHistory;
    private handleFetchRecentProviderSessions;
    private handleFetchWorkspacesRequest;
    private handleProjectListRequest;
    private requireWorkspaceLabels;
    private emitWorkspaceLabelError;
    private handleWorkspaceLabelList;
    private handleWorkspaceLabelAssignment;
    private handleWorkspaceLabelUpdate;
    private handleWorkspaceLabelDelete;
    private handleWorkspaceLabelDeleteInspection;
    private readAgentDirectorySync;
    private readWorkspaceDirectorySync;
    private buildBootstrapSnapshot;
    private reconcileWorkspaceGitObservers;
    private seedWorkspaceSubscriptionSnapshot;
    private registerWorkspaceForImportedAgent;
    private createRequestedWorkspace;
    private handleWorkspaceCreateLocal;
    private handleWorkspaceCreateWorktree;
    private handleOpenProjectRequest;
    private handleProjectAddRequest;
    private handleProjectCreateDirectoryRequest;
    private handleWorkspaceGithubSearchRepositoriesRequest;
    private handleProjectGithubCloneRequest;
    private buildWorkspaceScriptPayloadSnapshot;
    private handleStartWorkspaceScriptRequest;
    private handleWorkspaceScriptListRequest;
    private handleWorkspaceScriptStartRequest;
    private handleWorkspaceScriptStopRequest;
    private handleLegacyListAvailableEditorsRequest;
    private handleLegacyOpenInEditorRequest;
    private handleCreatePaseoWorktreeRequest;
    private createPaseoWorktreeWorkflow;
    private handleWorkspaceSetupStatusRequest;
    private handleWorkspaceSetupRunRequest;
    private handleArchiveWorkspaceRequest;
    private handleWorkspaceClearAttentionRequest;
    private handleWorkspaceMarkUnreadRequest;
    private handleFetchAgent;
    private handleFetchAgentTimelineRequest;
    private handleAgentTimelineAppendRequest;
    private handleAgentTimelineSearchRequest;
    private handleAgentTimelineListPromptsRequest;
    private handleProviderSubagentListRequest;
    private handleProviderSubagentTimelineRequest;
    private handleAgentForkContextRequest;
    private prepareAgentMessage;
    private handleSendAgentMessageRequest;
    private handleWaitForFinish;
    /**
     * Emit a message to the client
     */
    private wantsEvent;
    private emitEventToOwner;
    private emitSubscribedEvent;
    private emit;
    private workspaceSetupMessageForClient;
    private emitBinary;
    private emitBinaryForFileTransfer;
    private emitForSource;
    /**
     * Clean up session resources
     */
    cleanup(): Promise<void>;
}
export {};
//# sourceMappingURL=session.d.ts.map