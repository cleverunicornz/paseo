import { createHash } from "node:crypto";
import { getErrorMessage } from "@getpaseo/protocol/error-utils";
import { compactProviderSnapshot } from "@getpaseo/protocol/provider-snapshot-codec";
import { isGlobalProviderSnapshotKey, resolveSnapshotCwd, sameSnapshotRecords, } from "../../agent/provider-snapshot-manager.js";
import { filterSelectableAgentModels, } from "../../agent/agent-sdk-types.js";
import { expandTilde } from "../../../utils/path.js";
// COMPAT(customModeIcons): the only mode icons known to clients before v0.1.84. Any
// other icon name is downgraded to "ShieldCheck" for those clients.
const LEGACY_MODE_ICONS = new Set([
    "ShieldCheck",
    "ShieldAlert",
    "ShieldOff",
    "ShieldQuestionMark",
]);
/**
 * A client's provider catalog surface: model / mode / feature listing, the providers
 * snapshot push + pull, and provider diagnostics. The snapshot PUSH (start) and
 * every PULL handler gate visibility and downgrade mode icons through the SAME predicates,
 * so an older client sees one consistent provider set across both paths — the COMPAT
 * invariant the shell could only enforce by code proximity before this carve.
 */
export class ProviderCatalogSession {
    constructor(options) {
        this.unsubscribeSnapshotEvents = null;
        this.host = options.host;
        this.providerSnapshotManager = options.providerSnapshotManager;
        this.logger = options.logger;
    }
    get isObserving() {
        return this.unsubscribeSnapshotEvents !== null;
    }
    start() {
        if (this.unsubscribeSnapshotEvents)
            return;
        const handleProviderSnapshotChange = (transition) => {
            this.host.publishSnapshot(() => {
                const previous = this.visibleSnapshot(transition.previous);
                const current = this.visibleSnapshot(transition.current);
                if (sameSnapshotRecords(previous.records, current.records))
                    return null;
                return { type: "providers_snapshot_update", payload: this.snapshotPayload(current) };
            });
        };
        this.providerSnapshotManager.on("change", handleProviderSnapshotChange);
        this.unsubscribeSnapshotEvents = () => {
            this.providerSnapshotManager.off("change", handleProviderSnapshotChange);
        };
    }
    dispose() {
        if (this.unsubscribeSnapshotEvents) {
            this.unsubscribeSnapshotEvents();
            this.unsubscribeSnapshotEvents = null;
        }
    }
    // COMPAT(customModeIcons): rewrite icons unknown to v0.1.83 clients (whose MODE_ICONS
    // map is a closed enum and would render `undefined`, crashing in render). Drop
    // this and the cap gate when floor >= v0.1.84.
    downgradeModeIconsForClient(modes, customModeIcons = this.host.supportsCustomModeIcons()) {
        if (customModeIcons)
            return modes;
        return modes.map((mode) => mode.icon && !LEGACY_MODE_ICONS.has(mode.icon) ? { ...mode, icon: "ShieldCheck" } : mode);
    }
    visibleSnapshot(snapshot) {
        // COMPAT(providersSnapshot): use the shell's current visibility policy for both sides.
        return {
            ...snapshot,
            records: snapshot.records.filter(({ entry }) => this.host.isProviderVisibleToClient(entry.provider)),
        };
    }
    snapshotPayload(snapshot, request) {
        const { records } = snapshot;
        const customModeIcons = this.host.supportsCustomModeIcons();
        const compact = this.host.supportsCompactProviderSnapshots();
        const references = this.host.supportsProviderSnapshotReferences();
        const envelope = {
            ...(!isGlobalProviderSnapshotKey(snapshot.cwd) ? { cwd: snapshot.cwd } : {}),
            generatedAt: new Date().toISOString(),
        };
        const clientEntries = () => records.map(({ entry }) => entry.modes && !customModeIcons
            ? { ...entry, modes: this.downgradeModeIconsForClient(entry.modes, customModeIcons) }
            : entry);
        if (!compact) {
            return { ...envelope, entries: clientEntries() };
        }
        // COMPAT(providerSnapshotReferences): added in v0.7.2, remove legacy full
        // pushes and embedded freshness after 2027-03-06 once the client floor supports references.
        const snapshotHash = createHash("sha256")
            .update(JSON.stringify([
            "paseo.providers-snapshot/1",
            references ? "references" : "embedded",
            customModeIcons ? "icons" : "legacy-icons",
            records.map(({ entry, contentHash }) => [
                entry.provider,
                contentHash,
                references ? null : (entry.fetchedAt ?? null),
            ]),
        ]))
            .digest("base64url");
        const fetchedAt = references
            ? Object.fromEntries(records.flatMap(({ entry }) => entry.fetchedAt ? [[entry.provider, entry.fetchedAt]] : []))
            : undefined;
        const identified = { ...envelope, entries: [], snapshotHash, fetchedAt };
        if (request && request.ifNoneMatch === snapshotHash) {
            return { ...identified, notModified: true };
        }
        if (!request && references)
            return identified;
        const entries = clientEntries();
        const content = references
            ? entries.map(({ fetchedAt: _fetchedAt, ...entry }) => entry)
            : entries;
        return { ...identified, compactSnapshot: compactProviderSnapshot(content) };
    }
    emitProviderDisabledResponse(kind, provider, requestId, fetchedAt) {
        const payload = {
            provider,
            error: `Provider ${provider} is disabled`,
            fetchedAt,
            requestId,
        };
        if (kind === "models") {
            this.host.emit({ type: "list_provider_models_response", payload });
        }
        else {
            this.host.emit({ type: "list_provider_modes_response", payload });
        }
    }
    async handleListProviderModelsRequest(msg) {
        const cwd = resolveCatalogRequestCwd(msg.cwd);
        const fetchedAt = new Date().toISOString();
        const entry = await this.getProviderSnapshotEntryForRead(cwd, msg.provider);
        if (!entry) {
            this.host.emit({
                type: "list_provider_models_response",
                payload: {
                    provider: msg.provider,
                    error: `Unknown provider: ${msg.provider}`,
                    fetchedAt,
                    requestId: msg.requestId,
                },
            });
            return;
        }
        if (!entry.enabled) {
            this.emitProviderDisabledResponse("models", msg.provider, msg.requestId, fetchedAt);
            return;
        }
        if (entry.status === "ready") {
            this.host.emit({
                type: "list_provider_models_response",
                payload: {
                    provider: msg.provider,
                    models: filterSelectableAgentModels(entry.models),
                    error: null,
                    fetchedAt: entry.fetchedAt ?? fetchedAt,
                    requestId: msg.requestId,
                },
            });
            return;
        }
        const errorMessage = entry.status === "error"
            ? (entry.error ?? `Failed to list models for ${msg.provider}`)
            : `Provider ${msg.provider} is not available`;
        this.host.emit({
            type: "list_provider_models_response",
            payload: {
                provider: msg.provider,
                error: errorMessage,
                fetchedAt,
                requestId: msg.requestId,
            },
        });
    }
    async handleListProviderModesRequest(msg) {
        const fetchedAt = new Date().toISOString();
        const cwd = resolveCatalogRequestCwd(msg.cwd);
        const entry = await this.getProviderSnapshotEntryForRead(cwd, msg.provider);
        if (!entry) {
            this.host.emit({
                type: "list_provider_modes_response",
                payload: {
                    provider: msg.provider,
                    error: `Unknown provider: ${msg.provider}`,
                    fetchedAt,
                    requestId: msg.requestId,
                },
            });
            return;
        }
        if (!entry.enabled) {
            this.emitProviderDisabledResponse("modes", msg.provider, msg.requestId, fetchedAt);
            return;
        }
        if (entry.status === "ready") {
            this.host.emit({
                type: "list_provider_modes_response",
                payload: {
                    provider: msg.provider,
                    modes: this.downgradeModeIconsForClient(entry.modes ?? []),
                    error: null,
                    fetchedAt: entry.fetchedAt ?? fetchedAt,
                    requestId: msg.requestId,
                },
            });
            return;
        }
        const errorMessage = entry.status === "error"
            ? (entry.error ?? `Failed to list modes for ${msg.provider}`)
            : `Provider ${msg.provider} is not available`;
        this.host.emit({
            type: "list_provider_modes_response",
            payload: {
                provider: msg.provider,
                error: errorMessage,
                fetchedAt,
                requestId: msg.requestId,
            },
        });
    }
    async getProviderSnapshotEntryForRead(cwd, provider) {
        const manager = this.providerSnapshotManager;
        const findEntry = () => manager.getSnapshot(cwd).records.find(({ entry }) => entry.provider === provider)?.entry;
        let entry = findEntry();
        if (entry && !entry.enabled) {
            return entry;
        }
        if (!entry || entry.status === "loading") {
            // Awaits the in-flight warmup (deduped per-cwd) so old clients still get
            // a resolved answer rather than a loading placeholder.
            await manager.warmUpSnapshotForCwd({ cwd, providers: [provider] });
            entry = findEntry();
        }
        return entry;
    }
    buildDraftAgentSessionConfig(draftConfig) {
        return {
            provider: draftConfig.provider,
            cwd: expandTilde(draftConfig.cwd),
            ...(draftConfig.modeId ? { modeId: draftConfig.modeId } : {}),
            ...(draftConfig.model ? { model: draftConfig.model } : {}),
            ...(draftConfig.thinkingOptionId ? { thinkingOptionId: draftConfig.thinkingOptionId } : {}),
            ...(draftConfig.featureValues ? { featureValues: draftConfig.featureValues } : {}),
        };
    }
    async handleListProviderFeaturesRequest(msg) {
        const fetchedAt = new Date().toISOString();
        try {
            const sessionConfig = this.buildDraftAgentSessionConfig(msg.draftConfig);
            const features = await this.host.listDraftFeatures(sessionConfig);
            this.host.emit({
                type: "list_provider_features_response",
                payload: {
                    provider: msg.draftConfig.provider,
                    features,
                    error: null,
                    fetchedAt,
                    requestId: msg.requestId,
                },
            });
        }
        catch (error) {
            this.logger.error({ err: error, provider: msg.draftConfig.provider, draftConfig: msg.draftConfig }, `Failed to list features for ${msg.draftConfig.provider}`);
            this.host.emit({
                type: "list_provider_features_response",
                payload: {
                    provider: msg.draftConfig.provider,
                    error: getErrorMessage(error),
                    fetchedAt,
                    requestId: msg.requestId,
                },
            });
        }
    }
    async handleListAvailableProvidersRequest(msg) {
        const fetchedAt = new Date().toISOString();
        try {
            const providers = (await this.host.listProviderAvailability()).filter((provider) => this.host.isProviderVisibleToClient(provider.provider));
            this.host.emit({
                type: "list_available_providers_response",
                payload: {
                    providers,
                    error: null,
                    fetchedAt,
                    requestId: msg.requestId,
                },
            });
        }
        catch (error) {
            this.logger.error({ err: error }, "Failed to list provider availability");
            this.host.emit({
                type: "list_available_providers_response",
                payload: {
                    providers: [],
                    error: getErrorMessage(error),
                    fetchedAt,
                    requestId: msg.requestId,
                },
            });
        }
    }
    async handleGetProvidersSnapshotRequest(msg) {
        const cwd = msg.cwd?.trim() ? resolveSnapshotCwd(expandTilde(msg.cwd)) : undefined;
        const snapshot = this.visibleSnapshot(this.providerSnapshotManager.getSnapshot(cwd));
        this.host.emit({
            type: "get_providers_snapshot_response",
            payload: {
                ...this.snapshotPayload(snapshot, { ifNoneMatch: msg.ifNoneMatch }),
                requestId: msg.requestId,
            },
        });
    }
    async handleRefreshProvidersSnapshotRequest(msg) {
        if (msg.cwd) {
            await this.providerSnapshotManager.refreshSnapshotForCwd({
                cwd: expandTilde(msg.cwd),
                providers: msg.providers,
            });
        }
        else {
            await this.providerSnapshotManager.refreshSettingsSnapshot({
                providers: msg.providers,
            });
        }
        this.host.emit({
            type: "refresh_providers_snapshot_response",
            payload: {
                acknowledged: true,
                requestId: msg.requestId,
            },
        });
    }
    async handleProviderDiagnosticRequest(msg) {
        try {
            const { diagnostic } = await this.providerSnapshotManager.getProviderDiagnostic(msg.provider);
            this.host.emit({
                type: "provider_diagnostic_response",
                payload: {
                    provider: msg.provider,
                    diagnostic,
                    requestId: msg.requestId,
                },
            });
        }
        catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            this.logger.error({ err, provider: msg.provider }, `Failed to get provider diagnostic for ${msg.provider}`);
            this.host.emit({
                type: "rpc_error",
                payload: {
                    requestId: msg.requestId,
                    requestType: msg.type,
                    error: `Failed to get provider diagnostic: ${err.message}`,
                    code: "provider_diagnostic_failed",
                },
            });
        }
    }
}
function resolveCatalogRequestCwd(cwd) {
    const trimmed = cwd?.trim();
    return trimmed ? expandTilde(trimmed) : undefined;
}
//# sourceMappingURL=provider-catalog-session.js.map