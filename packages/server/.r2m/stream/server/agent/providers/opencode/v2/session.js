import { SessionChildren } from "./children.js";
import { SessionTurns } from "./turns.js";
import { V2Timeline } from "./timeline.js";
import { waitForLocationReady, awaitPaseoPlugin } from "./readiness.js";
import { setTimeout as delay } from "node:timers/promises";
import { toDiagnosticErrorMessage } from "../../diagnostic-utils.js";
import { runProviderTurn } from "../../provider-runner.js";
import { composeSystemPromptParts } from "../../../system-prompt.js";
import { raceProviderRefreshAbort } from "../../../provider-refresh-deadline.js";
import { modelRef, modesFromV2 } from "./mapping.js";
import { V2_CAPABILITIES } from "./capabilities.js";
import { features } from "./configuration.js";
import { commands } from "./commands.js";
import { messages } from "./history.js";
import { SessionPermissions } from "./permissions.js";
import { SessionUsage } from "./usage.js";
export class OpenCodeV2Session {
    constructor(connection, info, config, logger, persist, requiresPaseoPlugin, unbind, bindChild, acquire, moved) {
        this.connection = connection;
        this.info = info;
        this.config = config;
        this.logger = logger;
        this.persist = persist;
        this.requiresPaseoPlugin = requiresPaseoPlugin;
        this.unbind = unbind;
        this.acquire = acquire;
        this.moved = moved;
        this.provider = "opencode";
        this.capabilities = V2_CAPABILITIES;
        this.listeners = new Set();
        this.timeline = new V2Timeline();
        this.abort = new AbortController();
        this.stream = null;
        this.streamAbort = new AbortController();
        this.exited = false;
        this.reconnecting = null;
        this.sync = Promise.resolve();
        this.dirty = false;
        this.refreshTimer = null;
        this.closed = false;
        this.history = [];
        this.modes = [];
        this.permissions = new SessionPermissions(() => this.client, info.id, config, (event) => this.emit(event));
        this.children = new SessionChildren({
            client: () => this.client,
            id: info.id,
            emit: (event) => this.emit(event),
            reconcilePermissions: (id) => this.permissions.reconcile(id),
            bindChild,
        });
        this.turns = new SessionTurns({
            client: () => this.client,
            id: info.id,
            cwd: config.cwd,
            signal: this.abort.signal,
            emit: (event) => this.emit(event),
            reconcile: async () => {
                await this.reconcile();
                return { info: this.info, history: this.history };
            },
            reportReconciliationError: (error) => this.logger.warn({ error: toDiagnosticErrorMessage(error) }, "OpenCode turn reconciliation failed; retrying"),
            clearPermissions: async () => {
                for (const request of this.permissions.list())
                    await this.permissions.respondToPermission(request.id, { behavior: "deny" });
            },
        });
        this.usage = new SessionUsage({
            client: () => this.client,
            cwd: config.cwd,
            info: () => this.info,
            emit: (event) => this.emit(event),
            reportError: (error) => this.logger.warn({ error: toDiagnosticErrorMessage(error) }, "OpenCode context usage update failed"),
        });
    }
    get id() {
        return this.info.id;
    }
    get features() {
        return features(this.config);
    }
    get client() {
        return this.connection.client;
    }
    async initialize(environment) {
        // OpenCode replaces the whole local shell environment, rather than overlaying it.
        this.launchEnv = environment;
        this.watchExit(this.connection);
        await this.configureConnection();
        const location = { directory: this.config.cwd };
        this.modes = modesFromV2((await this.client.agent.list({ location })).data);
        this.timeline.messages(await messages(this.client, this.id));
        await this.startStream();
        await this.children.reconcile(this.id);
    }
    watchExit(connection) {
        void connection.exited.then((error) => {
            if (this.closed || this.connection !== connection)
                return undefined;
            this.exited = true;
            this.streamAbort.abort(error);
            this.turns.fail(error);
            return undefined;
        });
    }
    async configureConnection() {
        const location = { directory: this.config.cwd };
        await waitForLocationReady({ client: this.client, location, signal: this.abort.signal });
        if (this.requiresPaseoPlugin)
            await awaitPaseoPlugin({ client: this.client, location, signal: this.abort.signal });
        for (const [server, config] of Object.entries(this.config.mcpServers ?? {})) {
            await this.client.mcp.add({
                server,
                location,
                config: config.type === "stdio"
                    ? {
                        type: "local",
                        command: [config.command, ...(config.args ?? [])],
                        environment: config.env,
                        codemode: false,
                    }
                    : {
                        type: "remote",
                        url: config.url,
                        headers: config.headers,
                        oauth: false,
                        codemode: false,
                    },
            });
            await this.awaitMcp(server);
        }
        const system = composeSystemPromptParts(this.config.systemPrompt, this.config.daemonAppendSystemPrompt);
        if (system)
            await this.client.session.instructions.entry.put({
                sessionID: this.id,
                key: "paseo",
                value: system,
            });
    }
    async startStream() {
        let ready;
        let fail;
        const first = new Promise((resolve, reject) => {
            ready = resolve;
            fail = reject;
        });
        this.stream = this.consume(ready, fail);
        await raceProviderRefreshAbort(AbortSignal.any([this.abort.signal, AbortSignal.timeout(30000)]), first);
    }
    async reconnectIfExited() {
        if (this.closed)
            throw new Error("OpenCode session is closed");
        if (!this.exited)
            return;
        this.reconnecting ?? (this.reconnecting = this.reconnect().finally(() => {
            this.reconnecting = null;
        }));
        await this.reconnecting;
    }
    async reconnect() {
        if (!this.acquire)
            throw new Error("OpenCode helper server exited");
        await this.stream;
        await this.sync.catch(() => undefined);
        const next = await this.acquire();
        if (this.closed) {
            await next.release();
            throw new Error("OpenCode session is closed");
        }
        const old = this.connection;
        this.connection = next;
        this.streamAbort = new AbortController();
        this.exited = false;
        this.watchExit(next);
        try {
            await this.configureConnection();
            await this.startStream();
        }
        catch (error) {
            this.connection = old;
            this.exited = true;
            this.streamAbort.abort();
            await next.release();
            throw error;
        }
        this.moved?.(next);
        await old.release();
    }
    subscribe(callback) {
        this.listeners.add(callback);
        return () => {
            this.listeners.delete(callback);
        };
    }
    async awaitMcp(server) {
        const signal = AbortSignal.any([this.abort.signal, AbortSignal.timeout(30000)]);
        while (true) {
            const catalog = await this.client.mcp.list({ location: { directory: this.config.cwd } }, { signal });
            const entry = catalog.data.find((item) => item.name === server);
            if (entry?.status.status === "connected")
                return;
            if (entry && entry.status.status !== "pending") {
                const reason = entry.status.status === "failed" ? entry.status.error : entry.status.status;
                throw new Error(`OpenCode MCP server ${server} failed to connect: ${reason}`);
            }
            await delay(50, undefined, { signal });
        }
    }
    emit(event) {
        for (const listener of this.listeners)
            listener(event);
    }
    emitTimeline(event) {
        this.emit({ ...event, ...(this.turns.id ? { turnId: this.turns.id } : {}) });
    }
    async *streamHistory() {
        await this.reconnectIfExited();
        const history = new V2Timeline(false);
        yield* history.messages(await messages(this.client, this.id));
    }
    async getRuntimeInfo() {
        await this.reconnectIfExited();
        this.info = await this.client.session.get({ sessionID: this.id });
        return {
            provider: "opencode",
            sessionId: this.id,
            model: this.info.model ? `${this.info.model.providerID}/${this.info.model.id}` : null,
            modeId: this.info.agent ?? null,
            thinkingOptionId: this.info.model?.variant ?? null,
        };
    }
    async getAvailableModes() {
        return this.modes;
    }
    async getCurrentMode() {
        return this.info.agent ?? null;
    }
    async setMode(modeId) {
        await this.reconnectIfExited();
        await this.client.session.switchAgent({ sessionID: this.id, agent: modeId });
        this.info.agent = modeId;
        this.config.modeId = modeId;
        this.emit({
            type: "mode_changed",
            provider: "opencode",
            currentModeId: modeId,
            availableModes: this.modes,
        });
    }
    async setModel(model) {
        await this.reconnectIfExited();
        const location = { directory: this.config.cwd };
        const selected = model ? modelRef(model) : (await this.client.model.default({ location })).data;
        if (!selected)
            throw new Error("OpenCode has no default model");
        const catalog = await this.client.model.list({ location });
        const target = catalog.data.find((entry) => entry.enabled && entry.providerID === selected.providerID && entry.id === selected.id);
        if (!target)
            throw new Error(`OpenCode model unavailable: ${selected.providerID}/${selected.id}`);
        const retainedVariant = this.config.thinkingOptionId;
        const variant = retainedVariant !== "default" && target.variants.some((entry) => entry.id === retainedVariant)
            ? retainedVariant
            : undefined;
        const nextModel = {
            id: selected.id,
            providerID: selected.providerID,
            ...(variant ? { variant } : {}),
        };
        await this.client.session.switchModel({ sessionID: this.id, model: nextModel });
        this.info.model = nextModel;
        this.config.model = model ?? undefined;
        this.config.thinkingOptionId = variant;
        this.emit({
            type: "thinking_option_changed",
            provider: "opencode",
            thinkingOptionId: variant ?? null,
        });
        this.emit({
            type: "model_changed",
            provider: "opencode",
            runtimeInfo: {
                provider: "opencode",
                sessionId: this.id,
                model: `${selected.providerID}/${selected.id}`,
                modeId: this.info.agent ?? null,
                thinkingOptionId: variant ?? null,
            },
        });
    }
    async setThinkingOption(variant) {
        await this.reconnectIfExited();
        const model = this.info.model;
        if (!model)
            throw new Error("Select an OpenCode model before changing its variant");
        await this.client.session.switchModel({
            sessionID: this.id,
            model: { id: model.id, providerID: model.providerID, ...(variant ? { variant } : {}) },
        });
        this.config.thinkingOptionId = variant ?? undefined;
        this.info = await this.client.session.get({ sessionID: this.id });
        this.emit({ type: "thinking_option_changed", provider: "opencode", thinkingOptionId: variant });
    }
    async setFeature(id, value) {
        if (id !== "auto_accept" || typeof value !== "boolean")
            throw new Error("Unknown OpenCode feature");
        this.config.featureValues = { ...this.config.featureValues, [id]: value };
        if (value && !this.config.toolPolicy)
            for (const request of this.permissions.list())
                if (request.kind !== "question")
                    await this.respondToPermission(request.id, { behavior: "allow" });
    }
    async listCommands() {
        await this.reconnectIfExited();
        return commands(this.client, this.config.cwd);
    }
    describePersistence() {
        return {
            provider: "opencode",
            sessionId: this.id,
            nativeHandle: this.id,
            metadata: { ...this.config },
        };
    }
    run(prompt, options) {
        return runProviderTurn({
            prompt,
            runOptions: options,
            startTurn: this.startTurn.bind(this),
            subscribe: this.subscribe.bind(this),
            getSessionId: () => this.id,
            reduceFinalText: ({ current, item }) => item.type === "assistant_message" ? current + item.text : current,
        });
    }
    async startTurn(prompt, options) {
        await this.reconnectIfExited();
        return this.turns.startTurn(prompt, options);
    }
    steerActiveTurn(prompt, options) {
        return this.turns.steerActiveTurn(prompt, options);
    }
    interrupt() {
        return this.turns.interrupt();
    }
    async revertBoth(input) {
        await this.interrupt();
        await this.reconnectIfExited();
        await this.client.session.revert.stage({
            sessionID: this.id,
            messageID: input.messageId,
            files: true,
        });
        await this.client.session.revert.commit({ sessionID: this.id });
    }
    getPendingPermissions() {
        return [...this.permissions.list()];
    }
    async respondToPermission(requestId, response) {
        await this.reconnectIfExited();
        const deniesOwnRequest = response.behavior === "deny" && this.permissions.isOwnedBy(requestId, this.id);
        await this.permissions.respondToPermission(requestId, response);
        if (deniesOwnRequest)
            this.turns.requestDenied();
    }
    async reconcileSnapshot() {
        const [info, history] = await Promise.all([
            this.client.session.get({ sessionID: this.id }),
            messages(this.client, this.id),
        ]);
        this.info = info;
        this.history = history;
        for (const event of this.timeline.messages(history))
            this.emitTimeline(event);
        await this.permissions.reconcile(this.id);
    }
    async reconcile() {
        this.dirty = true;
        this.sync = this.sync.catch(() => undefined).then(() => this.drainReconciliation());
        return this.sync;
    }
    async drainReconciliation() {
        while (this.dirty && !this.closed) {
            this.dirty = false;
            await this.reconcileSnapshot();
        }
    }
    async reconcileConnection() {
        // Session environments are process-local. Reapply this agent's snapshot before
        // reconciling a new connection, including event-stream reconnections.
        if (this.launchEnv)
            await this.client.session.environment({ sessionID: this.id, variables: this.launchEnv });
        await this.reconcile();
        await this.children.reconcile(this.id);
        await this.turns.reconcile();
    }
    scheduleReconcile() {
        if (this.refreshTimer || this.closed)
            return;
        this.refreshTimer = setTimeout(() => {
            this.refreshTimer = null;
            void this.reconcile().catch((error) => this.logger.warn({ error: toDiagnosticErrorMessage(error) }, "OpenCode reconciliation failed"));
        }, 25);
    }
    observeOwnEvent(event) {
        if (event.type === "form.created" && event.data.form.sessionID === this.id) {
            this.scheduleReconcile();
            return;
        }
        if (!("sessionID" in event.data) || event.data.sessionID !== this.id)
            return;
        if (event.type === "session.text.started" || event.type === "session.reasoning.started") {
            if (event.type === "session.text.started" && this.turns.hasStructuredOutput)
                return;
            this.timeline.startPart({
                ...event.data,
                type: event.type === "session.text.started" ? "text" : "reasoning",
            });
            return;
        }
        if (event.type === "session.text.delta" || event.type === "session.reasoning.delta") {
            const isText = event.type === "session.text.delta";
            // A structured-output turn supplies its answer through a tool, so streamed
            // prose is not part of the result and must not reach the timeline.
            if (isText && this.turns.hasStructuredOutput)
                return;
            const streamed = this.timeline.delta({
                assistantMessageID: event.data.assistantMessageID,
                ordinal: event.data.ordinal,
                delta: event.data.delta,
                type: isText ? "text" : "reasoning",
            });
            if (streamed)
                this.emitTimeline(streamed);
            return;
        }
        this.permissions.observe(event);
        this.usage.observe(event);
        this.turns.observe(event);
        this.scheduleReconcile();
    }
    async consume(ready, fail) {
        const signal = AbortSignal.any([this.abort.signal, this.streamAbort.signal]);
        let connected = false;
        while (!this.closed && !signal.aborted) {
            try {
                for await (const event of this.client.event.subscribe({ signal })) {
                    if (this.closed || signal.aborted)
                        return;
                    if (event.type === "server.connected") {
                        this.timeline.resetStreams();
                        await this.reconcileConnection();
                        connected = true;
                        ready();
                    }
                    await this.children.observe(event);
                    this.observeOwnEvent(event);
                }
                if (!connected)
                    throw new Error("OpenCode event stream ended before connecting");
            }
            catch (error) {
                if (this.closed || signal.aborted)
                    return;
                if (!connected) {
                    fail(error);
                    return;
                }
                this.logger.warn({ error: toDiagnosticErrorMessage(error) }, "OpenCode event stream interrupted; reconciling on reconnect");
            }
            await delay(100, undefined, { signal }).catch(() => undefined);
        }
    }
    async close() {
        if (this.closed)
            return;
        this.closed = true;
        this.abort.abort();
        this.turns.close();
        this.streamAbort.abort();
        if (this.refreshTimer)
            clearTimeout(this.refreshTimer);
        await this.stream;
        await this.reconnecting?.catch(() => undefined);
        await this.sync.catch(() => undefined);
        this.unbind?.();
        try {
            if (!this.persist)
                await this.client.session.remove({ sessionID: this.id });
        }
        finally {
            await this.connection.release();
        }
        this.listeners.clear();
    }
}
//# sourceMappingURL=session.js.map