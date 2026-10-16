import { AgentRunCancellationError, } from "./agent-manager.js";
async function requestAgentRunCancellation(dependencies, agentId) {
    const { agentManager, logger } = dependencies;
    const agent = agentManager.getAgent(agentId);
    if (!agent) {
        logger.trace({ agentId }, "cancelAgentRunCommand: agent not found");
        throw new Error(`Agent ${agentId} not found`);
    }
    const hasInFlightRun = agentManager.hasInFlightRun(agentId);
    if (!hasInFlightRun) {
        logger.trace({ agentId, lifecycle: agent.lifecycle, hasInFlightRun }, "cancelAgentRunCommand: skipping because agent is not running");
        return { agent, cancelled: false, cancellation: { status: "not_running" } };
    }
    logger.debug({ agentId, lifecycle: agent.lifecycle, hasInFlightRun }, "cancelAgentRunCommand: interrupting");
    const startedAt = Date.now();
    const cancellation = await agentManager.cancelAgentRun(agentId);
    logger.debug({ agentId, cancellation: cancellation.status, durationMs: Date.now() - startedAt }, "cancelAgentRunCommand: cancelAgentRun completed");
    return {
        agent,
        cancelled: cancellation.status === "settled",
        cancellation,
    };
}
export async function cancelAgentRunCommand(dependencies, agentId) {
    const result = await requestAgentRunCancellation(dependencies, agentId);
    if (result.cancellation.status === "refused") {
        dependencies.logger.warn({ agentId }, "cancelAgentRunCommand: reported running but no active run was cancelled");
        throw new AgentRunCancellationError(agentId, "stop");
    }
    return { agent: result.agent, cancelled: result.cancelled };
}
export async function archiveAgentCommand(dependencies, agentId) {
    const liveAgent = dependencies.agentManager.getAgent(agentId);
    let record;
    if (liveAgent) {
        await requestAgentRunCancellation(dependencies, agentId);
        await dependencies.agentManager.clearAgentAttention(agentId).catch(() => undefined);
        await dependencies.agentManager.archiveAgent(agentId);
        record = await dependencies.agentStorage.get(agentId);
    }
    else {
        record = await archiveStoredAgent(dependencies, agentId);
    }
    if (!record) {
        throw new Error(`Agent not found in storage after archive: ${agentId}`);
    }
    if (!record.archivedAt) {
        throw new Error(`Agent missing archivedAt after archive: ${agentId}`);
    }
    return {
        agentId,
        archivedAt: record.archivedAt,
        record,
    };
}
export async function closeAgentCommand(dependencies, agentId) {
    await dependencies.agentManager.closeAgent(agentId);
}
export async function updateAgentCommand(dependencies, input) {
    const title = input.name?.trim();
    const labels = input.labels && Object.keys(input.labels).length > 0 ? input.labels : undefined;
    if (!title && !labels) {
        return {
            accepted: false,
            error: "Nothing to update (provide name and/or labels)",
        };
    }
    await dependencies.agentManager.updateAgentMetadata(input.agentId, {
        ...(title ? { title } : {}),
        ...(labels ? { labels } : {}),
    });
    return {
        accepted: true,
        error: null,
    };
}
export async function detachAgentCommand(dependencies, agentId) {
    const result = await dependencies.agentManager.detachAgent(agentId);
    return {
        agentId,
        ...result,
    };
}
export async function setAgentModeCommand(dependencies, input) {
    const notice = await dependencies.agentManager.setAgentMode(input.agentId, input.modeId);
    return { modeId: input.modeId, notice };
}
async function archiveStoredAgent(dependencies, agentId) {
    const existing = await dependencies.agentStorage.get(agentId);
    if (!existing) {
        throw new Error(`Agent not found: ${agentId}`);
    }
    if (existing.archivedAt) {
        return existing;
    }
    const archivedAt = new Date().toISOString();
    return dependencies.agentManager.archiveSnapshot(agentId, archivedAt);
}
//# sourceMappingURL=lifecycle-command.js.map