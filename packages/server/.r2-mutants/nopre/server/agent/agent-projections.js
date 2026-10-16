import { isStoredAgentProviderAvailable, resolveStoredAgentUpdatedAt, toAgentPersistenceHandle, } from "../persistence-hooks.js";
function normalizeThinkingOptionId(value) {
    if (typeof value !== "string")
        return null;
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
}
function normalizeLabels(labels) {
    if (!labels) {
        return {};
    }
    return Object.fromEntries(Object.entries(labels).filter((entry) => typeof entry[1] === "string"));
}
export function resolveEffectiveThinkingOptionId(options) {
    const runtimeInfo = options.runtimeInfo;
    if (runtimeInfo && "thinkingOptionId" in runtimeInfo) {
        return normalizeThinkingOptionId(runtimeInfo.thinkingOptionId);
    }
    return normalizeThinkingOptionId(options.configuredThinkingOptionId);
}
export function toStoredAgentRecord(agent, options) {
    const createdAt = options?.createdAt ?? agent.createdAt.toISOString();
    const config = buildSerializableConfig(agent.config);
    const persistence = sanitizePersistenceHandle(agent.persistence);
    const runtimeInfo = sanitizeRuntimeInfo(agent.runtimeInfo);
    return {
        id: agent.id,
        provider: agent.provider,
        cwd: agent.cwd,
        workspaceId: agent.workspaceId,
        createdAt,
        updatedAt: agent.updatedAt.toISOString(),
        lastActivityAt: agent.updatedAt.toISOString(),
        lastUserMessageAt: agent.lastUserMessageAt ? agent.lastUserMessageAt.toISOString() : null,
        title: options?.title ?? null,
        labels: agent.labels,
        lastStatus: agent.lifecycle,
        lastModeId: agent.currentModeId ?? config?.modeId ?? null,
        config: config ?? null,
        runtimeInfo,
        features: normalizeFeatures(agent.features),
        persistence,
        lastError: agent.lastError ?? undefined,
        requiresAttention: agent.attention.requiresAttention,
        attentionReason: agent.attention.requiresAttention ? agent.attention.attentionReason : null,
        attentionTimestamp: agent.attention.requiresAttention
            ? agent.attention.attentionTimestamp.toISOString()
            : null,
        internal: options?.internal,
        owner: agent.owner,
    };
}
export function toAgentPayload(agent, options) {
    const runtimeInfo = sanitizeRuntimeInfo(agent.runtimeInfo);
    const thinkingOptionId = agent.config.thinkingOptionId ?? null;
    const effectiveThinkingOptionId = resolveEffectiveThinkingOptionId({
        runtimeInfo,
        configuredThinkingOptionId: thinkingOptionId,
    });
    const payload = {
        id: agent.id,
        provider: agent.provider,
        cwd: agent.cwd,
        ...(agent.workspaceId ? { workspaceId: agent.workspaceId } : {}),
        model: agent.config.model ?? null,
        thinkingOptionId,
        effectiveThinkingOptionId,
        ...(runtimeInfo ? { runtimeInfo } : {}),
        createdAt: agent.createdAt.toISOString(),
        updatedAt: agent.updatedAt.toISOString(),
        lastUserMessageAt: agent.lastUserMessageAt ? agent.lastUserMessageAt.toISOString() : null,
        status: agent.lifecycle,
        activeTurn: agent.activeTurnId
            ? {
                turnId: agent.activeTurnId,
                startedAt: agent.activeTurnStartedAt?.toISOString() ?? null,
            }
            : null,
        capabilities: cloneCapabilities(agent.capabilities),
        currentModeId: agent.currentModeId,
        availableModes: cloneAvailableModes(agent.availableModes),
        features: normalizeFeatures(agent.features),
        pendingPermissions: sanitizePendingPermissions(agent.pendingPermissions),
        persistence: projectPersistenceHandleForWire(agent.persistence),
        title: options?.title ?? null,
        labels: agent.labels,
    };
    const usage = sanitizeUsage(agent.lastUsage);
    if (usage !== undefined) {
        payload.lastUsage = usage;
    }
    if (agent.lastError !== undefined) {
        payload.lastError = agent.lastError;
    }
    // Handle attention state
    payload.requiresAttention = agent.attention.requiresAttention;
    if (agent.attention.requiresAttention) {
        payload.attentionReason = agent.attention.attentionReason;
        payload.attentionTimestamp = agent.attention.attentionTimestamp.toISOString();
    }
    else {
        payload.attentionReason = null;
        payload.attentionTimestamp = null;
    }
    return payload;
}
function buildStoredRuntimeInfo(record) {
    if (!record.runtimeInfo)
        return undefined;
    const ri = record.runtimeInfo;
    const runtimeInfo = {
        provider: ri.provider,
        sessionId: ri.sessionId,
    };
    if (Object.prototype.hasOwnProperty.call(ri, "model")) {
        runtimeInfo.model = ri.model ?? null;
    }
    if (Object.prototype.hasOwnProperty.call(ri, "thinkingOptionId")) {
        runtimeInfo.thinkingOptionId = ri.thinkingOptionId ?? null;
    }
    if (Object.prototype.hasOwnProperty.call(ri, "modeId")) {
        runtimeInfo.modeId = ri.modeId ?? null;
    }
    if (ri.extra) {
        runtimeInfo.extra = ri.extra;
    }
    return runtimeInfo;
}
function buildStoredPersistenceHandle(record, validProviders) {
    if (!isStoredAgentProviderAvailable(record, validProviders)) {
        return null;
    }
    return toAgentPersistenceHandle(validProviders, record.persistence);
}
export function buildStoredAgentPayload(record, validProviders) {
    const defaultCapabilities = {
        supportsStreaming: false,
        supportsSessionPersistence: true,
        supportsDynamicModes: false,
        supportsMcpServers: false,
        supportsReasoningStream: false,
        supportsToolInvocations: true,
        supportsRewindConversation: false,
        supportsRewindFiles: false,
        supportsRewindBoth: false,
    };
    const createdAt = new Date(record.createdAt);
    const updatedAt = new Date(resolveStoredAgentUpdatedAt(record));
    const lastUserMessageAt = record.lastUserMessageAt ? new Date(record.lastUserMessageAt) : null;
    const runtimeInfo = buildStoredRuntimeInfo(record);
    const providerAvailable = isStoredAgentProviderAvailable(record, validProviders);
    const persistence = projectPersistenceHandleForWire(buildStoredPersistenceHandle(record, validProviders));
    return {
        id: record.id,
        provider: record.provider,
        cwd: record.cwd,
        ...(record.workspaceId ? { workspaceId: record.workspaceId } : {}),
        model: record.config?.model ?? null,
        thinkingOptionId: record.config?.thinkingOptionId ?? null,
        effectiveThinkingOptionId: resolveEffectiveThinkingOptionId({
            runtimeInfo,
            configuredThinkingOptionId: record.config?.thinkingOptionId ?? null,
        }),
        ...(runtimeInfo ? { runtimeInfo } : {}),
        createdAt: createdAt.toISOString(),
        updatedAt: updatedAt.toISOString(),
        lastUserMessageAt: lastUserMessageAt ? lastUserMessageAt.toISOString() : null,
        status: record.lastStatus,
        capabilities: defaultCapabilities,
        currentModeId: record.lastModeId ?? null,
        availableModes: [],
        pendingPermissions: [],
        persistence,
        title: record.title ?? null,
        requiresAttention: record.requiresAttention ?? false,
        attentionReason: record.attentionReason ?? null,
        attentionTimestamp: record.attentionTimestamp ?? null,
        archivedAt: record.archivedAt ?? null,
        labels: normalizeLabels(record.labels),
        ...(providerAvailable ? {} : { providerUnavailable: true }),
    };
}
export function toAgentListItemPayload(agent) {
    return {
        id: agent.id,
        shortId: agent.id.slice(0, 7),
        title: agent.title,
        provider: agent.provider,
        model: agent.runtimeInfo?.model ?? agent.model,
        thinkingOptionId: agent.thinkingOptionId,
        effectiveThinkingOptionId: agent.effectiveThinkingOptionId,
        status: agent.status,
        cwd: agent.cwd,
        createdAt: agent.createdAt,
        updatedAt: agent.updatedAt,
        lastUserMessageAt: agent.lastUserMessageAt,
        archivedAt: agent.archivedAt ?? null,
        requiresAttention: agent.requiresAttention ?? false,
        attentionReason: agent.attentionReason ?? null,
        attentionTimestamp: agent.attentionTimestamp ?? null,
        labels: agent.labels,
        ...(agent.providerUnavailable ? { providerUnavailable: true } : {}),
    };
}
export function toRecentProviderSessionDescriptorPayload(session, options) {
    return {
        providerId: session.provider,
        providerLabel: options.providerLabel,
        providerHandleId: session.providerHandleId,
        cwd: session.cwd,
        title: session.title,
        firstPromptPreview: session.firstPromptPreview,
        lastPromptPreview: session.lastPromptPreview,
        lastActivityAt: session.lastActivityAt.toISOString(),
    };
}
function buildSerializableConfig(config) {
    const serializable = {};
    if (config.modeId) {
        serializable.modeId = config.modeId;
    }
    if (config.model) {
        serializable.model = config.model;
    }
    if (config.thinkingOptionId) {
        serializable.thinkingOptionId = config.thinkingOptionId;
    }
    if (Object.prototype.hasOwnProperty.call(config, "featureValues")) {
        const featureValues = sanitizeMetadata(config.featureValues);
        if (featureValues !== undefined) {
            serializable.featureValues = featureValues;
        }
    }
    if (config.providerOptions !== undefined) {
        const providerOptions = sanitizeOptionalJson(config.providerOptions);
        if (providerOptions && isJsonObject(providerOptions)) {
            serializable.providerOptions = providerOptions;
        }
    }
    if (config.toolPolicy) {
        serializable.toolPolicy = {
            preapproved: config.toolPolicy.preapproved.map((grant) => ({ ...grant })),
        };
    }
    if (config.systemPrompt) {
        serializable.systemPrompt = config.systemPrompt;
    }
    if (config.mcpServers) {
        serializable.mcpServers = config.mcpServers;
    }
    return Object.keys(serializable).length ? serializable : null;
}
function sanitizePendingPermissions(pending) {
    return Array.from(pending.values()).map((request) => Object.assign({}, request, {
        input: sanitizeMetadata(request.input),
        suggestions: sanitizeMetadataArray(request.suggestions),
        actions: request.actions?.map((action) => Object.assign({}, action)),
        metadata: sanitizeMetadata(request.metadata),
    }));
}
function sanitizePersistenceHandle(handle) {
    if (!handle) {
        return null;
    }
    const sanitized = {
        provider: handle.provider,
        sessionId: handle.sessionId,
    };
    if (handle.nativeHandle !== undefined) {
        sanitized.nativeHandle = handle.nativeHandle;
    }
    const metadata = sanitizeMetadata(handle.metadata);
    if (metadata !== undefined) {
        sanitized.metadata = metadata;
    }
    return sanitized;
}
function projectPersistenceHandleForWire(handle) {
    const projected = sanitizePersistenceHandle(handle);
    if (!projected?.metadata) {
        return projected;
    }
    delete projected.metadata.mcpServers;
    if (Object.keys(projected.metadata).length === 0) {
        delete projected.metadata;
    }
    return projected;
}
function cloneCapabilities(capabilities) {
    return { ...capabilities };
}
function cloneAvailableModes(modes) {
    return modes.map((mode) => ({ ...mode }));
}
function normalizeFeatures(features) {
    return Array.isArray(features) ? features.map((feature) => ({ ...feature })) : [];
}
function sanitizeOptionalJson(value) {
    if (value === undefined) {
        return undefined;
    }
    if (value === null) {
        return null;
    }
    if (Array.isArray(value)) {
        const sanitized = value
            .map((item) => sanitizeOptionalJson(item))
            .filter((item) => item !== undefined);
        return sanitized;
    }
    if (value instanceof Date) {
        return value.toISOString();
    }
    if (typeof value === "object") {
        const result = {};
        for (const [key, val] of Object.entries(value)) {
            const sanitized = sanitizeOptionalJson(val);
            if (sanitized !== undefined) {
                result[key] = sanitized;
            }
        }
        return Object.keys(result).length ? result : undefined;
    }
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        return value;
    }
    return undefined;
}
function isJsonObject(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function sanitizeMetadata(value) {
    const sanitized = sanitizeOptionalJson(value);
    if (!sanitized || !isJsonObject(sanitized)) {
        return undefined;
    }
    return sanitized;
}
function sanitizeMetadataArray(value) {
    if (!Array.isArray(value)) {
        return undefined;
    }
    const sanitized = value
        .map((entry) => sanitizeMetadata(entry))
        .filter((entry) => entry !== undefined);
    return sanitized.length > 0 ? sanitized : undefined;
}
function assignFiniteNumber(source, target, field) {
    const raw = source[field];
    if (typeof raw === "number" && Number.isFinite(raw)) {
        target[field] = raw;
        return true;
    }
    return raw === undefined || raw === null;
}
function sanitizeUsage(value) {
    const sanitized = sanitizeOptionalJson(value);
    if (!sanitized || !isJsonObject(sanitized)) {
        return undefined;
    }
    const result = {};
    const fields = [
        "inputTokens",
        "cachedInputTokens",
        "outputTokens",
        "totalCostUsd",
        "contextWindowMaxTokens",
        "contextWindowUsedTokens",
    ];
    for (const field of fields) {
        if (!assignFiniteNumber(sanitized, result, field)) {
            return undefined;
        }
    }
    return Object.keys(result).length ? result : undefined;
}
function sanitizeRuntimeInfo(runtimeInfo) {
    if (!runtimeInfo) {
        return undefined;
    }
    const sanitized = {
        provider: runtimeInfo.provider,
        sessionId: runtimeInfo.sessionId,
    };
    if (runtimeInfo.model !== undefined) {
        sanitized.model = runtimeInfo.model;
    }
    if (runtimeInfo.thinkingOptionId !== undefined) {
        sanitized.thinkingOptionId = runtimeInfo.thinkingOptionId;
    }
    if (runtimeInfo.modeId !== undefined) {
        sanitized.modeId = runtimeInfo.modeId;
    }
    const extra = sanitizeMetadata(runtimeInfo.extra);
    if (extra !== undefined) {
        sanitized.extra = extra;
    }
    return sanitized;
}
//# sourceMappingURL=agent-projections.js.map