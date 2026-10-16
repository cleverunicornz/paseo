import { resolveEffectiveThinkingOptionId, toAgentPayload } from "../../agent/agent-projections.js";
function agentThinkingOptionMatchesFilter(agent, filter) {
    if (filter.thinkingOptionId === undefined) {
        return true;
    }
    const expectedThinkingOptionId = resolveEffectiveThinkingOptionId({
        configuredThinkingOptionId: filter.thinkingOptionId ?? null,
    });
    const resolvedThinkingOptionId = agent.effectiveThinkingOptionId ??
        resolveEffectiveThinkingOptionId({
            runtimeInfo: agent.runtimeInfo,
            configuredThinkingOptionId: agent.thinkingOptionId ?? null,
        });
    return resolvedThinkingOptionId === expectedThinkingOptionId;
}
function matchesAgentStructuralFilter(agent, project, filter) {
    if (filter.statuses && filter.statuses.length > 0) {
        const statuses = new Set(filter.statuses);
        if (!statuses.has(agent.status)) {
            return false;
        }
    }
    if (typeof filter.requiresAttention === "boolean") {
        const requiresAttention = agent.requiresAttention ?? false;
        if (requiresAttention !== filter.requiresAttention) {
            return false;
        }
    }
    if (filter.projectKeys && filter.projectKeys.length > 0) {
        const projectKeys = new Set(filter.projectKeys.filter((item) => item.trim().length > 0));
        if (projectKeys.size > 0 && !projectKeys.has(project.projectKey)) {
            return false;
        }
    }
    return true;
}
/**
 * Pure predicate shared by the live subscription stream and the snapshot listing
 * pager: does an agent (with its resolved project placement) satisfy a
 * `fetch_agents` filter?
 */
