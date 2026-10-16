import { buildStoredAgentPayload } from "../agent/agent-projections.js";
import { serializeAgentSnapshot, serializeAgentStreamEvent } from "../messages.js";
import { daemonExecutionKey } from "../agent/agent-owner.js";
export class DaemonExecutions {
    constructor(options) {
        this.options = options;
        this.pendingCreates = new Map();
        this.pendingControlActions = new Map();
        this.controlTails = new Map();
        this.authorityGeneration = 0;
        this.authorityActive = true;
        this.daemonId = options.daemonId;
        this.agentManager = options.agentManager;
        this.agentStorage = options.agentStorage;
        this.createAgentCommand = options.createAgent;
        this.cleanupFailedCreate = options.cleanupFailedCreate ?? (async () => undefined);
    }
    create(input) {
        if (!this.authorityActive) {
            return Promise.reject(new Error("Hub relationship authority is no longer active"));
        }
        const owner = this.owner(input.executionId);
        const key = daemonExecutionKey(owner);
        const pending = this.pendingCreates.get(key);
        if (pending) {
            return pending;
        }
        const authorityGeneration = this.authorityGeneration;
        const create = this.createOrResolve(owner, input, authorityGeneration).finally(() => {
            if (this.pendingCreates.get(key) === create) {
                this.pendingCreates.delete(key);
            }
        });
        this.pendingCreates.set(key, create);
        return create;
    }
    control(input) {
        if (!this.authorityActive) {
            return Promise.reject(new Error("Hub relationship authority is no longer active"));
        }
        const owner = this.owner(input.executionId);
        const executionKey = daemonExecutionKey(owner);
        const actionKey = `${executionKey}\0${input.action}`;
        const pending = this.pendingControlActions.get(actionKey);
        if (pending)
            return pending;
        const previous = this.controlTails.get(executionKey) ??
            this.pendingCreates.get(executionKey)?.then(() => undefined) ??
            Promise.resolve();
        const authorityGeneration = this.authorityGeneration;
        const control = previous
            .catch(() => undefined)
            .then(() => this.controlOwnedExecution(owner, input, authorityGeneration));
        this.pendingControlActions.set(actionKey, control);
        this.controlTails.set(executionKey, control);
        const release = () => {
            if (this.pendingControlActions.get(actionKey) === control) {
                this.pendingControlActions.delete(actionKey);
            }
            if (this.controlTails.get(executionKey) === control) {
                this.controlTails.delete(executionKey);
            }
        };
        void control.then(release, release);
        return control;
    }
    async invalidateAuthority() {
        this.authorityActive = false;
        this.authorityGeneration++;
        await Promise.allSettled([
            ...this.pendingCreates.values(),
            ...this.pendingControlActions.values(),
        ]);
    }
    subscribe(listener) {
        return this.agentManager.subscribe((event) => {
            const owned = this.projectEvent(event);
            if (owned) {
                listener(owned);
            }
        }, { replayState: true });
    }
    async createOrResolve(owner, input, authorityGeneration) {
        const existing = await this.agentStorage.findByDaemonExecution(owner);
        if (existing) {
            requireExecutionWorkspaceId(existing);
            this.requireAuthority(authorityGeneration);
            return this.resolveRecord(existing);
        }
        this.requireAuthority(authorityGeneration);
        requireHubMcpNamespace(input.mcpServers);
        requireToolPolicyServers(input.toolPolicy, input.mcpServers);
        let createdWorktree = null;
        let createdAgentId = null;
        let result;
        try {
            result = await this.createAgentCommand({
                kind: "mcp",
                provider: input.model ? `${input.provider}/${input.model}` : input.provider,
                title: input.prompt,
                initialPrompt: input.prompt,
                promptFailure: "throw",
                cwd: input.cwd,
                mode: input.modeId,
                thinking: input.thinkingOptionId,
                features: input.featureValues,
                env: input.env,
                ...(input.mcpServers || input.providerOptions || input.toolPolicy
                    ? {
                        config: {
                            ...(input.mcpServers ? { mcpServers: input.mcpServers } : {}),
                            ...(input.providerOptions ? { providerOptions: input.providerOptions } : {}),
                            ...(input.toolPolicy ? { toolPolicy: input.toolPolicy } : {}),
                        },
                    }
                    : {}),
                worktree: toCreateAgentWorktree(input.worktree),
                background: true,
                notifyOnFinish: false,
                owner,
                onWorktreeCreated: (worktree) => {
                    createdWorktree = worktree;
                },
                onCreated: (created) => {
                    createdAgentId = created.agentId;
                },
            });
            this.requireAuthority(authorityGeneration);
            requireExecutionWorkspaceId(result.liveSnapshot);
        }
        catch (error) {
            try {
                if (createdAgentId && this.agentManager.getAgent(createdAgentId)) {
                    try {
                        await this.agentManager.closeAgent(createdAgentId);
                    }
                    finally {
                        await this.agentManager.deleteAgentState(createdAgentId);
                    }
                }
            }
            finally {
                try {
                    await this.cleanupFailedCreate({
                        createdWorktree: ownedCreatedWorktree(createdWorktree),
                        createdAgentId: null,
                    });
                }
                finally {
                    if (createdAgentId) {
                        await this.agentStorage.remove(createdAgentId);
                    }
                }
            }
            throw error;
        }
        return {
            executionId: owner.executionId,
            agent: serializeAgentSnapshot(result.liveSnapshot),
        };
    }
    async controlOwnedExecution(owner, input, authorityGeneration) {
        this.requireAuthority(authorityGeneration, "execution control");
        const record = await this.agentStorage.findByDaemonExecution(owner);
        this.requireAuthority(authorityGeneration, "execution control");
        if (!record) {
            return;
        }
        this.requireOwner(record);
        if (input.action === "interrupt") {
            if (!record.archivedAt && this.agentManager.getAgent(record.id)) {
                await this.options.interruptAgent(record.id);
            }
            return;
        }
        const workspaceId = requireExecutionWorkspaceId(record);
        this.requireAuthority(authorityGeneration, "execution control");
        await this.options.archiveWorkspace(workspaceId, input.requestId);
    }
    resolveRecord(record) {
        requireExecutionWorkspaceId(record);
        return this.projectRecord(record);
    }
    requireAuthority(authorityGeneration, operation = "agent creation") {
        if (!this.authorityActive || authorityGeneration !== this.authorityGeneration) {
            throw new Error(`Hub relationship authority ended during ${operation}`);
        }
    }
    projectRecord(record) {
        const owner = this.requireOwner(record);
        const live = this.agentManager.getAgent(record.id);
        return {
            executionId: owner.executionId,
            agent: live
                ? serializeAgentSnapshot(live)
                : {
                    ...buildStoredAgentPayload(record, this.agentManager.getRegisteredProviderIds()),
                    status: "closed",
                },
        };
    }
    projectEvent(event) {
        if (event.type === "agent_state") {
            return this.projectAgentState(event.agent);
        }
        if (event.type !== "agent_stream") {
            return null;
        }
        const agent = this.agentManager.getAgent(event.agentId);
        if (!this.isOwned(agent)) {
            return null;
        }
        const serialized = serializeAgentStreamEvent(event.event);
        if (!serialized) {
            return null;
        }
        return {
            type: "stream",
            executionId: agent.owner.executionId,
            agentId: agent.id,
            event: serialized,
        };
    }
    projectAgentState(agent) {
        if (!this.isOwned(agent)) {
            return null;
        }
        return {
            type: "update",
            executionId: agent.owner.executionId,
            agent: serializeAgentSnapshot(agent),
        };
    }
    isOwned(agent) {
        return agent?.owner?.kind === "daemon" && agent.owner.daemonId === this.daemonId;
    }
    owner(executionId) {
        return { kind: "daemon", daemonId: this.daemonId, executionId };
    }
    requireOwner(record) {
        const owner = record.owner;
        if (owner?.kind !== "daemon" || owner.daemonId !== this.daemonId) {
            throw new Error(`Agent ${record.id} is not owned by daemon ${this.daemonId}`);
        }
        return owner;
    }
}
function requireHubMcpNamespace(mcpServers) {
    if (mcpServers && Object.hasOwn(mcpServers, "paseo")) {
        throw new Error('Hub execution MCP server name "paseo" is reserved by the daemon');
    }
}
function requireToolPolicyServers(toolPolicy, mcpServers) {
    if (!toolPolicy)
        return;
    const serverNames = new Set(Object.keys(mcpServers ?? {}));
    for (const grant of toolPolicy.preapproved) {
        if (!serverNames.has(grant.server)) {
            throw new Error(`Hub tool preapproval '${grant.server}.${grant.tool}' requires MCP server '${grant.server}' in the same create request`);
        }
    }
}
function ownedCreatedWorktree(worktree) {
    return worktree?.created === true ? worktree : null;
}
function requireExecutionWorkspaceId(record) {
    if (!record.workspaceId) {
        throw new Error(`Hub execution agent ${record.id} has no workspaceId`);
    }
    return record.workspaceId;
}
function toCreateAgentWorktree(target) {
    if (!target)
        return undefined;
    if (target.mode === "branch-off") {
        return {
            worktreeName: target.newBranch,
            baseBranch: target.base,
            action: "branch-off",
        };
    }
    if (target.mode === "checkout-branch") {
        return { refName: target.branch, action: "checkout" };
    }
    return { githubPrNumber: target.prNumber, action: "checkout" };
}
//# sourceMappingURL=daemon-executions.js.map