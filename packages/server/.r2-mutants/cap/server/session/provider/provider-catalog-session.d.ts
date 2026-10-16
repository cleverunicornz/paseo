import type pino from "pino";
import type { SessionInboundMessage, SessionOutboundMessage } from "../../messages.js";
import { type ProviderSnapshotManager } from "../../agent/provider-snapshot-manager.js";
import { type AgentFeature, type AgentSessionConfig } from "../../agent/agent-sdk-types.js";
import type { ProviderAvailability } from "../../agent/agent-manager.js";
/**
 * The collaborators a provider-catalog request reaches that are NOT part of the
 * provider domain. Two are CLIENT-COMPAT predicates the Session shell owns because
 * agent-lifecycle shares the visibility gate: both read client state (appVersion /
 * capabilities) LIVE, mutated post-construction via updateAppVersion /
 * updateClientCapabilities. The two agent-control reads expose provider availability
 * and draft features the AgentManager owns.
 */
export interface ProviderCatalogSessionHost {
    emit(msg: SessionOutboundMessage): void;
    isProviderVisibleToClient(provider: string): boolean;
    supportsCustomModeIcons(): boolean;
    supportsCompactProviderSnapshots(): boolean;
    supportsProviderSnapshotReferences(): boolean;
    publishSnapshot(project: () => SessionOutboundMessage | null): void;
    listProviderAvailability(): Promise<ProviderAvailability[]>;
    listDraftFeatures(config: AgentSessionConfig): Promise<AgentFeature[]>;
}
export interface ProviderCatalogSessionOptions {
    host: ProviderCatalogSessionHost;
    providerSnapshotManager: ProviderSnapshotManager;
    logger: pino.Logger;
}
/**
 * A client's provider catalog surface: model / mode / feature listing, the providers
 * snapshot push + pull, and provider diagnostics. The snapshot PUSH (start) and
 * every PULL handler gate visibility and downgrade mode icons through the SAME predicates,
 * so an older client sees one consistent provider set across both paths — the COMPAT
 * invariant the shell could only enforce by code proximity before this carve.
 */
export declare class ProviderCatalogSession {
    private readonly host;
    private readonly providerSnapshotManager;
    private readonly logger;
    private unsubscribeSnapshotEvents;
    constructor(options: ProviderCatalogSessionOptions);
    get isObserving(): boolean;
    start(): void;
    dispose(): void;
    private downgradeModeIconsForClient;
    private visibleSnapshot;
    private snapshotPayload;
    private emitProviderDisabledResponse;
    handleListProviderModelsRequest(msg: Extract<SessionInboundMessage, {
        type: "list_provider_models_request";
    }>): Promise<void>;
    handleListProviderModesRequest(msg: Extract<SessionInboundMessage, {
        type: "list_provider_modes_request";
    }>): Promise<void>;
    private getProviderSnapshotEntryForRead;
    private buildDraftAgentSessionConfig;
    handleListProviderFeaturesRequest(msg: Extract<SessionInboundMessage, {
        type: "list_provider_features_request";
    }>): Promise<void>;
    handleListAvailableProvidersRequest(msg: Extract<SessionInboundMessage, {
        type: "list_available_providers_request";
    }>): Promise<void>;
    handleGetProvidersSnapshotRequest(msg: Extract<SessionInboundMessage, {
        type: "get_providers_snapshot_request";
    }>): Promise<void>;
    handleRefreshProvidersSnapshotRequest(msg: Extract<SessionInboundMessage, {
        type: "refresh_providers_snapshot_request";
    }>): Promise<void>;
    handleProviderDiagnosticRequest(msg: Extract<SessionInboundMessage, {
        type: "provider_diagnostic_request";
    }>): Promise<void>;
}
//# sourceMappingURL=provider-catalog-session.d.ts.map