export function matchesAgentUpdatesFilter(input) {
    const { agent, project, filter } = input;
    if (filter?.labels) {
        const matchesLabels = Object.entries(filter.labels).every(([key, value]) => agent.labels[key] === value);
        if (!matchesLabels) {
            return false;
        }
    }
    const includeArchived = filter?.includeArchived ?? false;
    if (!includeArchived && agent.archivedAt) {
        return false;
    }
    if (filter && !agentThinkingOptionMatchesFilter(agent, filter)) {
        return false;
    }
    if (filter && !matchesAgentStructuralFilter(agent, project, filter)) {
        return false;
    }
    return true;
}
function agentUpdateTargetId(update) {
    return update.kind === "remove" ? update.agentId : update.agent.id;
}
export function createAgentUpdatesService(deps) {
    const subscriptions = new Map();
    const liveAgentUpdateTails = new Map();
    const sequence = (sub, payload, agent, project, agentId) => deps.sequenceAgentUpdate(payload, agent, project, agentId, sub.syncEnabled === true);
    function bufferOrEmit(sub, payload) {
        if (subscriptions.get(sub.subscriptionId) !== sub)
            return;
        if (payload.kind === "upsert" && !sub.isProviderVisible(payload.agent.provider)) {
            return;
        }
        if (sub.isBootstrapping) {
            sub.pendingUpdatesByAgentId.set(agentUpdateTargetId(payload), payload);
            return;
        }
        sub.emit({ type: "agent_update", payload });
    }
    function beginSubscription(input) {
        subscriptions.set(input.subscriptionId, {
            ...input,
            emit: input.emit ?? deps.emit,
            syncEnabled: input.syncEnabled ?? false,
            isProviderVisible: input.isProviderVisible ?? deps.isProviderVisibleToClient,
            isBootstrapping: true,
            pendingUpdatesByAgentId: new Map(),
        });
    }
    function flushBootstrapped(subscriptionId, options) {
        const sub = subscriptions.get(subscriptionId);
        if (!sub?.isBootstrapping)
            return;
        sub.isBootstrapping = false;
        const pending = Array.from(sub.pendingUpdatesByAgentId.values());
        sub.pendingUpdatesByAgentId.clear();
        for (const payload of pending) {
            if (payload.kind === "upsert") {
                const snapshotUpdatedAt = options?.snapshotUpdatedAtByAgentId?.get(payload.agent.id);
                if (snapshotUpdatedAt !== undefined &&
                    Date.parse(payload.agent.updatedAt) < snapshotUpdatedAt)
                    continue;
            }
            bufferOrEmit(sub, payload);
        }
    }
    function clearSubscription(subscriptionId) {
        subscriptions.delete(subscriptionId);
    }
    function hasSubscription() {
        return subscriptions.size > 0;
    }
    async function includesLiveAgent(agent, subscriptionIds) {
        const observers = [...subscriptions.values()].filter((sub) => !subscriptionIds || subscriptionIds.has(sub.subscriptionId));
        if (observers.length === 0)
            return false;
        const payload = await deps.enrichAgentPayload(toAgentPayload(agent));
        const project = payload.workspaceId
            ? await deps.buildProjectPlacementForWorkspaceId(payload.workspaceId)
            : null;
        return (project !== null &&
            observers.some((sub) => sub.isProviderVisible(payload.provider) &&
                matchesAgentUpdatesFilter({ agent: payload, project, filter: sub.filter })));
    }
    async function publishPayload(payload) {
        const observers = [...subscriptions.values()];
        if (observers.length === 0)
            return;
        const project = payload.workspaceId
            ? await deps.buildProjectPlacementForWorkspaceId(payload.workspaceId)
            : null;
        for (const sub of observers) {
            const matches = project && matchesAgentUpdatesFilter({ agent: payload, project, filter: sub.filter });
            bufferOrEmit(sub, sequence(sub, matches
                ? { kind: "upsert", agent: payload, project }
                : { kind: "remove", agentId: payload.id }, payload, project, payload.id));
        }
    }
    async function emitStoredRecord(record) {
        const payload = deps.buildStoredAgentPayload(record);
        await publishPayload(payload);
        return payload;
    }
    async function emitLiveAgentUpdate(payload) {
        try {
            if (hasSubscription())
                await publishPayload(await deps.enrichAgentPayload(payload));
            if (payload.workspaceId)
                await deps.emitWorkspaceUpdateForWorkspaceId(payload.workspaceId);
        }
        catch (error) {
            deps.logger.error({ err: error }, "Failed to emit agent update");
        }
    }
    function enqueueAgentUpdate(agentId, emitUpdate) {
        const previous = liveAgentUpdateTails.get(agentId) ?? Promise.resolve();
        const next = previous.catch(() => undefined).then(emitUpdate);
        liveAgentUpdateTails.set(agentId, next);
        void next.finally(() => {
            if (liveAgentUpdateTails.get(agentId) === next) {
                liveAgentUpdateTails.delete(agentId);
            }
        });
        return next;
    }
    function forwardLiveAgent(agent) {
        if (!hasSubscription()) {
            const workspaceId = agent.workspaceId;
            return workspaceId
                ? enqueueAgentUpdate(agent.id, async () => {
                    try {
                        await deps.emitWorkspaceUpdateForWorkspaceId(workspaceId);
                    }
                    catch (error) {
                        deps.logger.error({ err: error }, "Failed to emit workspace update");
                    }
                })
                : Promise.resolve();
        }
        const payload = toAgentPayload(agent);
        return enqueueAgentUpdate(payload.id, () => emitLiveAgentUpdate(payload));
    }
    function removeAgent(agentId) {
        return enqueueAgentUpdate(agentId, () => {
            for (const sub of subscriptions.values()) {
                bufferOrEmit(sub, sequence(sub, { kind: "remove", agentId }, null, null, agentId));
            }
        });
    }
    function dispose() {
        subscriptions.clear();
    }
    return {
        beginSubscription,
        flushBootstrapped,
        clearSubscription,
        hasSubscription,
        includesLiveAgent,
        forwardLiveAgent,
        emitStoredRecord,
        removeAgent,
        dispose,
    };
}
//# sourceMappingURL=agent-updates-service.js.map