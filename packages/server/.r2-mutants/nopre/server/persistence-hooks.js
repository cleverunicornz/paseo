import { stripInternalPaseoMcpServer } from "./agent/runtime-mcp-config.js";
function getLogger(logger) {
    return logger.child({ module: "persistence" });
}
function isProviderRegistered(validProviders, provider) {
    if (!validProviders) {
        return true;
    }
    if (validProviders instanceof Set) {
        return validProviders.has(provider);
    }
    return new Set(validProviders).has(provider);
}
/**
 * Attach AgentStorage persistence to an AgentManager instance so every
 * agent_state snapshot is flushed to disk.
 */
export function attachAgentStoragePersistence(logger, agentManager, storage) {
    const log = getLogger(logger);
    const unsubscribe = agentManager.subscribe((event) => {
        if (event.type !== "agent_state") {
            return;
        }
        if (event.agent.lifecycle === "closed") {
            return;
        }
        void storage.applySnapshot(event.agent).catch((error) => {
            log.error({ err: error, agentId: event.agent.id }, "Failed to persist agent snapshot");
        });
    });
    return unsubscribe;
}
export function buildConfigOverrides(record) {
    return stripInternalPaseoMcpServer({
        provider: record.provider,
        cwd: record.cwd,
        // lastModeId is the last live mode — it also covers provider-side switches
        // (ACP current_mode_update, in-session commands) that never reach
        // record.config.modeId.
        modeId: record.lastModeId ?? record.config?.modeId ?? undefined,
        model: record.config?.model ?? undefined,
        thinkingOptionId: record.config?.thinkingOptionId ?? undefined,
        featureValues: record.config?.featureValues ?? undefined,
        providerOptions: record.config?.providerOptions ?? undefined,
        toolPolicy: record.config?.toolPolicy ?? undefined,
        systemPrompt: record.config?.systemPrompt ?? undefined,
        mcpServers: record.config?.mcpServers ?? undefined,
    });
}
export function buildSessionConfig(record, options) {
    if (!isProviderRegistered(options?.validProviders, record.provider)) {
        return null;
    }
    const overrides = buildConfigOverrides(record);
    return stripInternalPaseoMcpServer({
        provider: record.provider,
        cwd: record.cwd,
        modeId: overrides.modeId,
        model: overrides.model,
        thinkingOptionId: overrides.thinkingOptionId,
        featureValues: overrides.featureValues,
        providerOptions: overrides.providerOptions,
        toolPolicy: overrides.toolPolicy,
        systemPrompt: overrides.systemPrompt,
        mcpServers: overrides.mcpServers,
    });
}
export function isStoredAgentProviderAvailable(record, validProviders) {
    return isProviderRegistered(validProviders, record.provider);
}
/**
 * When the record last changed, from either of the two timestamps it carries. They diverge
 * because renaming, labelling, restoring from archive, marking unread, and clearing attention
 * all move `updatedAt` on an unloaded agent without touching `lastActivityAt`. Reading one
 * field alone hands consumers a time older than one they have already seen, and
 * `acceptAgentDirectoryUpdate` drops every state update that goes backwards.
 */
export function resolveStoredAgentUpdatedAt(record) {
    const timestamps = [record.updatedAt, record.lastActivityAt]
        .filter((value) => typeof value === "string" && value.length > 0)
        .map((value) => ({
        raw: value,
        parsed: Date.parse(value),
    }))
        .filter((value) => !Number.isNaN(value.parsed));
    if (timestamps.length === 0) {
        return record.updatedAt;
    }
    timestamps.sort((a, b) => b.parsed - a.parsed);
    return timestamps[0].raw;
}
export function extractTimestamps(record) {
    return {
        createdAt: new Date(record.createdAt),
        updatedAt: new Date(resolveStoredAgentUpdatedAt(record)),
        lastUserMessageAt: record.lastUserMessageAt ? new Date(record.lastUserMessageAt) : null,
        labels: record.labels,
        workspaceId: record.workspaceId,
        owner: record.owner,
    };
}
/**
 * Unread state survives a resume. Attention is set by the agent finishing or failing and
 * cleared by the user reading the chat (`workspace.clear_attention`); reloading the runtime
 * is neither, so a resumed agent that drops it silently marks the chat read.
 */
export function extractAttention(record) {
    if (!record.requiresAttention || !record.attentionReason || !record.attentionTimestamp) {
        return { requiresAttention: false };
    }
    return {
        requiresAttention: true,
        attentionReason: record.attentionReason,
        attentionTimestamp: new Date(record.attentionTimestamp),
    };
}
export function toAgentPersistenceHandle(registeredProviders, handle) {
    if (!handle) {
        return null;
    }
    const provider = handle.provider;
    if (!isProviderRegistered(registeredProviders, provider)) {
        return null;
    }
    if (!handle.sessionId) {
        return null;
    }
    return {
        provider,
        sessionId: handle.sessionId,
        ...(handle.nativeHandle !== undefined ? { nativeHandle: handle.nativeHandle } : {}),
        ...(handle.metadata !== undefined ? { metadata: handle.metadata } : {}),
    };
}
//# sourceMappingURL=persistence-hooks.js.map