import { projectTimelineRows } from "./timeline-projection.js";
import { describeHookAgent, publishAgentStream } from "../plugins/lifecycle/index.js";
import { randomUUID } from "node:crypto";
import { basename, resolve } from "node:path";
import { stat } from "node:fs/promises";
import { AGENT_LIFECYCLE_STATUSES, } from "@getpaseo/protocol/agent-lifecycle";
import { getParentAgentIdFromLabels, hasOpenAgentTab, isDelegatedAgent, isOpenAgentTabLabel, PARENT_AGENT_ID_LABEL, } from "@getpaseo/protocol/agent-labels";
import { z } from "zod";
import { getAgentStreamEventTurnId, } from "./agent-sdk-types.js";
import { buildArchivedAgentRecord } from "./agent-archive.js";
import { InMemoryAgentTimelineStore, } from "./agent-timeline-store.js";
import { AGENT_STREAM_COALESCE_DEFAULT_WINDOW_MS, AgentStreamCoalescer, } from "./agent-stream-coalescer.js";
import { limitAgentTimelineItemContent } from "./agent-timeline-content.js";
import { AgentRunState, } from "./agent-run-state.js";
import { invokeRewindCapability } from "./rewind/rewind.js";
import { isSystemInjectedEnvelope } from "./agent-prompt.js";
import { isStaleProviderSessionError } from "./stale-provider-session-error.js";
import { stripInternalPaseoMcpServer, withRuntimePaseoMcpServer } from "./runtime-mcp-config.js";
import { resolveCreateAgentTitles } from "./create-agent-title.js";
import { isPaseoToolPolicyEnabled } from "./paseo-tool-policy.js";
import { ProviderSubagentStore, } from "./provider-subagents/store.js";
import { withTimeout } from "../../utils/promise-timeout.js";
import { extractAttention } from "../persistence-hooks.js";
const RELOAD_SESSION_CLOSE_TIMEOUT_MS = 3000;
const INTERRUPT_SESSION_TIMEOUT_MS = 2000;
const IMPORTABLE_SESSION_LIST_TIMEOUT_MS = 90000;
const STORED_AGENT_CAPABILITIES = {
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
function submittedPromptText(prompt) {
    if (typeof prompt === "string") {
        return prompt;
    }
    return prompt
        .flatMap((block) => (block.type === "text" && !("mimeType" in block) ? [block.text] : []))
        .join("\n")
        .trim();
}
export class AgentManagerShuttingDownError extends Error {
    constructor() {
        super("Agent manager is shutting down");
        this.name = "AgentManagerShuttingDownError";
    }
}
export class AgentRunCancellationError extends Error {
    constructor(agentId, action) {
        super(`Cannot ${action} agent ${agentId} because its active run cancellation was not acknowledged`);
        this.name = "AgentRunCancellationError";
    }
}
/** A session that will run in a directory needs that directory to be there. */
async function assertUsableWorkingDirectory(cwd) {
    try {
        const stats = await stat(cwd);
        if (!stats.isDirectory()) {
            throw new Error(`Working directory is not a directory: ${cwd}`);
        }
    }
    catch (error) {
        if (error instanceof Error &&
            "code" in error &&
            error.code === "ENOENT") {
            throw new Error(`Working directory does not exist: ${cwd}`, { cause: error });
        }
        if (error instanceof Error) {
            throw error;
        }
        throw new Error(`Failed to access working directory: ${cwd}`, { cause: error });
    }
}
function formatProviderList(providers) {
    return providers.length > 0 ? providers.join(", ") : "none";
}
function buildStoredAgentConfig(record) {
    const config = {
        provider: record.provider,
        cwd: record.cwd,
    };
    // lastModeId is the last live mode — it also covers provider-side switches
    // that never reach record.config.modeId.
    const modeId = record.lastModeId ?? record.config?.modeId;
    if (modeId != null)
        config.modeId = modeId;
    if (!record.config) {
        return config;
    }
    if (record.config.model != null)
        config.model = record.config.model;
    if (record.config.thinkingOptionId != null) {
        config.thinkingOptionId = record.config.thinkingOptionId;
    }
    if (record.config.featureValues != null) {
        config.featureValues = record.config.featureValues;
    }
    if (record.config.providerOptions != null) {
        config.providerOptions = record.config.providerOptions;
    }
    if (record.config.toolPolicy != null)
        config.toolPolicy = record.config.toolPolicy;
    if (record.config.systemPrompt != null) {
        config.systemPrompt = record.config.systemPrompt;
    }
    if (record.config.mcpServers != null)
        config.mcpServers = record.config.mcpServers;
    return stripInternalPaseoMcpServer(config);
}
export { AGENT_LIFECYCLE_STATUSES };
function stripSteerOptions(options) {
    if (!options)
        return undefined;
    const { clearPendingPermissions: _, ...runOptions } = options;
    return runOptions;
}
function resolveInitialAttention(input) {
    if (input == null || !input.requiresAttention) {
        return { requiresAttention: false };
    }
    return {
        requiresAttention: true,
        attentionReason: input.attentionReason,
        attentionTimestamp: new Date(input.attentionTimestamp),
    };
}
function attachManagedTurnIdentity(agent, event, fromHistory) {
    const existingTurnId = getAgentStreamEventTurnId(event);
    if (fromHistory || existingTurnId !== undefined) {
        return { event, turnId: existingTurnId };
    }
    switch (event.type) {
        case "turn_started": {
            const turnId = agent.activeForegroundTurnId ?? agent.activeTurnId ?? `autonomous-${randomUUID()}`;
            return { event: { ...event, turnId }, turnId };
        }
        case "turn_completed":
        case "turn_failed":
        case "turn_canceled": {
            const turnId = agent.activeForegroundTurnId ?? agent.activeTurnId ?? undefined;
            return turnId ? { event: { ...event, turnId }, turnId } : { event, turnId };
        }
        case "timeline": {
            // Live provider items belong to the foreground turn that owns their dispatch.
            // Provider history deliberately keeps absent IDs because it has no daemon turn identity.
            const turnId = agent.activeForegroundTurnId ?? agent.activeTurnId ?? undefined;
            return turnId ? { event: { ...event, turnId }, turnId } : { event, turnId };
        }
        default:
            return { event, turnId: undefined };
    }
}
function limitAgentStreamEventContent(event) {
    return event.type === "timeline"
        ? { ...event, item: limitAgentTimelineItemContent(event.item) }
        : event;
}
const SYSTEM_ERROR_PREFIX = "[System Error]";
function attachPersistenceCwd(handle, cwd) {
    if (!handle) {
        return null;
    }
    return {
        ...handle,
        metadata: {
            ...handle.metadata,
            cwd,
        },
    };
}
const BUSY_STATUSES = new Set(["initializing", "running"]);
const AgentIdSchema = z.guid();
function isAgentBusy(status) {
    return BUSY_STATUSES.has(status);
}
function isTurnTerminalEvent(event) {
    return (event.type === "turn_completed" ||
        event.type === "turn_failed" ||
        event.type === "turn_canceled");
}
function abortMessage(reason, fallbackMessage) {
    if (typeof reason === "string")
        return reason;
    if (reason instanceof Error)
        return reason.message;
    return fallbackMessage;
}
function createAbortError(signal, fallbackMessage) {
    const message = abortMessage(signal?.reason, fallbackMessage);
    return Object.assign(new Error(message), { name: "AbortError" });
}
function validateAgentId(agentId, source) {
    const result = AgentIdSchema.safeParse(agentId);
    if (!result.success) {
        throw new Error(`${source}: agentId must be a UUID`);
    }
    return result.data;
}
function applyLabelPatch(labels, patch) {
    const nextLabels = { ...labels };
    for (const [key, value] of Object.entries(patch)) {
        if (value === null) {
            delete nextLabels[key];
        }
        else {
            nextLabels[key] = value;
        }
    }
    return nextLabels;
}
function buildExplicitTimelineSeedForRegister(now, options) {
    const hasTimeline = Boolean(options?.timeline?.length);
    const hasTimelineRows = Boolean(options?.timelineRows?.length);
    const hasTimelineNextSeq = options?.timelineNextSeq !== undefined;
    if (!hasTimeline && !hasTimelineRows && !hasTimelineNextSeq) {
        return null;
    }
    return {
        items: options?.timeline,
        rows: options?.timelineRows,
        nextSeq: options?.timelineNextSeq,
        timestamp: (options?.updatedAt ?? options?.createdAt ?? now).toISOString(),
    };
}
function buildImportedTimelineRows(entries) {
    const rows = [];
    for (const entry of entries) {
        if (entry.item.type === "user_message" && isSystemInjectedEnvelope(entry.item.text)) {
            continue;
        }
        rows.push({
            seq: rows.length + 1,
            timestamp: entry.timestamp ?? new Date().toISOString(),
            item: limitAgentTimelineItemContent(entry.item),
        });
    }
    return rows;
}
function resolveImportedAgentTitle(config, timelineRows) {
    const initialPrompt = getFirstUserMessageTextFromRows(timelineRows);
    if (!initialPrompt) {
        return null;
    }
    const { explicitTitle, provisionalTitle } = resolveCreateAgentTitles({
        configTitle: config.title,
        initialPrompt,
    });
    return explicitTitle ?? provisionalTitle ?? null;
}
function getFirstUserMessageTextFromRows(rows) {
    for (const row of rows) {
        const item = row.item;
        if (item.type !== "user_message") {
            continue;
        }
        const text = item.text.trim();
        if (text) {
            return text;
        }
    }
    return null;
}
function shouldDetachFromArchivedParent(parent, child) {
    const isCrossWorkspace = parent.workspaceId !== undefined &&
        child.workspaceId !== undefined &&
        parent.workspaceId !== child.workspaceId;
    return isCrossWorkspace || hasOpenAgentTab(child.labels);
}
function detachedAgentLabelPatch(labels) {
    const patch = { [PARENT_AGENT_ID_LABEL]: null };
    for (const label of Object.keys(labels)) {
        if (isOpenAgentTabLabel(label)) {
            patch[label] = null;
        }
    }
    return patch;
}
export class AgentManager {
    constructor(options) {
        this.clients = new Map();
        this.providerEnabled = new Map();
        this.providerDefinitions = new Map();
        this.agents = new Map();
        this.timelineStore = new InMemoryAgentTimelineStore();
        this.providerSubagents = new ProviderSubagentStore();
        this.agentsAwaitingInitialSnapshotPersist = new Set();
        this.sessionEventTails = new Map();
        this.steerEventBarriers = new Map();
        this.foregroundMutationTails = new Map();
        this.runs = new AgentRunState();
        this.subscribers = new Set();
        this.previousStatuses = new Map();
        this.backgroundTasks = new Set();
        this.agentRegistrationTasks = new Set();
        this.inFlightAgentCloses = new Map();
        this.reloadedSessionCloses = new WeakMap();
        this.lifecycleMutationTails = new Map();
        this.paseoToolsEnabled = true;
        this.paseoToolCatalogFactory = null;
        this.paseoToolPolicies = new Map();
        this.acceptingAgentRegistrations = true;
        this.pluginLifecycle = options.pluginLifecycle;
        this.idFactory = options?.idFactory ?? (() => randomUUID());
        this.registry = options?.registry;
        this.durableTimelineStore = options?.durableTimelineStore;
        this.onAgentAttention = options?.onAgentAttention;
        this.onWorkspaceStateMayHaveChanged = options?.onWorkspaceStateMayHaveChanged;
        this.mcpBaseUrl = options?.mcpBaseUrl ?? null;
        this.mcpAuthToken = options?.mcpAuthToken ?? null;
        this.configurePaseoTools(options);
        this.resolvePaseoToolPolicy = options.resolvePaseoToolPolicy ?? (() => undefined);
        this.appendSystemPrompt = options.appendSystemPrompt ?? "";
        this.logger = options.logger.child({ module: "agent", component: "agent-manager" });
        this.rescueTimeouts = {
            reloadSessionCloseMs: options.rescueTimeouts?.reloadSessionCloseMs ?? RELOAD_SESSION_CLOSE_TIMEOUT_MS,
            interruptSessionMs: options.rescueTimeouts?.interruptSessionMs ?? INTERRUPT_SESSION_TIMEOUT_MS,
        };
        this.beforeSteerUnavailableFallback = options.beforeSteerUnavailableFallback;
        this.agentStreamCoalescer = new AgentStreamCoalescer({
            windowMs: options.agentStreamCoalesceWindowMs ?? AGENT_STREAM_COALESCE_DEFAULT_WINDOW_MS,
            timers: { setTimeout, clearTimeout },
            onFlush: ({ agentId, item, provider, turnId }) => {
                const event = this.recordAndDispatchTimelineItem(agentId, item, provider, turnId);
                this.notifyForegroundTurnWaiters(agentId, event);
            },
        });
        this.updateProviderRegistry({
            providerDefinitions: options.providerDefinitions ?? {},
            clients: options.clients ?? {},
        });
    }
    configurePaseoTools(options) {
        this.paseoToolsEnabled = options.paseoToolsEnabled ?? true;
        this.paseoToolCatalogFactory = options.paseoToolCatalogFactory ?? null;
    }
    registerClient(provider, client) {
        this.clients.set(provider, client);
    }
    updateProviderRegistry(input) {
        this.providerEnabled.clear();
        this.providerDefinitions.clear();
        for (const [provider, definition] of Object.entries(input.providerDefinitions)) {
            if (definition) {
                this.providerEnabled.set(provider, definition.enabled);
                this.providerDefinitions.set(provider, definition);
            }
        }
        this.clients.clear();
        for (const [provider, client] of Object.entries(input.clients)) {
            if (client) {
                this.clients.set(provider, client);
            }
        }
        for (const provider of input.retiredProviders ?? []) {
            for (const agent of this.agents.values()) {
                if (agent.provider !== provider)
                    continue;
                void this.closeAgent(agent.id).catch((error) => {
                    this.logger.warn({ err: error, agentId: agent.id, provider }, "Failed to close agent after provider retirement");
                });
            }
        }
    }
    getRegisteredProviderIds() {
        return Array.from(this.clients.keys());
    }
    setAgentAttentionCallback(callback) {
        this.onAgentAttention = callback;
    }
    setAgentArchivedCallback(callback) {
        this.onAgentArchived = callback;
    }
    setMcpBaseUrl(url) {
        this.mcpBaseUrl = url;
    }
    prepareForShutdown() {
        this.acceptingAgentRegistrations = false;
    }
    setPaseoToolsEnabled(enabled) {
        this.paseoToolsEnabled = enabled;
    }
    setPaseoToolCatalogFactory(factory) {
        this.paseoToolCatalogFactory = factory;
    }
    getPaseoToolPolicy(agentId) {
        return this.paseoToolPolicies.get(agentId);
    }
    /**
     * Capability token the daemon's own MCP clients must present to the Agent MCP
     * endpoint when a daemon password is configured. Read by the per-client
     * session to authenticate its own MCP connection. Stays in the daemon — never
     * sent to remote clients.
     */
    getMcpAuthToken() {
        return this.mcpAuthToken;
    }
    setAppendSystemPrompt(prompt) {
        this.appendSystemPrompt = prompt ?? "";
    }
    getMetricsSnapshot() {
        const byLifecycle = {};
        let withActiveForegroundTurn = 0;
        let totalItems = 0;
        let maxItemsPerAgent = 0;
        for (const agent of this.agents.values()) {
            byLifecycle[agent.lifecycle] = (byLifecycle[agent.lifecycle] ?? 0) + 1;
            if (agent.activeForegroundTurnId !== null) {
                withActiveForegroundTurn++;
            }
            if (!this.timelineStore.has(agent.id)) {
                continue;
            }
            const len = this.timelineStore.getItems(agent.id).length;
            totalItems += len;
            if (len > maxItemsPerAgent) {
                maxItemsPerAgent = len;
            }
        }
        return {
            total: this.agents.size,
            subscriptionCount: this.subscribers.size,
            byLifecycle,
            withActiveForegroundTurn,
            timelineStats: {
                totalItems,
                maxItemsPerAgent,
            },
        };
    }
    touchUpdatedAt(agent) {
        const nowMs = Date.now();
        const previousMs = agent.updatedAt.getTime();
        const nextMs = nowMs > previousMs ? nowMs : previousMs + 1;
        const next = new Date(nextMs);
        agent.updatedAt = next;
        return next;
    }
    nextStoredUpdatedAt(record) {
        const previousMs = Date.parse(record.updatedAt);
        const nowMs = Date.now();
        const nextMs = nowMs > previousMs ? nowMs : previousMs + 1;
        return new Date(nextMs).toISOString();
    }
    hasInFlightRun(agentId) {
        const agent = this.agents.get(agentId);
        if (!agent) {
            return false;
        }
        return (agent.lifecycle === "running" ||
            Boolean(agent.activeForegroundTurnId) ||
            this.runs.hasRun(agentId));
    }
    subscribe(callback, options) {
        const targetAgentId = options?.agentId == null ? null : validateAgentId(options.agentId, "subscribe");
        const record = {
            callback,
            agentId: targetAgentId,
        };
        this.subscribers.add(record);
        if (options?.replayState !== false) {
            if (record.agentId) {
                const agent = this.agents.get(record.agentId);
                if (agent) {
                    callback({
                        type: "agent_state",
                        agent: { ...agent },
                    });
                }
            }
            else {
                // For global subscribers, skip internal agents during replay
                for (const agent of this.agents.values()) {
                    if (agent.internal) {
                        continue;
                    }
                    callback({
                        type: "agent_state",
                        agent: { ...agent },
                    });
                }
            }
        }
        return () => {
            this.subscribers.delete(record);
        };
    }
    subscriptionCount() {
        return this.subscribers.size;
    }
    listAgents() {
        return Array.from(this.agents.values())
            .filter((agent) => !agent.internal)
            .map((agent) => Object.assign({}, agent));
    }
    async listImportableSessions(options) {
        const providerEntries = Array.from(this.clients.entries()).filter(([provider, client]) => client.capabilities.supportsSessionListing &&
            !!client.listImportableSessions &&
            this.isProviderImportable(provider, options?.providerFilter));
        const providerResults = await Promise.all(providerEntries.map(async ([provider, client]) => {
            try {
                const sessions = await withTimeout(client.listImportableSessions({
                    limit: options?.limit,
                    query: options?.query,
                    scanLimit: options?.scanLimit,
                    cwd: options?.cwd,
                }), IMPORTABLE_SESSION_LIST_TIMEOUT_MS, `Timed out listing importable sessions for provider '${provider}' after ${IMPORTABLE_SESSION_LIST_TIMEOUT_MS}ms`);
                return {
                    sessions: sessions
                        .filter((session) => matchesImportableSessionQuery(session, options?.query))
                        .map((session) => Object.assign(session, { provider })),
                    error: null,
                };
            }
            catch (error) {
                this.logger.warn({ err: error, provider }, "Failed to list importable sessions for provider");
                return {
                    sessions: [],
                    error: {
                        provider,
                        message: error instanceof Error ? error.message : String(error),
                    },
                };
            }
        }));
        const sessions = providerResults.flatMap((result) => result.sessions);
        const limit = options?.limit ?? 20;
        return {
            sessions: sessions
                .sort((a, b) => b.lastActivityAt.getTime() - a.lastActivityAt.getTime())
                .slice(0, limit),
            providerErrors: providerResults.flatMap((result) => (result.error ? [result.error] : [])),
        };
    }
    isProviderImportable(provider, providerFilter) {
        if (this.providerEnabled.get(provider) === false) {
            return false;
        }
        if (providerFilter && !providerFilter.has(provider)) {
            return false;
        }
        return true;
    }
    async listProviderAvailability() {
        return Promise.all(Array.from(this.clients.keys()).map((provider) => this.getProviderAvailability(provider)));
    }
    async getProviderAvailability(provider) {
        const client = this.clients.get(provider);
        if (!client) {
            return {
                provider,
                available: false,
                error: `No client registered for provider '${provider}'`,
            };
        }
        try {
            const available = await client.isAvailable();
            return {
                provider,
                available,
                error: null,
            };
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.logger.warn({ err: error, provider }, "Failed to check provider availability");
            return {
                provider,
                available: false,
                error: message,
            };
        }
    }
    async listDraftCommands(config) {
        const normalizedConfig = await this.normalizeConfig(config, { resolveDefaultModel: false });
        const client = this.requireClient(normalizedConfig.provider);
        if (!normalizedConfig.model) {
            return [];
        }
        const available = await client.isAvailable();
        if (!available) {
            throw new Error(`Provider '${normalizedConfig.provider}' is not available. Please ensure the CLI is installed.`);
        }
        if (client.listCommands) {
            return await client.listCommands(normalizedConfig);
        }
        const session = await client.createSession(normalizedConfig);
        try {
            if (!session.listCommands) {
                throw new Error(`Provider '${normalizedConfig.provider}' does not support listing commands`);
            }
            return await session.listCommands();
        }
        finally {
            try {
                await session.close();
            }
            catch (error) {
                this.logger.warn({ err: error, provider: normalizedConfig.provider }, "Failed to close draft command listing session");
            }
        }
    }
    async listDraftFeatures(config) {
        const normalizedConfig = await this.normalizeConfig(config, { resolveDefaultModel: false });
        const client = this.requireClient(normalizedConfig.provider);
        if (!normalizedConfig.model && !client.listFeatures) {
            return [];
        }
        const available = await client.isAvailable();
        if (!available) {
            throw new Error(`Provider '${normalizedConfig.provider}' is not available. Please ensure the CLI is installed.`);
        }
        if (client.listFeatures) {
            return await client.listFeatures(normalizedConfig);
        }
        const session = await client.createSession(normalizedConfig);
        try {
            return session.features ?? [];
        }
        finally {
            try {
                await session.close();
            }
            catch (error) {
                this.logger.warn({ err: error, provider: normalizedConfig.provider }, "Failed to close draft feature listing session");
            }
        }
    }
    usageSession(id) {
        const agent = this.agents.get(id);
        return agent?.session?.usageSession?.() ?? null;
    }
    getAgent(id) {
        const agent = this.agents.get(id);
        return agent ? { ...agent } : null;
    }
    async waitForAgentClose(agentId) {
        // Loading during reload must wait for the replacement, not resume another writer.
        await this.lifecycleMutationTails.get(agentId);
        await this.inFlightAgentCloses?.get(agentId)?.catch(() => undefined);
    }
    getTimeline(id) {
        this.requireAgent(id);
        return this.timelineStore.getItems(id);
    }
    async getTimelineRows(id) {
        this.requireAgent(id);
        if (this.durableTimelineStore) {
            return projectTimelineRows({
                rows: await this.durableTimelineStore.getCommittedRows(id),
                mode: "projected",
            }).map((entry) => Object.assign({ seq: entry.seqEnd }, entry));
        }
        return this.timelineStore.getRows(id);
    }
    fetchTimeline(id, options) {
        this.requireAgent(id);
        return this.timelineStore.fetch(id, options);
    }
    listProviderSubagents(parentAgentId) {
        this.requirePublicAgent(parentAgentId);
        return this.providerSubagents.list(parentAgentId);
    }
    listProviderSubagentActivity() {
        const publicParentIds = new Set(Array.from(this.agents.values())
            .filter((agent) => !agent.internal)
            .map((agent) => agent.id));
        return this.providerSubagents
            .listAll()
            .filter((subagent) => publicParentIds.has(subagent.parentAgentId));
    }
    getProviderSubagent(parentAgentId, subagentId) {
        this.requirePublicAgent(parentAgentId);
        return this.providerSubagents.get(parentAgentId, subagentId);
    }
    fetchProviderSubagentTimeline(parentAgentId, subagentId, options) {
        this.requirePublicAgent(parentAgentId);
        return this.providerSubagents.fetchTimeline(parentAgentId, subagentId, options);
    }
    createAgent(config, agentId, options) {
        return this.trackAgentRegistrationOperation(this.createAgentInternal(config, agentId, options));
    }
    async createAgentInternal(config, agentId, options) {
        this.assertAcceptingAgentRegistrations();
        const resolvedAgentId = validateAgentId(agentId ?? this.idFactory(), "createAgent");
        if (this.pluginLifecycle && !config.internal) {
            const request = await this.pluginLifecycle.before("agent.create", {
                config,
                env: options.env,
            });
            config = { ...request.config, internal: config.internal };
            options = { ...options, env: request.env };
        }
        await this.deleteAgentState(resolvedAgentId);
        const { storedConfig, launchConfig, paseoToolPolicy } = await this.prepareSessionConfig(config, resolvedAgentId, { env: options?.env });
        this.requireEnabledProvider(storedConfig.provider);
        const client = await this.requireAvailableClient({
            provider: storedConfig.provider,
        });
        this.paseoToolPolicies.set(resolvedAgentId, paseoToolPolicy);
        const launchContext = await this.buildLaunchContext(resolvedAgentId, client, storedConfig.cwd, paseoToolPolicy, options?.env, { reason: "create", purpose: "interactive", workspaceId: options.workspaceId ?? null });
        const providerLaunchConfig = this.resolveProviderLaunchConfig(launchConfig, launchContext);
        const createOptions = this.buildCreateSessionOptions(options);
        const session = await client.createSession(providerLaunchConfig, launchContext, createOptions);
        await this.requireExternalMcpSupport(session, storedConfig);
        const agent = await this.registerSession(session, storedConfig, resolvedAgentId, {
            labels: options.labels,
            initialTitle: options.initialTitle,
            workspaceId: options.workspaceId,
            owner: options.owner,
            historyPrimed: true,
        });
        if (!agent.internal) {
            this.pluginLifecycle?.emit("agent.created", {
                agent: describeHookAgent({ ...agent, title: agent.config.title }),
            });
        }
        return agent;
    }
    buildCreateSessionOptions(options) {
        return options?.persistSession === undefined
            ? undefined
            : { persistSession: options.persistSession };
    }
    // Reconstruct an agent from provider persistence. Callers should explicitly
    // hydrate timeline history after resume.
    resumeAgentFromPersistence(handle, overrides, agentId, options, resumeOptions) {
        const resolvedAgentId = validateAgentId(agentId ?? this.idFactory(), "resumeAgentFromPersistence");
        return this.trackAgentRegistrationOperation(this.runLifecycleMutation(resolvedAgentId, () => this.resumeAgentFromPersistenceInternal(handle, overrides, resolvedAgentId, options, resumeOptions)));
    }
    async resumeAgentFromPersistenceInternal(handle, overrides, agentId, options, resumeOptions) {
        this.assertAcceptingAgentRegistrations();
        const resolvedAgentId = validateAgentId(agentId ?? this.idFactory(), "resumeAgentFromPersistence");
        const metadata = (handle.metadata ?? {});
        const mergedConfig = {
            ...metadata,
            ...overrides,
            provider: handle.provider,
        };
        // Decide residency from durable state inside the lifecycle lane. A loader may
        // have read the record before a queued archive or restore completed. Residency is
        // settled before the config is prepared, because a history load reads an archived
        // agent whose working directory may be gone.
        const record = this.registry ? await this.registry.get(resolvedAgentId) : null;
        const currentResumeOptions = record
            ? { purpose: record.archivedAt ? "history" : "interactive" }
            : resumeOptions;
        const purpose = currentResumeOptions?.purpose ?? "interactive";
        const { storedConfig, launchConfig, paseoToolPolicy } = await this.prepareSessionConfig(mergedConfig, resolvedAgentId, { purpose });
        const client = this.requireClient(handle.provider);
        const available = await client.isAvailable();
        if (!available) {
            throw new Error(`Provider '${handle.provider}' is not available. Please ensure the CLI is installed.`);
        }
        this.paseoToolPolicies.set(resolvedAgentId, paseoToolPolicy);
        const launchContext = await this.buildLaunchContext(resolvedAgentId, client, storedConfig.cwd, paseoToolPolicy, undefined, {
            reason: "resume",
            purpose,
            workspaceId: options?.workspaceId ?? null,
        });
        const providerLaunchConfig = this.resolveProviderLaunchConfig(launchConfig, launchContext);
        const session = await client.resumeSession(handle, providerLaunchConfig, launchContext, currentResumeOptions);
        await this.requireExternalMcpSupport(session, storedConfig);
        return this.registerSession(session, storedConfig, resolvedAgentId, {
            ...options,
            persistence: handle,
            restoring: true,
        });
    }
    importProviderSession(input) {
        return this.trackAgentRegistrationOperation(this.importProviderSessionInternal(input));
    }
    async importProviderSessionInternal(input) {
        this.assertAcceptingAgentRegistrations();
        const resolvedAgentId = validateAgentId(this.idFactory(), "importProviderSession");
        this.requireEnabledProvider(input.provider);
        const client = await this.requireAvailableClient({ provider: input.provider });
        if (!client.importSession) {
            throw new Error(`Provider '${input.provider}' does not support importing sessions`);
        }
        const { storedConfig, launchConfig, paseoToolPolicy } = await this.prepareSessionConfig({
            provider: input.provider,
            cwd: input.cwd,
        }, resolvedAgentId);
        this.paseoToolPolicies.set(resolvedAgentId, paseoToolPolicy);
        const launchContext = await this.buildLaunchContext(resolvedAgentId, client, storedConfig.cwd, paseoToolPolicy, undefined, { reason: "import", purpose: "interactive", workspaceId: input.workspaceId });
        const providerLaunchConfig = this.resolveProviderLaunchConfig(launchConfig, launchContext);
        const imported = await client.importSession({
            providerHandleId: input.providerHandleId,
            cwd: input.cwd,
        }, { config: providerLaunchConfig, storedConfig, launchContext });
        let handedToRegistration = false;
        try {
            const importedConfig = await this.normalizeConfig(stripInternalPaseoMcpServer(imported.config));
            const timelineRows = buildImportedTimelineRows(imported.timeline);
            const initialTitle = resolveImportedAgentTitle(importedConfig, timelineRows);
            handedToRegistration = true;
            const agent = await this.registerSession(imported.session, importedConfig, resolvedAgentId, {
                labels: input.labels,
                workspaceId: input.workspaceId,
                timelineRows,
                timelineNextSeq: timelineRows.length + 1,
                persistence: imported.persistence,
                historyPrimed: true,
                initialTitle,
                publishWhenReady: true,
            });
            for (const event of imported.providerSubagentEvents ?? []) {
                const update = this.providerSubagents.apply(agent.id, event.provider, event.event);
                this.dispatch({ type: "provider_subagent", event: update });
            }
            return agent;
        }
        finally {
            if (!handedToRegistration) {
                await this.closeUnregisteredSession(imported.session);
            }
        }
    }
    // Hot-reload an active agent session with config overrides. By default the
    // in-memory timeline is preserved (used for voice-mode toggles and similar
    // config swaps). When `rehydrateFromDisk` is set, the timeline is wiped so a
    // new epoch is minted and provider history is re-streamed — this is what the
    // user-facing "Reload agent" action wants when the on-disk session was
    // mutated outside Paseo.
    reloadAgentSession(agentId, overrides, options) {
        return this.trackAgentRegistrationOperation(this.runLifecycleMutation(agentId, () => this.reloadAgentSessionInternal(agentId, overrides, options)));
    }
    async reloadAgentSessionInternal(agentId, overrides, options) {
        this.assertAcceptingAgentRegistrations();
        let existing = this.requireSessionAgent(agentId);
        if (this.hasInFlightRun(agentId)) {
            await this.cancelAgentRunBefore(agentId, "reload");
            existing = this.requireSessionAgent(agentId);
        }
        const rehydrateFromDisk = options?.rehydrateFromDisk ?? false;
        const preservedHistoryPrimed = existing.historyPrimed;
        const preservedLastUsage = existing.lastUsage;
        const preservedLastError = existing.lastError;
        const preservedAttention = existing.attention;
        const handle = existing.persistence;
        const provider = handle?.provider ?? existing.provider;
        const client = this.requireClient(provider);
        const refreshConfig = {
            ...existing.config,
            ...overrides,
            provider,
        };
        const { storedConfig, launchConfig, paseoToolPolicy } = await this.prepareSessionConfig(refreshConfig, agentId);
        const hadPreviousPaseoToolPolicy = this.paseoToolPolicies.has(agentId);
        const previousPaseoToolPolicy = this.paseoToolPolicies.get(agentId);
        const launchContext = await this.buildLaunchContext(agentId, client, storedConfig.cwd, paseoToolPolicy, undefined, { reason: "refresh", purpose: "interactive", workspaceId: existing.workspaceId });
        const providerLaunchConfig = this.resolveProviderLaunchConfig(launchConfig, launchContext);
        if (Object.keys(storedConfig.mcpServers ?? {}).length > 0 &&
            existing.session.capabilities.supportsMcpServers !== true) {
            throw new Error(`Provider '${provider}' does not support MCP servers`);
        }
        let session;
        let closedExisting;
        let handedToRegistration = false;
        try {
            // A persisted thread can have only one writer, even when its turn is idle.
            await this.closeReloadedSession(existing.session, agentId);
            await this.drainSessionEvents(agentId);
            this.cancelRunningProviderSubagents(agentId);
            closedExisting = this.prepareAgentForClosure(existing, "agent reloaded");
            await this.persistSnapshot(closedExisting);
            this.assertAcceptingAgentRegistrations();
            this.paseoToolPolicies.set(agentId, paseoToolPolicy);
            session = handle
                ? await client.resumeSession(handle, providerLaunchConfig, launchContext)
                : await client.createSession(providerLaunchConfig, launchContext);
            await this.requireExternalMcpSupport(session, storedConfig);
            this.assertAcceptingAgentRegistrations();
            if (rehydrateFromDisk) {
                // Wipe the in-memory timeline so registerSession mints a new epoch and
                // hydrateTimelineFromProvider re-streams the freshly read provider history.
                this.timelineStore.delete(agentId);
                for (const event of this.providerSubagents.deleteParent(agentId)) {
                    this.dispatch({ type: "provider_subagent", event });
                }
            }
            // Preserve existing labels and timeline during reload.
            handedToRegistration = true;
            return this.registerSession(session, storedConfig, agentId, {
                labels: existing.labels,
                workspaceId: existing.workspaceId,
                owner: existing.owner,
                createdAt: existing.createdAt,
                updatedAt: existing.updatedAt,
                lastUserMessageAt: existing.lastUserMessageAt,
                historyPrimed: rehydrateFromDisk ? false : preservedHistoryPrimed,
                lastUsage: preservedLastUsage,
                lastError: preservedLastError,
                attention: preservedAttention,
                restoring: true,
            });
        }
        catch (error) {
            if (closedExisting) {
                this.emitClosedAgent(closedExisting, { persist: false });
            }
            else if (this.agents.get(agentId) === existing) {
                existing.lifecycle = "error";
                existing.lastError = error instanceof Error ? error.message : String(error);
                this.emitState(existing);
            }
            throw error;
        }
        finally {
            if (!handedToRegistration) {
                if (hadPreviousPaseoToolPolicy) {
                    this.paseoToolPolicies.set(agentId, previousPaseoToolPolicy);
                }
                else {
                    this.paseoToolPolicies.delete(agentId);
                }
                if (session) {
                    await this.closeUnregisteredSession(session);
                }
            }
        }
    }
    async closeReloadedSession(session, agentId) {
        let operation = this.reloadedSessionCloses.get(session);
        if (!operation) {
            operation = session.close();
            this.reloadedSessionCloses.set(session, operation);
            // Keep pending closes across request timeouts; a retry must await the same release.
            void operation.catch(() => this.reloadedSessionCloses.delete(session));
        }
        const result = await this.waitWithTimeout({
            operation,
            timeoutMs: this.rescueTimeouts.reloadSessionCloseMs,
            onLateError: (error) => {
                this.logger.warn({ err: error, agentId }, "Previous session close failed after refresh timeout");
            },
        });
        if (result === "timed_out") {
            throw new Error("Timed out closing previous session during refresh");
        }
    }
    async waitWithTimeout(options) {
        let didTimeOut = false;
        let timer = null;
        const operation = options.operation
            .then(() => "completed")
            .catch((error) => {
            if (didTimeOut) {
                options.onLateError?.(error);
                return "timed_out";
            }
            throw error;
        });
        try {
            return await Promise.race([
                operation,
                new Promise((resolvePromise) => {
                    timer = setTimeout(() => {
                        didTimeOut = true;
                        resolvePromise("timed_out");
                    }, options.timeoutMs);
                }),
            ]);
        }
        finally {
            if (timer) {
                clearTimeout(timer);
            }
        }
    }
    closeAgent(agentId) {
        const existing = this.inFlightAgentCloses.get(agentId);
        if (existing) {
            return existing;
        }
        const close = this.runLifecycleMutation(agentId, async () => {
            // A preceding reload or archive may already have closed the durable agent.
            if (this.agents.has(agentId))
                await this.closeAgentRuntime(agentId);
        });
        this.inFlightAgentCloses.set(agentId, close);
        const clearClose = () => {
            if (this.inFlightAgentCloses.get(agentId) === close) {
                this.inFlightAgentCloses.delete(agentId);
            }
        };
        void close.then(clearClose, clearClose);
        return close;
    }
    async closeAgentRuntime(agentId) {
        const agent = this.requireAgent(agentId);
        this.logger.trace({
            agentId,
            provider: agent.provider,
            sessionId: agent.persistence?.sessionId ?? undefined,
            turnId: agent.activeForegroundTurnId ?? undefined,
            lifecycle: agent.lifecycle,
            activeForegroundTurnId: agent.activeForegroundTurnId,
            pendingPermissions: agent.pendingPermissions.size,
        }, "agent.manager.close.start");
        await this.drainSessionEvents(agentId);
        // Retain ownership until shutdown succeeds. A failed close may still own a
        // native writer, so publishing a resumable closed snapshot would orphan it.
        await agent.session.close();
        this.cancelRunningProviderSubagents(agentId);
        const closedAgent = this.prepareAgentForClosure(agent, "agent closed");
        let persistError;
        try {
            await this.persistSnapshot(closedAgent);
        }
        catch (error) {
            persistError = error;
        }
        this.emitClosedAgent(closedAgent, { persist: false });
        this.logger.trace({
            agentId,
            provider: closedAgent.provider,
            sessionId: closedAgent.persistence?.sessionId ?? undefined,
        }, "agent.manager.close.complete");
        if (persistError !== undefined) {
            throw persistError;
        }
    }
    cancelRunningProviderSubagents(parentAgentId) {
        for (const subagent of this.providerSubagents.list(parentAgentId)) {
            if (subagent.status !== "running") {
                continue;
            }
            const event = this.providerSubagents.apply(parentAgentId, subagent.provider, {
                type: "upsert",
                id: subagent.id,
                status: "canceled",
            });
            this.dispatch({ type: "provider_subagent", event });
        }
    }
    async archiveAgent(agentId) {
        return this.runLifecycleMutation(agentId, () => this.archiveAgentUnlocked(agentId));
    }
    async archiveAgentUnlocked(agentId, requestedArchivedAt) {
        const agent = this.requireAgent(agentId);
        if (!this.registry) {
            throw new Error("Agent storage is not configured");
        }
        await this.registry.applySnapshot(agent, {
            internal: agent.internal,
        });
        const stored = await this.registry.get(agentId);
        if (!stored) {
            throw new Error(`Agent ${agentId} not found in storage after snapshot`);
        }
        const { archivedAt } = await this.markRecordArchived(stored, requestedArchivedAt);
        agent.updatedAt = new Date(archivedAt);
        await this.closeAgentRuntime(agentId);
        await this.syncNativeArchiveState(stored.provider, stored.persistence, "archive");
        this.discardRetainedAgentState(agentId);
        await this.cascadeArchiveChildren(agentId);
        return { archivedAt };
    }
    // Children created via the MCP `create_agent` tool carry the parent-agent-id
    // label pointing back at the caller. Archiving the parent cascades to those
    // children so subagent fleets don't outlive their orchestrator. Detached
    // handoff agents omit this label, so they stand outside the cascade.
    async cascadeArchiveChildren(parentAgentId) {
        const registry = this.registry;
        if (!registry) {
            return;
        }
        const records = await registry.list();
        const parent = records.find((record) => record.id === parentAgentId);
        if (!parent) {
            throw new Error(`Archived parent ${parentAgentId} not found in storage`);
        }
        for (const record of records) {
            if (record.archivedAt) {
                continue;
            }
            if (record.labels?.[PARENT_AGENT_ID_LABEL] !== parentAgentId) {
                continue;
            }
            const child = await registry.get(record.id);
            if (!child || child.archivedAt || child.labels?.[PARENT_AGENT_ID_LABEL] !== parentAgentId) {
                continue;
            }
            await this.runLifecycleMutation(child.id, async () => {
                const currentChild = await registry.get(child.id);
                if (!currentChild ||
                    currentChild.archivedAt ||
                    currentChild.labels?.[PARENT_AGENT_ID_LABEL] !== parentAgentId) {
                    return;
                }
                if (shouldDetachFromArchivedParent(parent, currentChild)) {
                    await this.detachAgentUnlocked(currentChild.id);
                }
                else if (this.agents.has(currentChild.id)) {
                    await this.archiveAgentUnlocked(currentChild.id);
                }
                else {
                    await this.archiveSnapshotUnlocked(currentChild.id, new Date().toISOString());
                }
            });
        }
    }
    async markRecordArchived(record, archivedAt = new Date().toISOString()) {
        const archivedRecord = await this.persistArchivedRecord(record, {
            archivedAt,
            updatedAt: archivedAt,
        });
        if (this.agents.has(record.id)) {
            this.notifyAgentState(record.id);
        }
        else if (!archivedRecord.internal) {
            this.dispatchStoredAgentState(archivedRecord);
        }
        await this.fireAgentArchived(record.id);
        return archivedRecord;
    }
    async persistArchivedRecord(record, options) {
        const archivedRecord = buildArchivedAgentRecord(record, options);
        await this.requireRegistry().upsert(archivedRecord);
        if (!record.archivedAt && !record.internal) {
            this.pluginLifecycle?.emit("agent.archived", {
                agent: describeHookAgent(archivedRecord),
                archivedAt: archivedRecord.archivedAt,
            });
        }
        return archivedRecord;
    }
    async fireAgentArchived(agentId) {
        const callback = this.onAgentArchived;
        if (!callback) {
            return;
        }
        try {
            await callback(agentId);
        }
        catch (error) {
            this.logger.warn({ err: error, agentId }, "onAgentArchived callback failed");
        }
    }
    dispatchStoredAgentState(record) {
        const updatedAt = new Date(record.updatedAt);
        const attention = extractAttention(record);
        this.dispatch({
            type: "agent_state",
            agent: {
                id: record.id,
                provider: record.provider,
                cwd: record.cwd,
                workspaceId: record.workspaceId,
                owner: record.owner,
                session: null,
                capabilities: STORED_AGENT_CAPABILITIES,
                config: buildStoredAgentConfig(record),
                runtimeInfo: undefined,
                lifecycle: "closed",
                createdAt: new Date(record.createdAt),
                updatedAt,
                availableModes: [],
                features: record.features,
                currentModeId: record.lastModeId ?? null,
                pendingPermissions: new Map(),
                bufferedPermissionResolutions: new Map(),
                inFlightPermissionResponses: new Set(),
                pendingReplacement: false,
                activeForegroundTurnId: null,
                activeTurnId: null,
                activeTurnStartedAt: null,
                foregroundTurnWaiters: new Set(),
                finalizedForegroundTurnIds: new Set(),
                unsubscribeSession: null,
                persistence: record.persistence ?? null,
                historyPrimed: true,
                lastUserMessageAt: record.lastUserMessageAt ? new Date(record.lastUserMessageAt) : null,
                lastUsage: undefined,
                lastError: record.lastError ?? undefined,
                attention,
                internal: record.internal,
                labels: record.labels,
            },
        });
    }
    async setAgentMode(agentId, modeId) {
        const agent = this.requireSessionAgent(agentId);
        const notice = (await agent.session.setMode(modeId)) ?? null;
        await this.drainSessionEvents(agentId);
        const currentMode = (await agent.session.getCurrentMode()) ?? modeId;
        agent.config.modeId = currentMode ?? undefined;
        agent.currentModeId = currentMode;
        // Update runtimeInfo to reflect the new mode
        if (agent.runtimeInfo) {
            agent.runtimeInfo = { ...agent.runtimeInfo, modeId: currentMode };
        }
        this.touchUpdatedAt(agent);
        this.emitState(agent);
        return notice;
    }
    async setAgentModel(agentId, modelId) {
        const agent = this.requireSessionAgent(agentId);
        const normalizedModelId = typeof modelId === "string" && modelId.trim().length > 0 ? modelId : null;
        if (agent.session.setModel) {
            await agent.session.setModel(normalizedModelId);
        }
        await this.drainSessionEvents(agentId);
        agent.config.model = normalizedModelId ?? undefined;
        if (agent.runtimeInfo) {
            agent.runtimeInfo = { ...agent.runtimeInfo, model: normalizedModelId };
        }
        this.refreshSessionPersistence(agent);
        this.touchUpdatedAt(agent);
        this.emitState(agent);
    }
    async setAgentThinkingOption(agentId, thinkingOptionId) {
        const agent = this.requireSessionAgent(agentId);
        const normalizedThinkingOptionId = typeof thinkingOptionId === "string" && thinkingOptionId.trim().length > 0
            ? thinkingOptionId
            : null;
        let notice = null;
        if (agent.session.setThinkingOption) {
            notice = (await agent.session.setThinkingOption(normalizedThinkingOptionId)) ?? null;
        }
        await this.drainSessionEvents(agentId);
        let effectiveThinkingOptionId = normalizedThinkingOptionId;
        const runtimeInfo = await agent.session.getRuntimeInfo();
        if (runtimeInfo.thinkingOptionId !== undefined) {
            effectiveThinkingOptionId = runtimeInfo.thinkingOptionId;
        }
        agent.config.thinkingOptionId = effectiveThinkingOptionId ?? undefined;
        if (agent.runtimeInfo) {
            agent.runtimeInfo = {
                ...agent.runtimeInfo,
                thinkingOptionId: effectiveThinkingOptionId,
            };
        }
        this.touchUpdatedAt(agent);
        this.emitState(agent);
        return notice;
    }
    async setAgentFeature(agentId, featureId, value) {
        const agent = this.requireAgent(agentId);
        if (!agent.session.setFeature) {
            throw new Error("Agent session does not support setting features");
        }
        await agent.session.setFeature(featureId, value);
        await this.drainSessionEvents(agentId);
        agent.config.featureValues = { ...agent.config.featureValues, [featureId]: value };
        this.touchUpdatedAt(agent);
        this.emitState(agent);
    }
    async setTitle(agentId, title) {
        const agent = this.requireAgent(agentId);
        const normalizedTitle = title.trim();
        if (!normalizedTitle) {
            return;
        }
        if (this.agentsAwaitingInitialSnapshotPersist.has(agent.id) &&
            this.registry &&
            (await this.registry.get(agent.id)) === null) {
            return;
        }
        this.touchUpdatedAt(agent);
        await this.persistSnapshot(agent, { title: normalizedTitle });
        this.emitState(agent, { persist: false });
    }
    async setLabels(agentId, labels) {
        await this.runLifecycleMutation(agentId, async () => {
            const agent = this.requireAgent(agentId);
            await this.writeLabels(agent.id, labels);
        });
    }
    async writeLabels(agentId, patch) {
        const liveAgent = this.agents.get(agentId);
        if (liveAgent) {
            liveAgent.labels = applyLabelPatch(liveAgent.labels, patch);
            this.touchUpdatedAt(liveAgent);
            await this.persistSnapshot(liveAgent);
            this.emitState(liveAgent, { persist: false });
            const record = this.registry ? await this.registry.get(agentId) : null;
            return { record, live: true };
        }
        const nextRecord = await this.writeStoredMetadata(agentId, { labels: patch });
        return { record: nextRecord, live: false };
    }
    async writeStoredMetadata(agentId, patch) {
        const registry = this.requireRegistry();
        const record = await registry.get(agentId);
        if (!record) {
            throw new Error(`Agent not found: ${agentId}`);
        }
        const nextRecord = {
            ...record,
            ...(patch.title ? { title: patch.title } : {}),
            ...(patch.labels ? { labels: applyLabelPatch(record.labels, patch.labels) } : {}),
            updatedAt: this.nextStoredUpdatedAt(record),
        };
        await registry.upsert(nextRecord);
        return nextRecord;
    }
    async detachAgent(agentId) {
        return this.runLifecycleMutation(agentId, () => this.detachAgentUnlocked(agentId));
    }
    async detachAgentUnlocked(agentId) {
        const registry = this.requireRegistry();
        const liveAgent = this.agents.get(agentId);
        if (liveAgent) {
            const previousParentAgentId = getParentAgentIdFromLabels(liveAgent.labels);
            if (!previousParentAgentId) {
                await this.persistSnapshot(liveAgent);
                const record = await registry.get(agentId);
                if (!record) {
                    throw new Error(`Agent not found in storage after detach: ${agentId}`);
                }
                return { record, live: true, previousParentAgentId: null };
            }
            const { record } = await this.writeLabels(agentId, detachedAgentLabelPatch(liveAgent.labels));
            if (!record) {
                throw new Error(`Agent not found in storage after detach: ${agentId}`);
            }
            return { record, live: true, previousParentAgentId };
        }
        const record = await registry.get(agentId);
        if (!record) {
            throw new Error(`Agent not found: ${agentId}`);
        }
        const previousParentAgentId = getParentAgentIdFromLabels(record.labels);
        if (!previousParentAgentId) {
            return { record, live: false, previousParentAgentId: null };
        }
        const result = await this.writeLabels(agentId, detachedAgentLabelPatch(record.labels));
        if (!result.record) {
            throw new Error(`Agent not found in storage after detach: ${agentId}`);
        }
        return { record: result.record, live: false, previousParentAgentId };
    }
    notifyAgentState(agentId) {
        const agent = this.agents.get(agentId);
        if (!agent || agent.internal) {
            return;
        }
        this.touchUpdatedAt(agent);
        this.emitState(agent);
    }
    async clearAgentAttention(agentId) {
        const agent = this.requireAgent(agentId);
        if (agent.attention.requiresAttention) {
            agent.attention = { requiresAttention: false };
            await this.persistSnapshot(agent);
            this.emitState(agent, { persist: false });
        }
    }
    async markAgentUnread(agentId) {
        const liveAgent = this.agents.get(agentId);
        if (liveAgent) {
            const isFinished = liveAgent.lifecycle === "idle";
            const hasPendingPermissions = liveAgent.pendingPermissions.size > 0;
            const canMarkUnread = isFinished && !liveAgent.attention.requiresAttention && !hasPendingPermissions;
            if (!canMarkUnread) {
                throw new Error(`Agent is no longer finished and read: ${agentId}`);
            }
            liveAgent.attention = {
                requiresAttention: true,
                attentionReason: "finished",
                attentionTimestamp: new Date(),
            };
            await this.persistSnapshot(liveAgent);
            this.emitState(liveAgent, { persist: false });
            return;
        }
        const registry = this.requireRegistry();
        const record = await registry.get(agentId);
        const hasFinishedStatus = record?.lastStatus === "idle" || record?.lastStatus === "closed";
        const canMarkUnread = record && !record.internal && !record.archivedAt && !record.requiresAttention;
        if (!canMarkUnread || !hasFinishedStatus) {
            throw new Error(`Agent is no longer finished and read: ${agentId}`);
        }
        const updatedAt = this.nextStoredUpdatedAt(record);
        const nextRecord = {
            ...record,
            updatedAt,
            requiresAttention: true,
            attentionReason: "finished",
            attentionTimestamp: updatedAt,
        };
        await registry.upsert(nextRecord);
        this.dispatchStoredAgentState(nextRecord);
    }
    async archiveSnapshot(agentId, archivedAt) {
        return this.runLifecycleMutation(agentId, () => this.archiveSnapshotUnlocked(agentId, archivedAt));
    }
    async archiveSnapshotUnlocked(agentId, archivedAt) {
        const registry = this.requireRegistry();
        // A stored-only archive can have waited behind a persisted resume. Reuse the
        // live archive transition so its newly acquired runtime is closed as well.
        if (this.agents.has(agentId)) {
            await this.archiveAgentUnlocked(agentId, archivedAt);
            const archivedRecord = await registry.get(agentId);
            if (!archivedRecord)
                throw new Error(`Agent not found: ${agentId}`);
            return archivedRecord;
        }
        const record = await registry.get(agentId);
        if (!record) {
            throw new Error(`Agent not found: ${agentId}`);
        }
        const nextRecord = await this.persistArchivedRecord(record, { archivedAt });
        await this.syncNativeArchiveState(record.provider, record.persistence, "archive");
        this.discardRetainedAgentState(agentId);
        if (!nextRecord.internal)
            this.dispatchStoredAgentState(nextRecord);
        await this.fireAgentArchived(agentId);
        await this.cascadeArchiveChildren(agentId);
        return nextRecord;
    }
    async unarchiveSnapshot(agentId, updates) {
        return this.runLifecycleMutation(agentId, () => this.unarchiveSnapshotUnlocked(agentId, updates));
    }
    async unarchiveSnapshotUnlocked(agentId, updates) {
        const registry = this.requireRegistry();
        const record = await registry.get(agentId);
        if (!record || !record.archivedAt) {
            return false;
        }
        // Close and native restore share the lifecycle lane with persisted resume.
        // No new history or interactive runtime can acquire the writer between them.
        if (this.agents.has(agentId))
            await this.closeAgentRuntime(agentId);
        await this.syncNativeArchiveState(record.provider, record.persistence, "restore");
        await registry.upsert({
            ...record,
            ...(updates?.workspaceId ? { workspaceId: updates.workspaceId } : {}),
            ...(updates?.labels ? { labels: applyLabelPatch(record.labels, updates.labels) } : {}),
            archivedAt: null,
            updatedAt: new Date().toISOString(),
        });
        if (this.getAgent(agentId)) {
            this.notifyAgentState(agentId);
        }
        return true;
    }
    async unarchiveSnapshotByHandle(handle) {
        const registry = this.requireRegistry();
        const records = await registry.list();
        const matched = records.find((record) => record.persistence?.provider === handle.provider &&
            record.persistence?.sessionId === handle.sessionId);
        if (!matched) {
            return;
        }
        await this.unarchiveSnapshot(matched.id);
    }
    async updateAgentMetadata(agentId, updates) {
        await this.runLifecycleMutation(agentId, () => this.updateAgentMetadataUnlocked(agentId, updates));
    }
    async updateAgentMetadataUnlocked(agentId, updates) {
        const liveAgent = this.getAgent(agentId);
        if (liveAgent) {
            if (updates.title) {
                await this.setTitle(agentId, updates.title);
            }
            if (updates.labels) {
                await this.writeLabels(agentId, updates.labels);
            }
            return;
        }
        await this.writeStoredMetadata(agentId, updates);
    }
    async runLifecycleMutation(agentId, mutation) {
        // Parent cascade classifies a child inside the same lane used by open-tab
        // label writes, so a received ownership update cannot be overtaken.
        const previous = this.lifecycleMutationTails.get(agentId) ?? Promise.resolve();
        const result = previous.catch(() => undefined).then(mutation);
        const tail = result.then(() => undefined, () => undefined);
        this.lifecycleMutationTails.set(agentId, tail);
        void tail.finally(() => {
            if (this.lifecycleMutationTails.get(agentId) === tail) {
                this.lifecycleMutationTails.delete(agentId);
            }
        });
        return result;
    }
    async runAgent(agentId, prompt, options) {
        const events = this.streamAgent(agentId, prompt, options);
        const timeline = [];
        let finalText = "";
        let usage;
        let canceled = false;
        for await (const event of events) {
            if (event.type === "timeline") {
                timeline.push(event.item);
            }
            else if (event.type === "turn_completed") {
                usage = event.usage;
            }
            else if (event.type === "turn_failed") {
                throw new Error(this.formatTurnFailedMessage(event));
            }
            else if (event.type === "turn_canceled") {
                canceled = true;
            }
        }
        finalText = this.getLastAssistantMessageFromTimeline(timeline) ?? "";
        const agent = this.requireAgent(agentId);
        const sessionId = agent.persistence?.sessionId;
        if (!sessionId) {
            throw new Error(`Agent ${agentId} has no persistence.sessionId after run completed`);
        }
        return {
            sessionId,
            finalText,
            usage,
            timeline,
            canceled,
        };
    }
    /**
     * Try to run a prompt out-of-band — i.e. without allocating a foreground turn
     * and without canceling any active turn. Returns true when the session
     * accepted the prompt as a side-effect command (e.g. /goal pause). Events
     * emitted by the handler flow through dispatchStream so they persist and
     * broadcast like normal timeline events.
     */
    tryRunOutOfBand(agentId, prompt, options) {
        const agent = this.requireSessionAgent(agentId);
        const handler = agent.session.tryHandleOutOfBand?.(prompt);
        if (!handler) {
            return false;
        }
        if (options?.clientMessageId) {
            this.recordSubmittedPrompt(agent, prompt, options.clientMessageId);
            this.emitState(agent);
        }
        const dispatch = (event) => {
            // Persist timeline items so they show up in fetchAgentTimeline; broadcast
            // for live subscribers. Other event types are broadcast only.
            if (event.type === "timeline") {
                this.touchUpdatedAt(agent);
                const row = this.recordTimeline(agent.id, event.item);
                this.dispatchStream(agent.id, event, {
                    seq: row.seq,
                    epoch: this.timelineStore.getEpoch(agent.id),
                    timestamp: row.timestamp,
                });
                return;
            }
            this.dispatchStream(agent.id, event, { timestamp: new Date().toISOString() });
        };
        void (async () => {
            try {
                await handler.run({ emit: dispatch });
            }
            catch (error) {
                const text = error instanceof Error ? error.message : "Out-of-band command failed";
                dispatch({
                    type: "timeline",
                    provider: agent.provider,
                    item: { type: "assistant_message", text: `[Error] ${text}` },
                });
            }
        })();
        return true;
    }
    async appendTimelineItem(agentId, item) {
        const agent = this.requireAgent(agentId);
        item = limitAgentTimelineItemContent(item);
        this.touchUpdatedAt(agent);
        const row = this.recordTimeline(agentId, item);
        this.dispatchStream(agentId, {
            type: "timeline",
            item,
            provider: agent.provider,
        }, {
            seq: row.seq,
            epoch: this.timelineStore.getEpoch(agentId),
            timestamp: row.timestamp,
        });
        await this.persistSnapshot(agent);
        return { seq: row.seq, epoch: this.timelineStore.getEpoch(agentId) };
    }
    async emitLiveTimelineItem(agentId, item) {
        const agent = this.requireAgent(agentId);
        this.touchUpdatedAt(agent);
        this.dispatchStream(agentId, {
            type: "timeline",
            item,
            provider: agent.provider,
        });
    }
    async startPendingForegroundTurn(params) {
        const { agent, agentId, pendingRun, prompt, options } = params;
        try {
            const result = await agent.session.startTurn(prompt, options);
            if (pendingRun.settled) {
                throw new Error(`Agent ${agentId} run was canceled before its turn started`);
            }
            return result.turnId;
        }
        catch (error) {
            if (pendingRun.settled) {
                throw error;
            }
            if (isStaleProviderSessionError(error)) {
                pendingRun.start = { status: "failed", error: error.message };
                agent.pendingReplacement = false;
                if (!agent.activeForegroundTurnId)
                    agent.lifecycle = "idle";
                this.runs.settleForegroundRun(agentId, pendingRun.token);
                throw error;
            }
            agent.pendingReplacement = false;
            const errorMsg = error instanceof Error ? error.message : "Failed to start turn";
            pendingRun.start = { status: "failed", error: errorMsg };
            await this.handleStreamEvent(agent, {
                type: "turn_failed",
                provider: agent.provider,
                error: errorMsg,
            });
            this.finalizeForegroundTurn(agent);
            this.runs.settleForegroundRun(agentId, pendingRun.token);
            throw error;
        }
    }
    streamAgent(agentId, prompt, options) {
        const existingAgent = this.requireSessionAgent(agentId);
        this.logger.trace({
            agentId,
            provider: existingAgent.provider,
            sessionId: existingAgent.persistence?.sessionId ?? undefined,
            turnId: existingAgent.activeForegroundTurnId ?? undefined,
            lifecycle: existingAgent.lifecycle,
            activeForegroundTurnId: existingAgent.activeForegroundTurnId,
            hasTrackedRun: this.runs.hasRun(agentId),
            promptType: typeof prompt === "string" ? "string" : "structured",
            hasRunOptions: Boolean(options),
        }, "agent.manager.stream.request");
        if (existingAgent.activeForegroundTurnId || this.runs.hasRun(agentId)) {
            this.logger.trace({
                agentId,
                provider: existingAgent.provider,
                sessionId: existingAgent.persistence?.sessionId ?? undefined,
                turnId: existingAgent.activeForegroundTurnId ?? undefined,
                lifecycle: existingAgent.lifecycle,
                hasTrackedRun: this.runs.hasRun(agentId),
            }, "agent.manager.stream.reject");
            throw new Error(`Agent ${agentId} already has an active run`);
        }
        const agent = existingAgent;
        const isReplacement = agent.pendingReplacement;
        agent.lastError = undefined;
        const pendingRun = this.runs.createPendingRun(agentId);
        const streamForwarder = async function* streamForwarder() {
            let turnId;
            let turnStream = null;
            turnId = await this.startPendingForegroundTurn({
                agent,
                agentId,
                pendingRun,
                prompt,
                options,
            });
            if (isReplacement) {
                agent.pendingReplacement = false;
            }
            const turnStartedAt = new Date();
            pendingRun.start = { status: "started", turnId };
            agent.activeForegroundTurnId = turnId;
            this.openActiveTurn(agent, turnId, turnStartedAt);
            agent.lifecycle = "running";
            this.touchUpdatedAt(agent);
            // AgentManager owns the accepted-turn boundary. Publish liveness before the canonical
            // prompt so clients can retire optimistic activity without painting an idle frame.
            // The provider's duplicate start for this turn is suppressed at the ingestion boundary.
            this.dispatchStream(agent.id, { type: "turn_started", provider: agent.provider, turnId }, { timestamp: turnStartedAt.toISOString() });
            const stagedSubmittedPromptEcho = options?.clientMessageId
                ? pendingRun.stagedEvents.find((event) => event.type === "timeline" &&
                    event.item.type === "user_message" &&
                    event.item.clientMessageId === options.clientMessageId)
                : undefined;
            if (options?.clientMessageId) {
                this.recordSubmittedPrompt(agent, prompt, options.clientMessageId, {
                    messageId: options.clientMessageId,
                    turnId,
                    providerMessageId: stagedSubmittedPromptEcho?.item.type === "user_message"
                        ? stagedSubmittedPromptEcho.item.messageId
                        : undefined,
                });
            }
            for (const stagedEvent of pendingRun.stagedEvents.splice(0)) {
                const isAcceptedTurnStart = stagedEvent.type === "turn_started" && getAgentStreamEventTurnId(stagedEvent) === turnId;
                if (isAcceptedTurnStart || stagedEvent === stagedSubmittedPromptEcho) {
                    continue;
                }
                this.enqueueSessionEvent(agent.id, stagedEvent);
            }
            this.emitState(agent);
            this.logger.trace({
                agentId,
                provider: agent.provider,
                sessionId: agent.persistence?.sessionId ?? undefined,
                turnId,
                lifecycle: agent.lifecycle,
                activeForegroundTurnId: agent.activeForegroundTurnId,
            }, "agent.manager.stream.start");
            turnStream = this.runs.createTurnStream(turnId);
            this.runs.addWaiter(agent, turnStream.waiter);
            try {
                const acceptedTurnStartedEvent = {
                    type: "turn_started",
                    provider: agent.provider,
                    turnId,
                };
                yield acceptedTurnStartedEvent;
                for await (const event of turnStream.events(isTurnTerminalEvent)) {
                    yield event;
                }
            }
            finally {
                if (turnStream) {
                    this.runs.deleteWaiter(agent, turnStream.waiter);
                }
                this.runs.settleForegroundRun(agentId, pendingRun.token);
                if (!agent.activeForegroundTurnId) {
                    await this.refreshRuntimeInfo(agent);
                }
            }
        }.call(this);
        return streamForwarder;
    }
    finalizeForegroundTurn(agent, turnId) {
        const mutableAgent = agent;
        if (turnId) {
            this.runs.rememberFinalizedTurn(mutableAgent, turnId);
        }
        mutableAgent.activeForegroundTurnId = null;
        this.applyActiveTurnTerminal(mutableAgent, turnId);
        const terminalError = mutableAgent.lastError;
        const shouldHoldBusyForReplacement = mutableAgent.pendingReplacement && !terminalError;
        let nextLifecycle;
        if (shouldHoldBusyForReplacement) {
            nextLifecycle = "running";
        }
        else if (terminalError) {
            nextLifecycle = "error";
        }
        else {
            nextLifecycle = "idle";
        }
        mutableAgent.lifecycle = nextLifecycle;
        const persistenceHandle = mutableAgent.session.describePersistence() ??
            (mutableAgent.runtimeInfo?.sessionId
                ? { provider: mutableAgent.provider, sessionId: mutableAgent.runtimeInfo.sessionId }
                : null);
        if (persistenceHandle) {
            mutableAgent.persistence = attachPersistenceCwd(persistenceHandle, mutableAgent.cwd);
        }
        this.logger.trace({
            agentId: agent.id,
            provider: agent.provider,
            sessionId: mutableAgent.persistence?.sessionId ?? undefined,
            turnId,
            lifecycle: mutableAgent.lifecycle,
            terminalError,
            pendingReplacement: mutableAgent.pendingReplacement,
        }, "agent.manager.finalize");
        if (!shouldHoldBusyForReplacement) {
            this.touchUpdatedAt(mutableAgent);
            this.emitState(mutableAgent);
        }
    }
    openActiveTurn(agent, turnId, startedAt) {
        agent.activeTurnId = turnId;
        agent.activeTurnStartedAt = startedAt;
    }
    applyActiveTurnTerminal(agent, turnId, fromHistory = false) {
        if (fromHistory)
            return "stale";
        if (!agent.activeTurnId)
            return "untracked";
        if (turnId && agent.activeTurnId !== turnId)
            return "stale";
        agent.activeTurnId = null;
        agent.activeTurnStartedAt = null;
        return "closed_current";
    }
    async replaceAgentRun(agentId, prompt, options) {
        const snapshot = this.requireAgent(agentId);
        if (snapshot.lifecycle !== "running" &&
            !snapshot.activeForegroundTurnId &&
            !this.runs.hasRun(agentId)) {
            return this.streamAgent(agentId, prompt, options);
        }
        const agent = this.requireSessionAgent(agentId);
        agent.pendingReplacement = true;
        agent.lifecycle = "running";
        this.touchUpdatedAt(agent);
        this.emitState(agent);
        try {
            await this.cancelAgentRunBefore(agentId, "replace");
            return this.streamAgent(agentId, prompt, options);
        }
        catch (error) {
            const latest = this.agents.get(agentId);
            if (latest) {
                latest.pendingReplacement = false;
            }
            throw error;
        }
    }
    async steerAgentRun(agentId, prompt, options) {
        const agent = this.requireSessionAgent(agentId);
        const expectedTurnId = agent.activeForegroundTurnId ?? agent.activeTurnId;
        if (!expectedTurnId || !agent.session.steerActiveTurn) {
            return { status: "unavailable" };
        }
        const result = await this.runSteerAdmission(agent, expectedTurnId, async () => {
            const admission = await agent.session.steerActiveTurn(prompt, {
                ...options,
                expectedTurnId,
            });
            if (admission.status === "accepted") {
                await this.recordAcceptedSteer(agent, prompt, options?.clientMessageId, expectedTurnId);
            }
            return admission;
        });
        // An unavailable answer is only safe to fall back from while this admission
        // still owns the active turn. Never let an A admission replace a later B.
        if (result.status === "unavailable" && agent.activeTurnId !== expectedTurnId) {
            throw new Error("Active turn changed before steering could be delivered");
        }
        return result;
    }
    async steerOrReplaceActiveTurn(agentId, prompt, options) {
        const agent = this.requireSessionAgent(agentId);
        const expectedTurnId = agent.activeForegroundTurnId ?? agent.activeTurnId;
        if (!expectedTurnId) {
            return { status: "inactive" };
        }
        const result = agent.session.steerActiveTurn
            ? await this.runSteerAdmission(agent, expectedTurnId, async () => {
                const admission = await agent.session.steerActiveTurn(prompt, {
                    ...options,
                    expectedTurnId,
                });
                if (admission.status === "accepted") {
                    await this.recordAcceptedSteer(agent, prompt, options?.clientMessageId, expectedTurnId);
                }
                return admission;
            })
            : { status: "unavailable" };
        if (result.status === "accepted") {
            return { status: "steered" };
        }
        // Providers without autonomous steering keep their existing dispatch behavior. The shared
        // admission may recognize the turn, but only an accepted steer can own it without replacement.
        if (agent.activeForegroundTurnId === null && agent.activeTurnId === expectedTurnId) {
            return { status: "inactive" };
        }
        await this.beforeSteerUnavailableFallback?.({ agentId, expectedTurnId });
        this.assertSteerAdmissionOwnsTurn(agent, expectedTurnId);
        return {
            status: "replaced",
            iterator: await this.replaceAdmittedForegroundTurn(agent, expectedTurnId, prompt, stripSteerOptions(options)),
        };
    }
    assertSteerAdmissionOwnsTurn(agent, expectedTurnId) {
        if (agent.activeTurnId !== expectedTurnId) {
            throw new Error("Active turn changed before steering could be delivered");
        }
    }
    async runSteerAdmission(agent, expectedTurnId, operation) {
        return this.runForegroundMutation(agent.id, async () => {
            await this.drainSessionEvents(agent.id);
            this.agentStreamCoalescer.flushFor(agent.id);
            this.assertSteerAdmissionOwnsTurn(agent, expectedTurnId);
            const barrier = { events: [] };
            this.steerEventBarriers.set(agent.id, barrier);
            try {
                return await operation();
            }
            finally {
                if (this.steerEventBarriers.get(agent.id) === barrier) {
                    this.steerEventBarriers.delete(agent.id);
                }
                for (const event of barrier.events) {
                    this.enqueueSessionEvent(agent.id, event);
                }
                await this.drainSessionEvents(agent.id);
            }
        });
    }
    async runForegroundMutation(agentId, operation) {
        const previous = this.foregroundMutationTails.get(agentId) ?? Promise.resolve();
        const run = previous.catch(() => undefined).then(operation);
        const tail = run.then(() => undefined, () => undefined);
        this.foregroundMutationTails.set(agentId, tail);
        try {
            return await run;
        }
        finally {
            if (this.foregroundMutationTails.get(agentId) === tail) {
                this.foregroundMutationTails.delete(agentId);
            }
        }
    }
    async replaceAdmittedForegroundTurn(agent, expectedTurnId, prompt, options) {
        this.assertSteerAdmissionOwnsTurn(agent, expectedTurnId);
        agent.pendingReplacement = true;
        agent.lifecycle = "running";
        this.touchUpdatedAt(agent);
        this.emitState(agent);
        try {
            await this.cancelAgentRunBefore(agent.id, "replace");
            return this.streamAgent(agent.id, prompt, options);
        }
        catch (error) {
            const latest = this.agents.get(agent.id);
            if (latest) {
                latest.pendingReplacement = false;
            }
            throw error;
        }
    }
    async recordAcceptedSteer(agent, prompt, clientMessageId, expectedTurnId) {
        if (!clientMessageId) {
            return;
        }
        this.recordSubmittedPrompt(agent, prompt, clientMessageId, {
            messageId: clientMessageId,
            turnId: expectedTurnId,
        });
        this.emitState(agent);
    }
    async waitForAgentRunStart(agentId, options) {
        const snapshot = this.getAgent(agentId);
        if (!snapshot) {
            throw new Error(`Agent ${agentId} not found`);
        }
        const pendingRun = this.runs.getPendingRun(agentId);
        if ((snapshot.lifecycle === "running" || pendingRun?.start.status === "started") &&
            !snapshot.pendingReplacement) {
            return;
        }
        if (!snapshot.activeForegroundTurnId && !pendingRun && !snapshot.pendingReplacement) {
            throw new Error(`Agent ${agentId} has no pending run`);
        }
        if (options?.signal?.aborted) {
            throw createAbortError(options.signal, "wait_for_agent_start aborted");
        }
        await new Promise((resolvePromise, reject) => {
            if (options?.signal?.aborted) {
                reject(createAbortError(options.signal, "wait_for_agent_start aborted"));
                return;
            }
            let unsubscribe = null;
            let abortHandler = null;
            const cleanup = () => {
                if (unsubscribe) {
                    try {
                        unsubscribe();
                    }
                    catch {
                        // ignore cleanup errors
                    }
                    unsubscribe = null;
                }
                if (abortHandler && options?.signal) {
                    try {
                        options.signal.removeEventListener("abort", abortHandler);
                    }
                    catch {
                        // ignore cleanup errors
                    }
                    abortHandler = null;
                }
            };
            const finishOk = () => {
                cleanup();
                resolvePromise();
            };
            const finishErr = (error) => {
                cleanup();
                reject(error);
            };
            if (options?.signal) {
                abortHandler = () => finishErr(createAbortError(options.signal, "wait_for_agent_start aborted"));
                options.signal.addEventListener("abort", abortHandler, { once: true });
            }
            const checkCurrentState = () => {
                const current = this.getAgent(agentId);
                if (!current) {
                    finishErr(new Error(`Agent ${agentId} not found`));
                    return true;
                }
                const currentPendingRun = this.runs.getPendingRun(agentId);
                if ((current.lifecycle === "running" || currentPendingRun?.start.status === "started") &&
                    !current.pendingReplacement) {
                    finishOk();
                    return true;
                }
                if (currentPendingRun?.start.status === "failed") {
                    finishErr(new Error(currentPendingRun.start.error));
                    return true;
                }
                if (current.lifecycle === "error" && !currentPendingRun) {
                    finishErr(new Error(current.lastError ?? `Agent ${agentId} failed to start`));
                    return true;
                }
                if (!currentPendingRun && !current.activeForegroundTurnId && !current.pendingReplacement) {
                    finishErr(new Error(`Agent ${agentId} run finished before starting`));
                    return true;
                }
                return false;
            };
            unsubscribe = this.subscribe((event) => {
                if (event.type !== "agent_state" || event.agent.id !== agentId) {
                    return;
                }
                checkCurrentState();
            }, { agentId, replayState: false });
            checkCurrentState();
        });
    }
    async respondToPermission(agentId, requestId, response) {
        const agent = this.requireAgent(agentId);
        if (agent.inFlightPermissionResponses.has(requestId)) {
            throw new Error("A response to this permission request is already being submitted");
        }
        agent.inFlightPermissionResponses.add(requestId);
        try {
            const result = await agent.session.respondToPermission(requestId, response);
            agent.pendingPermissions.delete(requestId);
            try {
                await this.refreshSessionState(agent);
            }
            catch {
                // Ignore refresh errors - state sync after permission approval is best effort.
            }
            this.touchUpdatedAt(agent);
            await this.persistSnapshot(agent);
            this.emitState(agent);
            const bufferedResolution = agent.bufferedPermissionResolutions.get(requestId);
            if (bufferedResolution) {
                agent.bufferedPermissionResolutions.delete(requestId);
                this.dispatchStream(agent.id, bufferedResolution, { timestamp: new Date().toISOString() });
            }
            return result;
        }
        finally {
            agent.inFlightPermissionResponses.delete(requestId);
            agent.bufferedPermissionResolutions.delete(requestId);
        }
    }
    async cancelAgentRun(agentId) {
        return this.runForegroundMutation(agentId, () => this.cancelAgentRunNow(agentId));
    }
    async cancelAgentRunNow(agentId) {
        const agent = this.requireSessionAgent(agentId);
        const run = this.runs.getRun(agentId) ??
            (agent.lifecycle === "running" ? this.runs.trackAutonomousRun(agentId, null) : null);
        if (!run) {
            return { status: "not_running" };
        }
        const interruptAcknowledged = await this.interruptSession(agent.session, agentId);
        const settlement = await this.waitWithTimeout({
            operation: run.settledPromise,
            timeoutMs: interruptAcknowledged
                ? INTERRUPT_SESSION_TIMEOUT_MS
                : this.rescueTimeouts.interruptSessionMs,
        });
        if (!interruptAcknowledged) {
            return { status: settlement === "completed" ? "settled" : "refused" };
        }
        const runTurnId = this.runs.getTurnId(agentId);
        if (settlement === "timed_out" && runTurnId) {
            this.logger.warn({ agentId, turnId: runTurnId, kind: run.kind }, "cancelAgentRun: acknowledged turn still active after timeout, force-canceling");
            await this.dispatchSessionEvent(agent, {
                type: "turn_canceled",
                provider: agent.provider,
                reason: "interrupted",
                turnId: runTurnId,
            });
            await run.settledPromise;
        }
        else if (settlement === "timed_out" && run.kind === "foreground") {
            this.logger.warn({ agentId, kind: run.kind }, "cancelAgentRun: acknowledged pending turn still active after timeout, clearing it");
            this.runs.settleForegroundRun(agentId, run.token);
            if (!agent.pendingReplacement) {
                agent.lifecycle = "idle";
                this.touchUpdatedAt(agent);
                this.emitState(agent);
            }
        }
        else if (settlement === "timed_out" && run.kind === "autonomous") {
            this.logger.warn({ agentId, kind: run.kind }, "cancelAgentRun: acknowledged turn still active after timeout, force-canceling");
            await this.dispatchSessionEvent(agent, {
                type: "turn_canceled",
                provider: agent.provider,
                reason: "interrupted",
            });
        }
        if (agent.pendingPermissions.size > 0) {
            this.resolvePendingPermissionsForAgent(agent, agent.provider, undefined, "Interrupted");
            this.touchUpdatedAt(agent);
            this.emitState(agent);
        }
        return { status: "settled" };
    }
    async cancelAgentRunBefore(agentId, action) {
        const result = await this.cancelAgentRun(agentId);
        if (result.status === "refused") {
            throw new AgentRunCancellationError(agentId, action);
        }
    }
    async interruptSession(session, agentId) {
        try {
            const result = await this.waitWithTimeout({
                operation: session.interrupt(),
                timeoutMs: this.rescueTimeouts.interruptSessionMs,
                onLateError: (error) => {
                    this.logger.warn({ err: error, agentId }, "Session interrupt failed after timeout during cancel");
                },
            });
            if (result === "timed_out") {
                this.logger.warn({ agentId, timeoutMs: this.rescueTimeouts.interruptSessionMs }, "Timed out interrupting session during cancel");
                return false;
            }
            return true;
        }
        catch (error) {
            this.logger.error({ err: error, agentId }, "Failed to interrupt session");
            return false;
        }
    }
    getPendingPermissions(agentId) {
        const agent = this.requireSessionAgent(agentId);
        return Array.from(agent.pendingPermissions.values());
    }
    peekPendingPermission(agent) {
        const iterator = agent.pendingPermissions.values().next();
        return iterator.done ? null : iterator.value;
    }
    /**
     * Hydrates the runtime timeline from provider history. No-ops if already hydrated.
     */
    async hydrateTimelineFromProvider(agentId, options) {
        const agent = this.requireSessionAgent(agentId);
        await this.hydrateTimelineFromLegacyProviderHistory(agent, options);
    }
    async rewind(agentId, messageId, mode) {
        const agent = this.requireSessionAgent(agentId);
        const submittedRow = this.timelineStore
            .getRows(agentId)
            .find((row) => row.item.type === "user_message" &&
            row.item.messageId === messageId &&
            row.item.clientMessageId === messageId);
        if (submittedRow && !submittedRow.providerMessageId) {
            throw new Error("Cannot rewind before the provider acknowledges the submitted prompt");
        }
        const providerMessageId = submittedRow?.providerMessageId ?? messageId;
        if (this.hasInFlightRun(agentId)) {
            await this.cancelAgentRunBefore(agentId, "rewind");
        }
        const lock = this.runs.createPendingRun(agentId);
        try {
            this.logger.info({ agentId, provider: agent.provider, messageId, mode }, "agent.rewind.start");
            await invokeRewindCapability(agent.session, { messageId: providerMessageId, mode });
            if (mode !== "files") {
                await this.hydrateTimelineFromProvider(agentId, {
                    force: true,
                    broadcast: true,
                    broadcastTimeline: false,
                });
                this.dispatch({
                    type: "timeline_replacement",
                    agentId,
                    epoch: this.timelineStore.getEpoch(agentId),
                });
            }
            // Rewind stages provider events under the run lock; publish its final state directly.
            this.refreshSessionPersistence(agent);
            await this.refreshSessionState(agent, { emit: false });
            await this.persistSnapshot(agent);
            this.emitState(agent, { persist: false });
            this.logger.info({ agentId, provider: agent.provider, messageId, mode }, "agent.rewind.complete");
        }
        catch (error) {
            this.logger.warn({ err: error, agentId, provider: agent.provider, messageId, mode }, "agent.rewind.failed");
            throw error;
        }
        finally {
            this.runs.settleForegroundRun(agentId, lock.token);
        }
    }
    async deleteAgentState(agentId) {
        this.discardRetainedAgentState(agentId);
        await this.deleteCommittedTimeline(agentId);
    }
    async deleteCommittedTimeline(agentId) {
        await this.durableTimelineStore?.deleteAgent(agentId);
    }
    async getLastAssistantMessage(agentId) {
        const agent = this.agents.get(agentId);
        if (!agent) {
            return null;
        }
        return await this.getLastAssistantMessageFromStores(agentId);
    }
    getLastAssistantMessageFromTimeline(timeline) {
        return this.getLastAssistantMessageSegmentFromTimeline(timeline)?.text ?? null;
    }
    getLastAssistantMessageSegmentFromTimeline(timeline) {
        // Collect the last contiguous assistant messages (Claude streams chunks)
        const chunks = [];
        let startsAtBeginning = false;
        for (let i = timeline.length - 1; i >= 0; i--) {
            const item = timeline[i];
            if (item.type !== "assistant_message") {
                if (chunks.length) {
                    break;
                }
                continue;
            }
            chunks.push(item.text);
            startsAtBeginning = i === 0;
        }
        if (!chunks.length) {
            return null;
        }
        return {
            text: chunks.toReversed().join(""),
            startsAtBeginning,
        };
    }
    async getLastAssistantMessageFromStores(agentId) {
        const liveTimeline = this.timelineStore.getItems(agentId);
        const liveSegment = this.getLastAssistantMessageSegmentFromTimeline(liveTimeline);
        if (!this.durableTimelineStore) {
            return liveSegment?.text ?? null;
        }
        if (!liveSegment) {
            return await this.durableTimelineStore.getLastAssistantMessage(agentId);
        }
        if (!liveSegment.startsAtBeginning) {
            return liveSegment.text;
        }
        const lastDurableItem = await this.durableTimelineStore.getLastItem(agentId);
        if (lastDurableItem?.type !== "assistant_message") {
            return liveSegment.text;
        }
        const durableMessage = await this.durableTimelineStore.getLastAssistantMessage(agentId);
        return durableMessage ? `${durableMessage}${liveSegment.text}` : liveSegment.text;
    }
    async getLastItemFromStores(agentId) {
        const lastLiveItem = this.timelineStore.getLastItem(agentId);
        return lastLiveItem ?? (await this.durableTimelineStore?.getLastItem(agentId)) ?? null;
    }
    async waitForAgentEvent(agentId, options) {
        const snapshot = this.getAgent(agentId);
        if (!snapshot) {
            throw new Error(`Agent ${agentId} not found`);
        }
        const pendingForegroundRun = this.runs.getPendingRun(agentId);
        const hasForegroundTurn = Boolean(snapshot.activeForegroundTurnId) || Boolean(pendingForegroundRun);
        const immediatePermission = this.peekPendingPermission(snapshot);
        if (immediatePermission) {
            return {
                status: snapshot.lifecycle,
                permission: immediatePermission,
                lastMessage: await this.getLastAssistantMessage(agentId),
            };
        }
        const initialStatus = snapshot.lifecycle;
        const initialBusy = isAgentBusy(initialStatus) || hasForegroundTurn;
        const waitForActive = options?.waitForActive ?? false;
        if (!waitForActive && !initialBusy) {
            return {
                status: initialStatus,
                permission: null,
                lastMessage: await this.getLastAssistantMessage(agentId),
            };
        }
        if (waitForActive && !initialBusy && !hasForegroundTurn) {
            return {
                status: initialStatus,
                permission: null,
                lastMessage: await this.getLastAssistantMessage(agentId),
            };
        }
        if (options?.signal?.aborted) {
            throw createAbortError(options.signal, "wait_for_agent aborted");
        }
        return await new Promise((resolvePromise, reject) => {
            // Bug #1 Fix: Check abort signal AGAIN inside Promise constructor
            // to avoid race condition between pre-Promise check and abort listener registration
            if (options?.signal?.aborted) {
                reject(createAbortError(options.signal, "wait_for_agent aborted"));
                return;
            }
            let currentStatus = initialStatus;
            let hasStarted = isAgentBusy(initialStatus) ||
                Boolean(snapshot.activeForegroundTurnId) ||
                pendingForegroundRun?.start.status === "started";
            let terminalStatusOverride = null;
            let finished = false;
            // Bug #3 Fix: Declare unsubscribe and abortHandler upfront so cleanup can reference them
            let unsubscribe = null;
            let abortHandler = null;
            const cleanup = () => {
                // Clean up subscription
                if (unsubscribe) {
                    try {
                        unsubscribe();
                    }
                    catch {
                        // ignore cleanup errors
                    }
                    unsubscribe = null;
                }
                // Clean up abort listener
                if (abortHandler && options?.signal) {
                    try {
                        options.signal.removeEventListener("abort", abortHandler);
                    }
                    catch {
                        // ignore cleanup errors
                    }
                    abortHandler = null;
                }
            };
            const finish = (permission) => {
                if (finished) {
                    return;
                }
                finished = true;
                cleanup();
                void this.getLastAssistantMessage(agentId)
                    .then((lastMessage) => {
                    resolvePromise({
                        status: currentStatus,
                        permission,
                        lastMessage,
                    });
                    return;
                })
                    .catch(reject);
            };
            // Bug #3 Fix: Set up abort handler BEFORE subscription
            // to ensure cleanup handlers exist before callback can fire
            if (options?.signal) {
                abortHandler = () => {
                    cleanup();
                    reject(createAbortError(options.signal, "wait_for_agent aborted"));
                };
                options.signal.addEventListener("abort", abortHandler, { once: true });
            }
            // Bug #3 Fix: Now subscribe with cleanup handlers already in place
            // This prevents race condition if callback fires synchronously with replayState: true
            unsubscribe = this.subscribe((event) => {
                if (event.type === "agent_state") {
                    currentStatus = event.agent.lifecycle;
                    const pending = this.peekPendingPermission(event.agent);
                    if (pending) {
                        finish(pending);
                        return;
                    }
                    if (isAgentBusy(event.agent.lifecycle)) {
                        hasStarted = true;
                        return;
                    }
                    if (!waitForActive || hasStarted) {
                        if (terminalStatusOverride) {
                            currentStatus = terminalStatusOverride;
                        }
                        finish(null);
                    }
                    return;
                }
                if (event.type === "agent_stream") {
                    if (event.event.type === "permission_requested") {
                        finish(event.event.request);
                        return;
                    }
                    if (event.event.type === "turn_failed") {
                        hasStarted = true;
                        terminalStatusOverride = "error";
                        return;
                    }
                    if (event.event.type === "turn_completed") {
                        hasStarted = true;
                    }
                    if (event.event.type === "turn_canceled") {
                        hasStarted = true;
                    }
                }
            }, { agentId, replayState: true });
        });
    }
    async registerSession(session, config, agentId, options) {
        let registered = false;
        try {
            this.assertAcceptingAgentRegistrations();
            const resolvedAgentId = validateAgentId(agentId, "registerSession");
            if (this.agents.has(resolvedAgentId)) {
                throw new Error(`Agent with id ${resolvedAgentId} already exists`);
            }
            const initialPersistedTitle = await this.resolveInitialPersistedTitle(resolvedAgentId, config, options?.initialTitle ?? null);
            const now = new Date();
            const { durableTimelineHasRows } = await this.initializeAgentTimelineForRegister({
                agentId: resolvedAgentId,
                now,
                options,
            });
            const managed = this.buildManagedAgentForRegister({
                resolvedAgentId,
                session,
                config,
                now,
                durableTimelineHasRows,
                options,
            });
            // Read history before publishing the agent: a provider failure must leave the
            // session unregistered so the registration catch closes it.
            const startupHistory = [];
            if (session.initialTimeline?.length && !managed.historyPrimed) {
                for await (const event of session.streamHistory()) {
                    startupHistory.push(limitAgentStreamEventContent(event));
                }
            }
            this.assertAcceptingAgentRegistrations();
            this.agents.set(resolvedAgentId, managed);
            registered = true;
            // Initialize previousStatus to track transitions
            this.previousStatuses.set(resolvedAgentId, managed.lifecycle);
            if (session.initialTimeline?.length) {
                if (!managed.historyPrimed) {
                    // Legacy/imported chats need their existing history before startup rows.
                    await this.primeTimelineFromLegacyProviderHistory(managed, false, startupHistory);
                }
                else {
                    for (const entry of session.initialTimeline) {
                        this.recordTimeline(managed.id, entry.item, { timestamp: entry.timestamp });
                    }
                }
                this.refreshSessionPersistence(managed);
            }
            await this.refreshRuntimeInfo(managed, { emit: false });
            this.assertAgentRegistrationActive(managed);
            await this.persistSnapshot(managed, {
                title: initialPersistedTitle,
            });
            this.assertAgentRegistrationActive(managed);
            if (!options?.publishWhenReady) {
                this.emitState(managed, { persist: false });
            }
            await this.refreshSessionState(managed, { emit: false });
            this.assertAgentRegistrationActive(managed);
            managed.lifecycle = "idle";
            // Stamping now over a restored timestamp rewrote the workspace's "last used" in the
            // sidebar every time a chat was reopened, because workspace `statusEnteredAt` is
            // re-derived from persisted agent `updatedAt` on every daemon start.
            if (!options?.restoring) {
                this.touchUpdatedAt(managed);
            }
            await this.persistSnapshot(managed);
            this.assertAgentRegistrationActive(managed);
            this.emitState(managed, { persist: false });
            this.subscribeToSession(managed);
            return { ...managed };
        }
        catch (error) {
            if (!registered) {
                await this.closeUnregisteredSession(session);
            }
            throw error;
        }
    }
    assertAcceptingAgentRegistrations() {
        if (!this.acceptingAgentRegistrations) {
            throw new AgentManagerShuttingDownError();
        }
    }
    assertAgentRegistrationActive(agent) {
        if (!this.acceptingAgentRegistrations || this.agents.get(agent.id) !== agent) {
            throw new AgentManagerShuttingDownError();
        }
    }
    async closeUnregisteredSession(session) {
        try {
            await session.close();
        }
        catch (error) {
            this.logger.warn({ err: error }, "Failed to close unregistered agent session");
        }
    }
    async requireExternalMcpSupport(session, storedConfig) {
        if (Object.keys(storedConfig.mcpServers ?? {}).length === 0 ||
            session.capabilities.supportsMcpServers === true) {
            return;
        }
        await this.closeUnregisteredSession(session);
        throw new Error(`Provider '${storedConfig.provider}' does not support MCP servers`);
    }
    async initializeAgentTimelineForRegister(params) {
        const { agentId, now, options } = params;
        const timelineAlreadyPrimed = this.timelineStore.has(agentId);
        const explicitTimelineSeed = buildExplicitTimelineSeedForRegister(now, options);
        const shouldSeedFromDurable = !explicitTimelineSeed && !this.timelineStore.has(agentId) && this.durableTimelineStore;
        const durableTimelineSeed = shouldSeedFromDurable
            ? await this.loadCommittedTimelineSeed(agentId, now)
            : null;
        const durableTimelineHasRows = timelineAlreadyPrimed ||
            (durableTimelineSeed != null && (durableTimelineSeed.nextSeq ?? 1) > 1);
        const timelineSeed = explicitTimelineSeed ?? durableTimelineSeed;
        if (timelineSeed || !this.timelineStore.has(agentId)) {
            this.timelineStore.initialize(agentId, timelineSeed ?? { timestamp: now.toISOString() });
        }
        if (options?.timelineRows?.length) {
            this.enqueueDurableTimelineBulkInsert(agentId, options.timelineRows);
        }
        return { durableTimelineHasRows };
    }
    buildManagedAgentForRegister(params) {
        const { resolvedAgentId, session, config, now, durableTimelineHasRows, options } = params;
        return {
            id: resolvedAgentId,
            provider: config.provider,
            cwd: config.cwd,
            workspaceId: options?.workspaceId,
            owner: options?.owner,
            session,
            capabilities: session.capabilities,
            config,
            runtimeInfo: undefined,
            lifecycle: "initializing",
            createdAt: options?.createdAt ?? now,
            updatedAt: options?.updatedAt ?? now,
            availableModes: [],
            currentModeId: null,
            pendingPermissions: new Map(),
            bufferedPermissionResolutions: new Map(),
            inFlightPermissionResponses: new Set(),
            pendingReplacement: false,
            activeForegroundTurnId: null,
            activeTurnId: null,
            activeTurnStartedAt: null,
            foregroundTurnWaiters: new Set(),
            finalizedForegroundTurnIds: new Set(),
            unsubscribeSession: null,
            persistence: attachPersistenceCwd(options?.persistence ?? session.describePersistence(), config.cwd),
            historyPrimed: options?.historyPrimed ?? durableTimelineHasRows,
            lastUserMessageAt: options?.lastUserMessageAt ?? null,
            lastUsage: options?.lastUsage,
            lastError: options?.lastError,
            attention: resolveInitialAttention(options?.attention),
            internal: config.internal ?? false,
            labels: options?.labels ?? {},
        };
    }
    async loadCommittedTimelineSeed(agentId, now) {
        if (!this.durableTimelineStore) {
            return { timestamp: now.toISOString() };
        }
        return {
            nextSeq: (await this.durableTimelineStore.getLatestCommittedSeq(agentId)) + 1,
            timestamp: now.toISOString(),
        };
    }
    prepareAgentForClosure(agent, cancelReason) {
        this.agentStreamCoalescer.flushAndDiscard(agent.id);
        this.agents.delete(agent.id);
        this.previousStatuses.delete(agent.id);
        if (agent.unsubscribeSession) {
            agent.unsubscribeSession();
            agent.unsubscribeSession = null;
        }
        this.runs.cancelWaiters(agent, (turnId) => ({
            type: "turn_canceled",
            provider: agent.provider,
            reason: cancelReason,
            turnId,
        }));
        this.runs.clearAgentRun(agent.id);
        return {
            ...agent,
            lifecycle: "closed",
            session: null,
            activeForegroundTurnId: null,
            activeTurnId: null,
            activeTurnStartedAt: null,
            pendingPermissions: new Map(),
            bufferedPermissionResolutions: new Map(),
            inFlightPermissionResponses: new Set(),
            pendingReplacement: false,
            foregroundTurnWaiters: new Set(),
            finalizedForegroundTurnIds: new Set(),
            unsubscribeSession: null,
        };
    }
    discardRetainedAgentState(agentId) {
        this.timelineStore.delete(agentId);
        this.paseoToolPolicies.delete(agentId);
        for (const event of this.providerSubagents.deleteParent(agentId)) {
            this.dispatch({ type: "provider_subagent", event });
        }
    }
    emitClosedAgent(agent, options) {
        this.emitState(agent, options);
        if (!agent.internal) {
            this.pluginLifecycle?.emit("agent.closed", {
                agent: describeHookAgent({ ...agent, title: agent.config.title }),
            });
        }
    }
    subscribeToSession(agent) {
        if (agent.unsubscribeSession) {
            return;
        }
        const agentId = agent.id;
        const unsubscribe = agent.session.subscribe((event) => {
            this.enqueueSessionEvent(agentId, event);
        });
        agent.unsubscribeSession = unsubscribe;
    }
    enqueueSessionEvent(agentId, event) {
        this.logger.trace({
            agentId,
            provider: event.provider,
            sessionId: this.agents.get(agentId)?.persistence?.sessionId ?? undefined,
            turnId: getAgentStreamEventTurnId(event),
            event,
        }, "agent.manager.enqueue");
        const steerBarrier = this.steerEventBarriers.get(agentId);
        if (steerBarrier) {
            steerBarrier.events.push(event);
            return;
        }
        const pendingRun = this.runs.getPendingRun(agentId);
        if (pendingRun?.start.status === "pending") {
            pendingRun.stagedEvents.push(event);
            return;
        }
        const previous = this.sessionEventTails.get(agentId) ?? Promise.resolve();
        const next = previous
            .catch(() => undefined)
            .then(async () => {
            const current = this.agents.get(agentId);
            if (!current) {
                return;
            }
            if (current.session == null) {
                return;
            }
            this.logger.trace({
                agentId,
                provider: event.provider,
                sessionId: current.persistence?.sessionId ?? undefined,
                turnId: getAgentStreamEventTurnId(event),
                event,
            }, "agent.manager.dequeue");
            await this.dispatchSessionEvent(current, event);
            return;
        })
            .catch((err) => {
            this.logger.error({ err, agentId, eventType: event.type }, "Failed to process session event");
        });
        this.sessionEventTails.set(agentId, next);
        this.trackBackgroundTask(next);
        void next.finally(() => {
            if (this.sessionEventTails.get(agentId) === next) {
                this.sessionEventTails.delete(agentId);
            }
        });
    }
    /**
     * Provider mutations may synchronously emit config events that are processed through the
     * asynchronous session queue. Apply those events before committing the mutation's explicit
     * manager state so call order remains authoritative.
     */
    async drainSessionEvents(agentId) {
        while (true) {
            const tail = this.sessionEventTails.get(agentId);
            if (!tail) {
                return;
            }
            await tail;
            if (this.sessionEventTails.get(agentId) === tail) {
                return;
            }
        }
    }
    async dispatchSessionEvent(agent, event) {
        if (event.type === "provider_subagent") {
            const update = this.providerSubagents.apply(agent.id, event.provider, event.event);
            this.dispatch({ type: "provider_subagent", event: update });
            return;
        }
        const turnId = getAgentStreamEventTurnId(event);
        const matchingWaiters = this.runs.getMatchingWaiters(agent, turnId);
        this.logger.trace({
            agentId: agent.id,
            provider: event.provider,
            sessionId: agent.persistence?.sessionId ?? undefined,
            turnId,
            matchingWaiterCount: matchingWaiters.length,
            event,
        }, "agent.manager.dispatch_session_event");
        const shouldNotifyWaiters = await this.handleStreamEvent(agent, event);
        if (!shouldNotifyWaiters) {
            return;
        }
        this.runs.notifyWaiters(matchingWaiters, event, {
            terminal: isTurnTerminalEvent(event),
        });
        this.logger.trace({
            agentId: agent.id,
            provider: event.provider,
            sessionId: agent.persistence?.sessionId ?? undefined,
            turnId,
            notifiedWaiterCount: matchingWaiters.length,
            terminal: isTurnTerminalEvent(event),
            event,
        }, "agent.manager.notify_waiters");
    }
    async resolveInitialPersistedTitle(agentId, config, fallbackTitle) {
        const existing = await this.registry?.get(agentId);
        if (existing) {
            return existing.title ?? null;
        }
        const explicitTitle = typeof config.title === "string" && config.title.trim().length > 0
            ? config.title.trim()
            : null;
        return explicitTitle ?? fallbackTitle;
    }
    async persistSnapshot(agent, options) {
        if (!this.registry) {
            return;
        }
        // Don't persist internal agents - they're ephemeral system tasks
        if (agent.internal) {
            return;
        }
        await this.registry.applySnapshot(agent, options);
    }
    requireRegistry() {
        if (!this.registry) {
            throw new Error("Agent storage unavailable");
        }
        return this.registry;
    }
    /**
     * Provider-side mode switches (ACP current_mode_update, in-session
     * commands, permission-driven transitions) must land in config.modeId too —
     * reloadAgentSession and the persisted record derive the resumed session's
     * mode from it, so leaving it stale silently downgrades the mode on resume.
     */
    applyObservedMode(agent, modeId) {
        agent.currentModeId = modeId;
        if (modeId != null) {
            agent.config.modeId = modeId;
        }
    }
    async refreshSessionState(agent, options) {
        try {
            const modes = await agent.session.getAvailableModes();
            agent.availableModes = modes;
        }
        catch {
            agent.availableModes = [];
        }
        try {
            this.applyObservedMode(agent, await agent.session.getCurrentMode());
        }
        catch {
            agent.currentModeId = null;
        }
        try {
            const pending = agent.session.getPendingPermissions();
            agent.pendingPermissions = new Map(pending.map((request) => [request.id, request]));
        }
        catch {
            agent.pendingPermissions.clear();
        }
        this.syncFeaturesFromSession(agent);
        await this.refreshRuntimeInfo(agent, options);
    }
    async refreshRuntimeInfo(agent, options) {
        try {
            const newInfo = await agent.session.getRuntimeInfo();
            const changed = newInfo.model !== agent.runtimeInfo?.model ||
                newInfo.thinkingOptionId !== agent.runtimeInfo?.thinkingOptionId ||
                newInfo.sessionId !== agent.runtimeInfo?.sessionId ||
                newInfo.modeId !== agent.runtimeInfo?.modeId;
            agent.runtimeInfo = newInfo;
            if (!agent.persistence && newInfo.sessionId) {
                agent.persistence = attachPersistenceCwd({ provider: agent.provider, sessionId: newInfo.sessionId }, agent.cwd);
            }
            // Emit state if runtimeInfo changed so clients get the updated model
            if (changed && options?.emit !== false) {
                this.emitState(agent);
            }
        }
        catch {
            // Keep existing runtimeInfo if refresh fails.
        }
    }
    async hydrateTimelineFromLegacyProviderHistory(agent, options) {
        if (agent.historyPrimed && !options?.force) {
            return;
        }
        const broadcast = options?.broadcast ?? false;
        const broadcastTimeline = options?.broadcastTimeline ?? broadcast;
        if (options?.force) {
            await this.forceHydrateTimelineFromLegacyProviderHistory(agent, typeof broadcast === "function" ? broadcast() : broadcast, typeof broadcastTimeline === "function" ? broadcastTimeline() : broadcastTimeline);
            return;
        }
        await this.primeTimelineFromLegacyProviderHistory(agent, broadcast);
    }
    async forceHydrateTimelineFromLegacyProviderHistory(agent, broadcast, broadcastTimeline) {
        const historyEvents = [];
        const providerSubagentEvents = [];
        for await (const rawEvent of agent.session.streamHistory()) {
            const event = limitAgentStreamEventContent(rawEvent);
            if (event.type === "timeline") {
                if (event.item.type === "user_message" && isSystemInjectedEnvelope(event.item.text)) {
                    continue;
                }
                historyEvents.push(event);
            }
            else if (event.type === "provider_subagent") {
                providerSubagentEvents.push(event);
            }
        }
        this.agentStreamCoalescer.flushAndDiscard(agent.id);
        await this.deleteCommittedTimeline(agent.id);
        this.timelineStore.delete(agent.id);
        this.timelineStore.initialize(agent.id, { timestamp: new Date().toISOString() });
        agent.historyPrimed = true;
        for (const event of this.providerSubagents.deleteParent(agent.id)) {
            if (broadcast) {
                this.dispatch({ type: "provider_subagent", event });
            }
        }
        for (const event of providerSubagentEvents) {
            const update = this.providerSubagents.apply(agent.id, event.provider, event.event);
            if (broadcast) {
                this.dispatch({ type: "provider_subagent", event: update });
            }
        }
        for (const event of historyEvents) {
            const row = this.recordTimeline(agent.id, event.item, event.timestamp ? { timestamp: event.timestamp } : undefined);
            if (broadcastTimeline) {
                this.dispatchStream(agent.id, event, {
                    seq: row.seq,
                    epoch: this.timelineStore.getEpoch(agent.id),
                    timestamp: row.timestamp,
                });
            }
        }
        this.touchUpdatedAt(agent);
        this.emitState(agent);
    }
    async primeTimelineFromLegacyProviderHistory(agent, broadcast, history = agent.session.streamHistory()) {
        const deferredBroadcast = typeof broadcast === "function";
        const historyEvents = [];
        const historySubagentEvents = [];
        agent.historyPrimed = false;
        try {
            // Collect the whole replay before touching either store. A stream that fails
            // halfway then leaves the committed timeline as it was, instead of a partial
            // copy the next attempt would append to.
            for await (const rawEvent of history) {
                const event = limitAgentStreamEventContent(rawEvent);
                if (event.type === "provider_subagent") {
                    historySubagentEvents.push(event);
                    continue;
                }
                if (event.type !== "timeline") {
                    continue;
                }
                if (event.item.type === "user_message" && isSystemInjectedEnvelope(event.item.text)) {
                    continue;
                }
                historyEvents.push(event);
            }
        }
        catch (error) {
            this.logger.warn({ err: error, agentId: agent.id }, "Failed to hydrate provider history");
            throw error;
        }
        // The replay is the timeline, so drop the rows a previous hydration committed.
        // Keeping them would leave getTimelineRows reading one copy per hydration.
        await this.deleteCommittedTimeline(agent.id);
        const timelineEvents = [];
        const providerSubagentEvents = [];
        for (const event of historySubagentEvents) {
            const update = this.providerSubagents.apply(agent.id, event.provider, event.event);
            const managerEvent = { type: "provider_subagent", event: update };
            if (deferredBroadcast) {
                providerSubagentEvents.push(managerEvent);
            }
            else if (broadcast) {
                this.dispatch(managerEvent);
            }
        }
        for (const event of historyEvents) {
            const row = this.recordTimeline(agent.id, event.item, event.timestamp ? { timestamp: event.timestamp } : undefined);
            if (deferredBroadcast) {
                timelineEvents.push({ event, row });
            }
            else if (broadcast) {
                this.dispatchStream(agent.id, event, {
                    seq: row.seq,
                    epoch: this.timelineStore.getEpoch(agent.id),
                    timestamp: row.timestamp,
                });
            }
        }
        agent.historyPrimed = true;
        if (typeof broadcast !== "function" || !broadcast()) {
            return;
        }
        for (const event of providerSubagentEvents) {
            this.dispatch(event);
        }
        for (const { event, row } of timelineEvents) {
            this.dispatchStream(agent.id, event, {
                seq: row.seq,
                epoch: this.timelineStore.getEpoch(agent.id),
                timestamp: row.timestamp,
            });
        }
    }
    notifyForegroundTurnWaiters(agentId, event) {
        const turnId = getAgentStreamEventTurnId(event);
        if (turnId == null) {
            return;
        }
        const agent = this.agents.get(agentId);
        if (!agent) {
            return;
        }
        this.runs.notifyAgentWaiters(agent, event);
        this.logger.trace({
            agentId,
            provider: event.provider,
            sessionId: agent.persistence?.sessionId ?? undefined,
            turnId,
            event,
        }, "agent.manager.notify_waiters.coalesced");
    }
    async handleStreamEvent(agent, event, options) {
        event = limitAgentStreamEventContent(event);
        const identified = attachManagedTurnIdentity(agent, event, options?.fromHistory === true);
        event = identified.event;
        const eventTurnId = identified.turnId;
        const isForegroundEvent = agent.activeForegroundTurnId === eventTurnId;
        this.traceHandleStreamEventStart(agent, event, eventTurnId, isForegroundEvent);
        if (eventTurnId &&
            isTurnTerminalEvent(event) &&
            this.runs.hasFinalizedTurn(agent, eventTurnId)) {
            return false;
        }
        // Only update timestamp for live events, not history replay
        if (!options?.fromHistory) {
            this.touchUpdatedAt(agent);
            if (this.agentStreamCoalescer.handle(agent.id, event)) {
                this.traceCoalescerBuffered(agent, event, eventTurnId);
                return false;
            }
            this.agentStreamCoalescer.flushFor(agent.id);
        }
        let terminalDisposition = "untracked";
        if (isTurnTerminalEvent(event)) {
            terminalDisposition = this.applyActiveTurnTerminal(agent, eventTurnId, options?.fromHistory === true);
        }
        const flags = { shouldDispatchEvent: true, shouldNotifyWaiters: true };
        const dispatchPromise = this.dispatchStreamEventByType({
            agent,
            event,
            options,
            isForegroundEvent,
            eventTurnId,
            terminalDisposition,
            flags,
        });
        if (dispatchPromise) {
            await dispatchPromise;
        }
        if (!options?.fromHistory) {
            if (isTurnTerminalEvent(event)) {
                this.runs.settleTerminalRun(agent.id, eventTurnId);
                if (isForegroundEvent) {
                    this.finalizeForegroundTurn(agent, eventTurnId);
                }
            }
            if (flags.shouldDispatchEvent) {
                this.dispatchStream(agent.id, event, { timestamp: new Date().toISOString() });
            }
        }
        this.traceHandleStreamEventEnd(agent, event, eventTurnId, flags);
        return flags.shouldNotifyWaiters;
    }
    traceHandleStreamEventStart(agent, event, turnId, isForegroundEvent) {
        this.logger.trace({
            agentId: agent.id,
            provider: event.provider,
            sessionId: agent.persistence?.sessionId ?? undefined,
            turnId,
            lifecycle: agent.lifecycle,
            activeForegroundTurnId: agent.activeForegroundTurnId,
            isForegroundEvent,
            event,
        }, "agent.manager.handle_stream_event.start");
    }
    traceCoalescerBuffered(agent, event, turnId) {
        this.logger.trace({
            agentId: agent.id,
            provider: event.provider,
            sessionId: agent.persistence?.sessionId ?? undefined,
            turnId,
            event,
        }, "agent.manager.coalescer.buffer");
    }
    traceHandleStreamEventEnd(agent, event, turnId, flags) {
        this.logger.trace({
            agentId: agent.id,
            provider: event.provider,
            sessionId: agent.persistence?.sessionId ?? undefined,
            turnId,
            lifecycle: agent.lifecycle,
            activeForegroundTurnId: agent.activeForegroundTurnId,
            shouldDispatchEvent: flags.shouldDispatchEvent,
            shouldNotifyWaiters: flags.shouldNotifyWaiters,
            event,
        }, "agent.manager.handle_stream_event.end");
    }
    dispatchStreamEventByType(params) {
        const { agent, event, options, isForegroundEvent, eventTurnId, terminalDisposition, flags } = params;
        switch (event.type) {
            case "thread_started":
                this.onStreamThreadStarted(agent);
                return undefined;
            case "usage_updated":
                agent.lastUsage = event.usage;
                this.emitState(agent);
                return undefined;
            case "mode_changed":
                this.applyObservedMode(agent, event.currentModeId);
                agent.availableModes = event.availableModes;
                if (agent.runtimeInfo) {
                    agent.runtimeInfo = { ...agent.runtimeInfo, modeId: event.currentModeId };
                }
                flags.shouldDispatchEvent = false;
                this.emitState(agent);
                return undefined;
            case "model_changed":
                agent.runtimeInfo = event.runtimeInfo;
                if (!agent.persistence && event.runtimeInfo.sessionId) {
                    agent.persistence = attachPersistenceCwd({ provider: agent.provider, sessionId: event.runtimeInfo.sessionId }, agent.cwd);
                }
                this.applyObservedMode(agent, event.runtimeInfo.modeId ?? agent.currentModeId);
                flags.shouldDispatchEvent = false;
                this.emitState(agent);
                return undefined;
            case "thinking_option_changed":
                agent.config.thinkingOptionId = event.thinkingOptionId ?? undefined;
                if (agent.runtimeInfo) {
                    agent.runtimeInfo = {
                        ...agent.runtimeInfo,
                        thinkingOptionId: event.thinkingOptionId,
                    };
                }
                flags.shouldDispatchEvent = false;
                this.emitState(agent);
                return undefined;
            case "timeline":
                return this.onStreamTimelineEvent({ agent, event, options, flags });
            case "turn_completed":
                this.onStreamTurnCompleted({
                    agent,
                    event,
                    eventTurnId,
                    isForegroundEvent,
                    terminalDisposition,
                });
                return undefined;
            case "turn_failed":
                return this.onStreamTurnFailed({
                    agent,
                    event,
                    eventTurnId,
                    isForegroundEvent,
                    terminalDisposition,
                    options,
                });
            case "turn_canceled":
                this.onStreamTurnCanceled({
                    agent,
                    event,
                    eventTurnId,
                    isForegroundEvent,
                    terminalDisposition,
                    options,
                });
                return undefined;
            case "turn_started":
                this.onStreamTurnStarted({ agent, eventTurnId, isForegroundEvent, flags });
                return undefined;
            case "permission_requested":
                this.onStreamPermissionRequested(agent, event);
                return undefined;
            case "permission_resolved":
                this.onStreamPermissionResolved({ agent, event, options, flags });
                return undefined;
            default:
                return undefined;
        }
    }
    onStreamThreadStarted(agent) {
        const previousSessionId = agent.persistence?.sessionId ?? null;
        this.refreshSessionPersistence(agent);
        if (agent.persistence?.sessionId !== previousSessionId) {
            this.emitState(agent);
        }
        void this.refreshRuntimeInfo(agent);
    }
    refreshSessionPersistence(agent) {
        const handle = agent.session.describePersistence();
        if (handle) {
            agent.persistence = attachPersistenceCwd(handle, agent.cwd);
        }
    }
    async onStreamTimelineEvent(params) {
        const { agent, event, options, flags } = params;
        if (event.item.type === "user_message" && isSystemInjectedEnvelope(event.item.text)) {
            flags.shouldDispatchEvent = false;
            flags.shouldNotifyWaiters = false;
            return;
        }
        if (event.item.type === "user_message" &&
            event.item.clientMessageId &&
            this.reconcileSubmittedPromptEcho(agent, event.item, event.turnId)) {
            flags.shouldDispatchEvent = false;
            flags.shouldNotifyWaiters = false;
            return;
        }
        if (options?.fromHistory) {
            this.recordTimeline(agent.id, event.item, event.timestamp ? { timestamp: event.timestamp } : undefined);
            flags.shouldDispatchEvent = false;
            flags.shouldNotifyWaiters = false;
            return;
        }
        this.recordAndDispatchTimelineItem(agent.id, event.item, event.provider, event.turnId);
        if (event.item.type === "user_message") {
            agent.lastUserMessageAt = new Date();
            this.emitState(agent);
        }
        flags.shouldDispatchEvent = false;
        flags.shouldNotifyWaiters = true;
    }
    onStreamTurnCompleted(params) {
        const { agent, event, eventTurnId, isForegroundEvent, terminalDisposition } = params;
        this.logger.trace({
            agentId: agent.id,
            provider: agent.provider,
            sessionId: agent.persistence?.sessionId ?? undefined,
            turnId: eventTurnId,
            lifecycle: agent.lifecycle,
            activeForegroundTurnId: agent.activeForegroundTurnId,
        }, "agent.manager.turn.completed");
        if (terminalDisposition === "stale")
            return;
        if (event.usage) {
            agent.lastUsage = { ...agent.lastUsage, ...event.usage };
        }
        // If no usage on turn_completed, keep lastUsage as-is so context window
        // data accumulated during streaming isn't lost when the provider omits
        // it from the completion event.
        agent.lastError = undefined;
        if (!isForegroundEvent &&
            !agent.activeForegroundTurnId &&
            agent.lifecycle !== "idle" &&
            !agent.pendingReplacement) {
            agent.lifecycle = "idle";
            this.emitState(agent);
        }
        void this.refreshRuntimeInfo(agent);
    }
    async onStreamTurnFailed(params) {
        const { agent, event, eventTurnId, isForegroundEvent, terminalDisposition, options } = params;
        this.logger.warn({
            agentId: agent.id,
            provider: agent.provider,
            sessionId: agent.persistence?.sessionId ?? undefined,
            turnId: eventTurnId,
            lifecycle: agent.lifecycle,
            activeForegroundTurnId: agent.activeForegroundTurnId,
            eventTurnId,
            error: event.error,
            code: event.code,
            diagnostic: event.diagnostic,
        }, "handleStreamEvent: turn_failed");
        if (terminalDisposition === "stale")
            return;
        if (!isForegroundEvent && !agent.activeForegroundTurnId) {
            agent.lifecycle = "error";
        }
        agent.lastError = event.error;
        await this.appendSystemErrorTimelineMessage(agent, event.provider, this.formatTurnFailedMessage(event), options);
        this.resolvePendingPermissionsForAgent(agent, event.provider, options, "Turn failed");
        if (!isForegroundEvent && !agent.activeForegroundTurnId) {
            this.emitState(agent);
        }
    }
    onStreamTurnCanceled(params) {
        const { agent, event, eventTurnId, isForegroundEvent, terminalDisposition, options } = params;
        this.logger.trace({
            agentId: agent.id,
            provider: agent.provider,
            sessionId: agent.persistence?.sessionId ?? undefined,
            turnId: eventTurnId,
            lifecycle: agent.lifecycle,
            activeForegroundTurnId: agent.activeForegroundTurnId,
            eventTurnId,
        }, "agent.manager.turn.canceled");
        if (terminalDisposition === "stale")
            return;
        if (!isForegroundEvent && !agent.activeForegroundTurnId && !agent.pendingReplacement) {
            agent.lifecycle = "idle";
        }
        agent.lastError = undefined;
        this.resolvePendingPermissionsForAgent(agent, event.provider, options, "Interrupted");
        if (!isForegroundEvent && !agent.activeForegroundTurnId) {
            this.emitState(agent);
        }
    }
    onStreamTurnStarted(params) {
        const { agent, eventTurnId, isForegroundEvent, flags } = params;
        this.logger.trace({
            agentId: agent.id,
            provider: agent.provider,
            sessionId: agent.persistence?.sessionId ?? undefined,
            turnId: eventTurnId,
            lifecycle: agent.lifecycle,
            activeForegroundTurnId: agent.activeForegroundTurnId,
        }, "agent.manager.turn.started");
        if (isForegroundEvent) {
            flags.shouldDispatchEvent = false;
            flags.shouldNotifyWaiters = false;
            return;
        }
        if (agent.activeForegroundTurnId) {
            flags.shouldDispatchEvent = false;
            flags.shouldNotifyWaiters = false;
            return;
        }
        this.runs.trackAutonomousRun(agent.id, eventTurnId ?? null);
        if (eventTurnId) {
            this.openActiveTurn(agent, eventTurnId, new Date());
        }
        agent.lifecycle = "running";
        this.emitState(agent);
    }
    onStreamPermissionRequested(agent, event) {
        const hadPendingPermissions = agent.pendingPermissions.size > 0;
        agent.pendingPermissions.set(event.request.id, event.request);
        this.refreshSessionPersistence(agent);
        if (!hadPendingPermissions && !agent.internal) {
            this.broadcastAgentAttention(agent, "permission");
        }
        this.emitState(agent);
    }
    onStreamPermissionResolved(params) {
        const { agent, event, options, flags } = params;
        agent.pendingPermissions.delete(event.requestId);
        this.refreshSessionPersistence(agent);
        if (!options?.fromHistory && agent.inFlightPermissionResponses.has(event.requestId)) {
            agent.bufferedPermissionResolutions.set(event.requestId, event);
            flags.shouldDispatchEvent = false;
            return;
        }
        this.emitState(agent);
    }
    resolvePendingPermissionsForAgent(agent, provider, options, message) {
        for (const [requestId] of agent.pendingPermissions) {
            agent.pendingPermissions.delete(requestId);
            if (!options?.fromHistory) {
                this.dispatchStream(agent.id, {
                    type: "permission_resolved",
                    provider,
                    requestId,
                    resolution: { behavior: "deny", message },
                });
            }
        }
    }
    recordAndDispatchTimelineItem(agentId, item, provider, turnId, options) {
        const row = this.recordTimeline(agentId, item, { ...options, turnId });
        const event = {
            type: "timeline",
            item,
            provider,
            ...(turnId !== undefined ? { turnId } : {}),
        };
        this.dispatchStream(agentId, event, {
            seq: row.seq,
            epoch: this.timelineStore.getEpoch(agentId),
            timestamp: row.timestamp,
        });
        if (item.type === "tool_call" &&
            item.status === "completed" &&
            item.detail?.type === "shell" &&
            commandMayHaveChangedExternalState(item.detail.command)) {
            const agent = this.agents.get(agentId);
            if (agent) {
                this.onWorkspaceStateMayHaveChanged?.({ cwd: agent.cwd });
            }
        }
        return event;
    }
    recordSubmittedPrompt(agent, prompt, clientMessageId, options) {
        if (this.timelineStore.getSubmittedUserMessage(agent.id, clientMessageId)) {
            return;
        }
        this.touchUpdatedAt(agent);
        agent.lastUserMessageAt = new Date();
        const item = {
            type: "user_message",
            text: submittedPromptText(prompt),
            clientMessageId,
            ...(options?.messageId ? { messageId: options.messageId } : {}),
        };
        this.recordAndDispatchTimelineItem(agent.id, item, agent.provider, options?.turnId, options);
    }
    reconcileSubmittedPromptEcho(agent, item, turnId) {
        const { clientMessageId, messageId } = item;
        if (!clientMessageId)
            return null;
        let existing = this.timelineStore.getSubmittedUserMessage(agent.id, clientMessageId);
        if (!existing) {
            this.recordSubmittedPrompt(agent, item.text, clientMessageId, {
                messageId: clientMessageId,
                ...(messageId ? { providerMessageId: messageId } : {}),
                ...(turnId ? { turnId } : {}),
            });
            existing = this.timelineStore.getSubmittedUserMessage(agent.id, clientMessageId);
        }
        if (!existing || existing.item.type !== "user_message")
            return null;
        if (messageId) {
            const enriched = this.timelineStore.enrichSubmittedUserMessage(agent.id, clientMessageId, messageId);
            if (enriched)
                this.enqueueDurableTimelineUpdate(agent.id, enriched);
        }
        return existing;
    }
    async appendSystemErrorTimelineMessage(agent, provider, message, options) {
        if (options?.fromHistory) {
            return;
        }
        const normalized = message.trim();
        if (!normalized) {
            return;
        }
        const text = `${SYSTEM_ERROR_PREFIX} ${normalized}`;
        const lastItem = await this.getLastItemFromStores(agent.id);
        if (lastItem?.type === "assistant_message" && lastItem.text === text) {
            return;
        }
        const item = { type: "assistant_message", text };
        const row = this.recordTimeline(agent.id, item);
        this.dispatchStream(agent.id, {
            type: "timeline",
            item,
            provider,
        }, {
            seq: row.seq,
            epoch: this.timelineStore.getEpoch(agent.id),
            timestamp: row.timestamp,
        });
    }
    formatTurnFailedMessage(event) {
        const base = event.error.trim();
        const parts = [base.length > 0 ? base : "Provider run failed"];
        const code = event.code?.trim();
        if (code) {
            parts.push(`code: ${code}`);
        }
        const diagnostic = event.diagnostic?.trim();
        if (diagnostic && diagnostic !== base) {
            parts.push(diagnostic);
        }
        return parts.join("\n\n");
    }
    recordTimeline(agentId, item, options) {
        item = limitAgentTimelineItemContent(item);
        const row = this.timelineStore.append(agentId, item, options);
        this.enqueueDurableTimelineAppend(agentId, row);
        return row;
    }
    emitState(agent, options) {
        // Keep attention as an edge-triggered unread signal, not a level signal.
        this.checkAndSetAttention(agent);
        if (options?.persist !== false) {
            this.enqueueBackgroundPersist(agent);
        }
        this.syncFeaturesFromSession(agent);
        this.logger.trace({
            agentId: agent.id,
            provider: agent.provider,
            sessionId: agent.persistence?.sessionId ?? undefined,
            turnId: agent.activeForegroundTurnId ?? undefined,
            lifecycle: agent.lifecycle,
            activeForegroundTurnId: agent.activeForegroundTurnId,
            pendingPermissions: agent.pendingPermissions.size,
            persist: options?.persist !== false,
        }, "agent.manager.emit_state");
        this.dispatch({
            type: "agent_state",
            agent: { ...agent },
        });
    }
    syncFeaturesFromSession(agent) {
        if ("session" in agent && agent.session?.features) {
            agent.features = agent.session.features;
        }
    }
    checkAndSetAttention(agent) {
        const previousStatus = this.previousStatuses.get(agent.id);
        const currentStatus = agent.lifecycle;
        // Track the new status
        this.previousStatuses.set(agent.id, currentStatus);
        // Skip attention tracking for internal agents
        if (agent.internal) {
            return;
        }
        // Skip if already requires attention
        if (agent.attention.requiresAttention) {
            return;
        }
        // Check if agent transitioned from running to idle (finished)
        if (previousStatus === "running" && currentStatus === "idle") {
            agent.attention = {
                requiresAttention: true,
                attentionReason: "finished",
                attentionTimestamp: new Date(),
            };
            this.broadcastAgentAttention(agent, "finished");
            return;
        }
        // Check if agent entered error state
        if (previousStatus !== "error" && currentStatus === "error") {
            agent.attention = {
                requiresAttention: true,
                attentionReason: "error",
                attentionTimestamp: new Date(),
            };
            this.broadcastAgentAttention(agent, "error");
            return;
        }
    }
    enqueueBackgroundPersist(agent) {
        const task = this.persistSnapshot(agent).catch((err) => {
            this.logger.error({ err, agentId: agent.id }, "Failed to persist agent snapshot");
        });
        this.trackBackgroundTask(task);
    }
    enqueueDurableTimelineAppend(agentId, row) {
        if (!this.durableTimelineStore) {
            return;
        }
        const task = this.durableTimelineStore.bulkInsert(agentId, [row]).catch((err) => {
            this.logger.error({ err, agentId, seq: row.seq, itemType: row.item.type }, "Failed to append timeline row to durable store");
        });
        this.trackBackgroundTask(task);
    }
    enqueueDurableTimelineBulkInsert(agentId, rows) {
        if (!this.durableTimelineStore || rows.length === 0) {
            return;
        }
        const task = this.durableTimelineStore.bulkInsert(agentId, rows).catch((err) => {
            this.logger.error({ err, agentId, rowCount: rows.length }, "Failed to seed durable timeline store");
        });
        this.trackBackgroundTask(task);
    }
    enqueueDurableTimelineUpdate(agentId, row) {
        if (!this.durableTimelineStore)
            return;
        const task = this.durableTimelineStore.updateCommittedRow(agentId, row).catch((err) => {
            this.logger.error({ err, agentId, seq: row.seq, itemType: row.item.type }, "Failed to enrich durable timeline row");
        });
        this.trackBackgroundTask(task);
    }
    trackBackgroundTask(task) {
        this.backgroundTasks.add(task);
        void task.finally(() => {
            this.backgroundTasks.delete(task);
        });
    }
    trackAgentRegistrationOperation(result) {
        const settled = result.then(() => undefined, () => undefined);
        this.agentRegistrationTasks.add(settled);
        void settled.then(() => {
            this.agentRegistrationTasks.delete(settled);
            return undefined;
        });
        return result;
    }
    /**
     * Flush any background persistence work (best-effort).
     */
    async flush() {
        await this.flushTasks({ includeAgentRegistrations: false });
    }
    /**
     * Flush persistence and agent registrations that crossed the synchronous
     * shutdown barrier. Those registrations own provider sessions until they
     * either install them or close them.
     */
    async flushForShutdown() {
        await this.flushTasks({ includeAgentRegistrations: true });
    }
    async flushTasks(options) {
        this.agentStreamCoalescer.flushAll();
        // Drain tasks, including tasks spawned while awaiting.
        while (this.backgroundTasks.size > 0 ||
            (options.includeAgentRegistrations && this.agentRegistrationTasks.size > 0)) {
            const pending = options.includeAgentRegistrations
                ? [...this.backgroundTasks, ...this.agentRegistrationTasks]
                : [...this.backgroundTasks];
            await Promise.allSettled(pending);
        }
    }
    broadcastAgentAttention(agent, reason) {
        if (isDelegatedAgent(agent)) {
            return;
        }
        this.onAgentAttention?.({
            agentId: agent.id,
            provider: agent.provider,
            reason,
        });
    }
    dispatchStream(agentId, event, metadata) {
        if (event.type === "timeline") {
            event = {
                ...event,
                item: limitAgentTimelineItemContent(event.item),
            };
        }
        const agent = this.agents.get(agentId);
        this.logger.trace({
            agentId,
            provider: event.provider,
            sessionId: agent?.persistence?.sessionId ?? undefined,
            turnId: getAgentStreamEventTurnId(event),
            metadata,
            event,
        }, "agent.manager.dispatch_stream");
        this.dispatch({ type: "agent_stream", agentId, event, ...metadata });
        if (this.pluginLifecycle && agent && !agent.internal && event.type !== "timeline") {
            publishAgentStream(this.pluginLifecycle, describeHookAgent({ ...agent, title: agent.config.title }), event, this.timelineStore.getItems(agentId));
        }
    }
    dispatch(event) {
        for (const subscriber of this.subscribers) {
            if (subscriber.agentId &&
                event.type === "agent_stream" &&
                subscriber.agentId !== event.agentId) {
                continue;
            }
            if (subscriber.agentId &&
                event.type === "agent_state" &&
                subscriber.agentId !== event.agent.id) {
                continue;
            }
            if (subscriber.agentId &&
                event.type === "provider_subagent" &&
                subscriber.agentId !==
                    (event.event.type === "upsert"
                        ? event.event.subagent.parentAgentId
                        : event.event.parentAgentId)) {
                continue;
            }
            // Skip internal agents for global subscribers (those without a specific agentId)
            if (!subscriber.agentId && this.eventBelongsToInternalAgent(event)) {
                continue;
            }
            subscriber.callback(event);
        }
    }
    eventBelongsToInternalAgent(event) {
        if (event.type === "agent_state")
            return event.agent.internal === true;
        if (event.type === "agent_stream")
            return this.agents.get(event.agentId)?.internal === true;
        if (event.type !== "provider_subagent")
            return false;
        const parentAgentId = event.event.type === "upsert"
            ? event.event.subagent.parentAgentId
            : event.event.parentAgentId;
        return this.agents.get(parentAgentId)?.internal === true;
    }
    async normalizeConfig(config, options = {}) {
        const normalized = { ...config };
        // Always resolve cwd to absolute path for consistent history file lookup
        if (normalized.cwd) {
            normalized.cwd = resolve(normalized.cwd);
            // Only a session that will run in the directory needs it to still be there. Reading
            // an archived agent's history runs nothing, and must survive the worktree it ran in
            // being removed when its workspace was archived.
            if (options.purpose !== "history") {
                await assertUsableWorkingDirectory(normalized.cwd);
            }
        }
        if (typeof normalized.model === "string") {
            const trimmed = normalized.model.trim();
            normalized.model = trimmed.length > 0 && trimmed !== "default" ? trimmed : undefined;
        }
        const shouldResolveDefaultModel = options.resolveDefaultModel ?? true;
        if (shouldResolveDefaultModel && !normalized.model) {
            const defaultModelId = await this.resolveDefaultModelId(normalized);
            if (defaultModelId) {
                normalized.model = defaultModelId;
            }
        }
        return this.applyProviderConfiguration(normalized);
    }
    applyProviderConfiguration(config) {
        const definition = this.providerDefinitions.get(config.provider);
        this.validateToolPolicyServers(config);
        if (config.toolPolicy && !definition?.applyToolPolicy) {
            throw new Error(`Provider '${config.provider}' cannot preapprove exact MCP tools for unattended execution`);
        }
        return definition?.applyToolPolicy
            ? definition.applyToolPolicy(config, config.toolPolicy)
            : config;
    }
    validateToolPolicyServers(config) {
        if (!config.toolPolicy)
            return;
        const serverNames = new Set(Object.keys(config.mcpServers ?? {}));
        for (const grant of config.toolPolicy.preapproved) {
            if (!serverNames.has(grant.server)) {
                throw new Error(`toolPolicy preapproval '${grant.server}.${grant.tool}' requires MCP server '${grant.server}' in the same agent request`);
            }
        }
    }
    async resolveDefaultModelId(config) {
        const client = this.clients.get(config.provider);
        if (!client) {
            return undefined;
        }
        try {
            const catalog = await client.fetchCatalog({
                scope: "workspace",
                cwd: config.cwd,
                force: false,
            });
            return (catalog.models.find((model) => model.isDefault) ?? catalog.models[0])?.id;
        }
        catch {
            // Provider may not support model listing — leave model undefined.
            return undefined;
        }
    }
    async prepareSessionConfig(config, agentId, options = {}) {
        const storedConfig = await this.normalizeConfig(stripInternalPaseoMcpServer(config), {
            env: options.env,
            purpose: options.purpose,
        });
        const paseoToolPolicy = this.paseoToolsEnabled
            ? this.resolvePaseoToolPolicy(storedConfig.provider)
            : { enabled: false };
        const launchConfig = this.applyDaemonAppendSystemPrompt(withRuntimePaseoMcpServer({
            config: storedConfig,
            agentId,
            mcpBaseUrl: this.paseoToolsEnabled && isPaseoToolPolicyEnabled(paseoToolPolicy)
                ? this.mcpBaseUrl
                : null,
            mcpAuthToken: this.mcpAuthToken,
        }));
        return { storedConfig, launchConfig, paseoToolPolicy };
    }
    applyDaemonAppendSystemPrompt(config) {
        const daemonAppendSystemPrompt = this.appendSystemPrompt.trim();
        const next = { ...config };
        delete next.daemonAppendSystemPrompt;
        return daemonAppendSystemPrompt
            ? {
                ...next,
                daemonAppendSystemPrompt,
            }
            : next;
    }
    async buildLaunchContext(agentId, client, cwd, paseoToolPolicy, env, opening) {
        if (this.pluginLifecycle) {
            const request = {
                agentId,
                provider: client.provider,
                cwd,
                workspaceId: opening?.workspaceId ?? null,
                reason: opening?.reason ?? "resume",
                purpose: opening?.purpose ?? "interactive",
                env: { ...env },
            };
            const transformed = await this.pluginLifecycle.before("agent.session_open", request);
            env = transformed.env;
        }
        const context = {
            agentId,
            env: {
                ...env,
                PASEO_AGENT_ID: agentId,
                PASEO_AGENT_CWD: cwd,
            },
        };
        if (this.paseoToolsEnabled &&
            isPaseoToolPolicyEnabled(paseoToolPolicy) &&
            client.capabilities.supportsNativePaseoTools &&
            this.paseoToolCatalogFactory) {
            context.paseoTools = await this.paseoToolCatalogFactory({
                callerAgentId: agentId,
                paseoToolPolicy,
            });
        }
        return context;
    }
    resolveProviderLaunchConfig(launchConfig, launchContext) {
        return launchContext.paseoTools ? stripInternalPaseoMcpServer(launchConfig) : launchConfig;
    }
    async requireAvailableClient(options) {
        const client = this.clients.get(options.provider);
        if (!client) {
            const configuredProviders = this.getConfiguredProviderIds();
            throw new Error(`Unknown provider '${options.provider}'. Configured providers: ${formatProviderList(configuredProviders)}.`);
        }
        let unavailableReason = null;
        try {
            const available = await client.isAvailable();
            if (available) {
                return client;
            }
        }
        catch (error) {
            unavailableReason = error instanceof Error ? error.message : String(error);
        }
        const availableProviders = (await this.listProviderAvailability())
            .filter((entry) => entry.available)
            .map((entry) => entry.provider);
        const providerList = formatProviderList(availableProviders);
        const reason = unavailableReason ? ` Reason: ${unavailableReason}.` : "";
        throw new Error(`Provider '${options.provider}' is not available.${reason} Available providers: ${providerList}. Use one of those providers, or install/configure '${options.provider}'.`);
    }
    requireEnabledProvider(provider) {
        if (this.providerEnabled.get(provider) === false) {
            throw new Error(`Provider '${provider}' is disabled`);
        }
    }
    getConfiguredProviderIds() {
        return Array.from(new Set([...this.providerEnabled.keys(), ...this.clients.keys()]));
    }
    requireClient(provider) {
        const client = this.clients.get(provider);
        if (!client) {
            throw new Error(`No client registered for provider '${provider}'`);
        }
        return client;
    }
    async syncNativeArchiveState(provider, persistence, state) {
        if (!persistence)
            return;
        const client = this.clients.get(provider);
        const sync = state === "archive" ? client?.archiveNativeSession : client?.unarchiveNativeSession;
        if (!sync)
            return;
        if (state === "restore") {
            await sync.call(client, persistence);
            return;
        }
        try {
            await sync.call(client, persistence);
        }
        catch (error) {
            this.logger.warn({ error, provider, sessionId: persistence.sessionId }, "Failed to archive native session (best-effort)");
        }
    }
    requireAgent(id) {
        const normalizedId = validateAgentId(id, "requireAgent");
        const agent = this.agents.get(normalizedId);
        if (!agent) {
            throw new Error(`Unknown agent '${normalizedId}'`);
        }
        return agent;
    }
    requireSessionAgent(id) {
        const agent = this.requireAgent(id);
        if (agent.session === null) {
            throw new Error(`Agent '${agent.id}' has no managed session`);
        }
        return agent;
    }
    requirePublicAgent(id) {
        const agent = this.requireAgent(id);
        if (agent.internal) {
            throw new Error(`Unknown agent '${agent.id}'`);
        }
        return agent;
    }
}
function matchesImportableSessionQuery(session, rawQuery) {
    const query = rawQuery?.trim().toLowerCase();
    if (!query)
        return true;
    const cwdBasename = basename(session.cwd.replaceAll("\\", "/"));
    return [session.title, session.firstPromptPreview, session.lastPromptPreview, cwdBasename].some((value) => value?.toLowerCase().includes(query));
}
export function commandMayHaveChangedExternalState(command) {
    const normalized = command.toLowerCase();
    // Commands that operate on remote state and do NOT trigger local file
    // watchers. Local git mutations (commit, checkout, merge, rebase, reset,
    // pull) are already caught by watchers on .git/HEAD and refs/heads/.
    return (
    // GitHub PR operations (merge, close, create, edit, comment, review)
    /\bgh\s+pr\s+(merge|close|create|edit|comment|review)\b/.test(normalized) ||
        // Pushes to remote — local refs unchanged, but remote state (PR checks,
        // mergeable status) may shift immediately after.
        /\bgit\s+push\b/.test(normalized) ||
        // Fetches update refs/remotes/ which our watchers do not watch, so
        // ahead/behind counts can drift stale until the next refresh.
        /\bgit\s+fetch\b/.test(normalized));
}
//# sourceMappingURL=agent-manager.js.map