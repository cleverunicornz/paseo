import { buildPiLaunch } from "../runtime.js";
export class FakePi {
    constructor(command = ["pi"]) {
        this.recordedLaunches = [];
        this.sessions = [];
        this.queuedCommands = [];
        this.queuedSessionSetups = [];
        this.removedModels = new Set();
        this.command = command;
    }
    async startSession(input) {
        const launch = buildPiLaunch({
            command: this.command,
            session: input,
        });
        this.recordedLaunches.push(launch);
        if (launch.model && this.removedModels.has(launch.model)) {
            throw new Error(`Model "${launch.model}" not found`);
        }
        const session = new FakePiSession(launch, this.removedModels);
        session.commands = this.queuedCommands.shift() ?? [];
        this.queuedSessionSetups.shift()?.(session);
        this.sessions.push(session);
        return session;
    }
    queueCommands(commands) {
        this.queuedCommands.push(commands);
    }
    queueSessionSetup(setup) {
        this.queuedSessionSetups.push(setup);
    }
    // Pi refuses to launch with, or switch to, a model it no longer knows.
    removeModel(modelId) {
        this.removedModels.add(modelId);
    }
    latestSession() {
        const session = this.sessions.at(-1);
        if (!session) {
            throw new Error("FakePi has no sessions");
        }
        return session;
    }
}
export class FakePiSession {
    constructor(launch, removedModels = new Set()) {
        this.removedModels = removedModels;
        this.prompts = [];
        this.steerCalls = [];
        this.steerError = null;
        this.controlRequests = [];
        this.clearQueueError = null;
        this.compactRequests = [];
        this.setAutoCompactionRequests = [];
        this.subagentSubscriptionRequests = [];
        this.subagentMessageRequests = [];
        this.setModelRequests = [];
        this.setThinkingLevelRequests = [];
        this.treeNavigationRequests = [];
        this.handoffRequests = [];
        this.sessionNameRequests = [];
        this.rawFrames = [];
        // Every user entry in the session file, including rewound and compacted ones.
        this.treeUserEntries = [];
        // The user entries on the current branch that getMessages() replays.
        this.contextUserEntries = [];
        this.abortRequested = false;
        this.canceledExtensionUiRequests = [];
        this.extensionUiResponses = [];
        this.setModelResult = null;
        this.models = [];
        this.messages = [];
        this.stats = {
            tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
            cost: 0,
        };
        this.commands = [];
        this.subagents = [];
        this.subagentSubscriptionError = null;
        this.setSessionNameError = null;
        this.compactError = null;
        this.emitCompactEnd = true;
        this.getStateError = null;
        this.getSessionStatsError = null;
        this.promptAck = {};
        this.branchResponse = { text: "" };
        this.branchRequests = [];
        this.subscribers = new Set();
        this.subagentMessageResults = new Map();
        this.nextHeldPrompt = null;
        this.activeHeldPrompt = null;
        this.environment = launch.env ?? {};
        this.state = {
            model: null,
            thinkingLevel: "medium",
            isStreaming: false,
            isCompacting: false,
            autoCompactionEnabled: true,
            sessionFile: launch.session ?? "/tmp/pi-session",
            sessionId: "pi-session-1",
            messageCount: 0,
            pendingMessageCount: 0,
        };
    }
    onEvent(callback) {
        this.subscribers.add(callback);
        return () => {
            this.subscribers.delete(callback);
        };
    }
    async prompt(message, images) {
        this.prompts.push({ message, imageCount: images?.length ?? 0 });
        const heldPrompt = this.nextHeldPrompt;
        if (heldPrompt) {
            this.nextHeldPrompt = null;
            this.activeHeldPrompt = heldPrompt;
            try {
                await heldPrompt.promise;
            }
            finally {
                if (this.activeHeldPrompt === heldPrompt) {
                    this.activeHeldPrompt = null;
                }
            }
        }
        this.handleTreeNavigationCommand(message);
        this.handleEntryCaptureCommand(message);
        return this.promptAck;
    }
    holdNextPrompt() {
        if (this.nextHeldPrompt || this.activeHeldPrompt) {
            throw new Error("FakePi already has a held prompt");
        }
        let reject;
        const promise = new Promise((_resolve, rejectPromise) => {
            reject = rejectPromise;
        });
        this.nextHeldPrompt = { promise, reject };
    }
    async failHeldPrompt(error) {
        const heldPrompt = this.activeHeldPrompt ?? this.nextHeldPrompt;
        if (!heldPrompt) {
            throw new Error("FakePi has no held prompt");
        }
        heldPrompt.reject(error);
        await new Promise((resolve) => setImmediate(resolve));
    }
    async steer(message, images) {
        this.steerCalls.push({ message, imageCount: images?.length ?? 0 });
        if (this.steerError) {
            throw this.steerError;
        }
    }
    async clearQueue() {
        this.controlRequests.push("clear_queue");
        if (this.clearQueueError) {
            throw this.clearQueueError;
        }
    }
    async compact(customInstructions) {
        this.compactRequests.push(customInstructions === undefined ? {} : { customInstructions });
        this.emit({ type: "compaction_start", reason: "manual" });
        if (this.emitCompactEnd) {
            this.emit({ type: "compaction_end", reason: "manual" });
        }
        if (this.compactError) {
            throw this.compactError;
        }
    }
    async setAutoCompaction(enabled) {
        this.setAutoCompactionRequests.push(enabled);
        this.state = {
            ...this.state,
            autoCompactionEnabled: enabled,
        };
    }
    async abort() {
        this.controlRequests.push("abort");
        this.abortRequested = true;
    }
    async getState() {
        if (this.getStateError) {
            throw this.getStateError;
        }
        return this.state;
    }
    async getMessages() {
        return this.messages;
    }
    async getAvailableModels(_timeoutMs) {
        return this.models;
    }
    async setModel(provider, modelId) {
        this.setModelRequests.push({ provider, modelId });
        if (this.removedModels.has(`${provider}/${modelId}`)) {
            throw new Error(`Model not found: ${provider}/${modelId}`);
        }
        if (!this.setModelResult) {
            throw new Error("FakePi setModel requires setModelResult to be scripted");
        }
        this.state = { ...this.state, model: this.setModelResult };
        return this.setModelResult;
    }
    async setThinkingLevel(level) {
        this.setThinkingLevelRequests.push(level);
    }
    async getSessionStats() {
        if (this.getSessionStatsError) {
            throw this.getSessionStatsError;
        }
        return this.stats;
    }
    async setSubagentSubscription(level) {
        this.subagentSubscriptionRequests.push(level);
        if (this.subagentSubscriptionError) {
            throw this.subagentSubscriptionError;
        }
    }
    async getSubagents() {
        return this.subagents;
    }
    async getSubagentMessages(selector) {
        this.subagentMessageRequests.push(selector);
        const key = selector.sessionFile ?? selector.subagentId;
        if (!key) {
            throw new Error("FakePi getSubagentMessages requires a selector");
        }
        const results = this.subagentMessageResults.get(key);
        const result = results?.shift();
        if (!result) {
            throw new Error(`FakePi has no subagent messages queued for ${key}`);
        }
        return result;
    }
    queueSubagentMessages(result) {
        const results = this.subagentMessageResults.get(result.sessionFile) ?? [];
        results.push(result);
        this.subagentMessageResults.set(result.sessionFile, results);
    }
    async getCommands() {
        return this.commands;
    }
    sendRawFrame(frame) {
        this.rawFrames.push(frame);
    }
    async request(command) {
        switch (command.type) {
            case "set_subagent_subscription":
                await this.setSubagentSubscription(command.level);
                return {};
            case "get_subagents":
                return { subagents: await this.getSubagents() };
            case "get_subagent_messages":
                return await this.getSubagentMessages({
                    ...(typeof command.subagentId === "string" ? { subagentId: command.subagentId } : {}),
                    ...(typeof command.sessionFile === "string" ? { sessionFile: command.sessionFile } : {}),
                    ...(typeof command.fromByte === "number" ? { fromByte: command.fromByte } : {}),
                });
            case "branch": {
                const entryId = typeof command.entryId === "string" ? command.entryId : "";
                this.branchRequests.push(entryId);
                return this.branchResponse;
            }
            case "handoff":
                this.handoffRequests.push(typeof command.customInstructions === "string"
                    ? { customInstructions: command.customInstructions }
                    : {});
                return {};
            case "set_session_name":
                this.sessionNameRequests.push(typeof command.name === "string" ? command.name : "");
                if (this.setSessionNameError) {
                    throw this.setSessionNameError;
                }
                return {};
            default:
                throw new Error(`FakePi request does not implement ${command.type}`);
        }
    }
    respondToExtensionUiRequest(id, response) {
        this.extensionUiResponses.push({ id, response });
    }
    cancelExtensionUiRequest(id) {
        this.canceledExtensionUiRequests.push(id);
        this.respondToExtensionUiRequest(id, { cancelled: true });
    }
    async close() { }
    emit(event) {
        for (const subscriber of this.subscribers) {
            subscriber(event);
        }
    }
    finishAgentRun({ message, willRetry }) {
        this.messages = [...this.messages, message];
        this.emit({
            type: "agent_end",
            messages: this.messages,
            willRetry,
        });
    }
    settleTurn() {
        this.emit({ type: "agent_settled" });
    }
    finishTurn(message = { role: "assistant", content: [] }) {
        this.finishAgentRun({ message, willRetry: false });
        this.settleTurn();
    }
    finishLegacyTurn(message = { role: "assistant", content: [] }) {
        this.messages = [...this.messages, message];
        this.emit({ type: "agent_end", messages: this.messages });
    }
    finishSubmittedUserMessage(entry) {
        this.emit({
            type: "message_end",
            message: { role: "user", content: entry.text },
        });
        this.emit({
            type: "extension_ui_request",
            id: `submitted-user-${entry.id}`,
            method: "notify",
            message: `PASEO_SUBMITTED_USER_ENTRY ${JSON.stringify({ entry })}`,
        });
    }
    handleTreeNavigationCommand(message) {
        const prefix = "/paseo_tree ";
        if (!message.startsWith(prefix)) {
            return;
        }
        const payload = JSON.parse(Buffer.from(message.slice(prefix.length), "base64url").toString("utf8"));
        if (typeof payload.targetId !== "string" || typeof payload.requestId !== "string") {
            return;
        }
        this.treeNavigationRequests.push(payload.targetId);
        this.emitEntryCapture(undefined, "tree_navigation");
        this.emitExtensionCommandResult(payload.requestId, { ok: true, result: {} });
    }
    handleEntryCaptureCommand(message) {
        const prefix = "/paseo_capture_entries ";
        if (!message.startsWith(prefix)) {
            return;
        }
        const payload = JSON.parse(Buffer.from(message.slice(prefix.length), "base64url").toString("utf8"));
        if (typeof payload.requestId !== "string") {
            return;
        }
        this.emitEntryCapture(payload.requestId, typeof payload.reason === "string" ? payload.reason : "command");
    }
    emitEntryCapture(requestId, reason = "test") {
        this.emit({
            type: "extension_ui_request",
            id: `capture-${requestId ?? reason}`,
            method: "notify",
            message: `PASEO_ENTRY_CAPTURE ${JSON.stringify({
                reason,
                requestId,
                treeEntries: this.treeUserEntries,
                contextEntries: this.contextUserEntries,
            })}`,
        });
    }
    emitExtensionCommandResult(requestId, result) {
        this.emit({
            type: "extension_ui_request",
            id: `command-${requestId}`,
            method: "notify",
            message: `PASEO_COMMAND_RESULT ${JSON.stringify({ requestId, ...result })}`,
        });
    }
}
//# sourceMappingURL=fake-pi.js.map