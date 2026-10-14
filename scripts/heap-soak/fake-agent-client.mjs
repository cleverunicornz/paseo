import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, rmSync, readdirSync } from "node:fs";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
const { isLikelyExternalToolName } = await import((process.env.PASEO_DIAGNOSTIC_MODULES || "/opt/gh-runners/node-global/lib/node_modules") + "/@getpaseo/protocol/dist/tool-name-normalization.js");
const TEST_CAPABILITIES = {
    supportsStreaming: true,
    supportsSessionPersistence: true,
    supportsDynamicModes: true,
    supportsMcpServers: false,
    supportsReasoningStream: true,
    supportsToolInvocations: true,
    supportsRewindConversation: false,
    supportsRewindFiles: false,
    supportsRewindBoth: false,
};
const TEST_FEATURE_ID = "test_feature";
const TEST_MODES = [
    { id: "bypassPermissions", label: "Bypass", description: "No permissions" },
    { id: "default", label: "Default", description: "Ask for permissions" },
    { id: "full-access", label: "Full access", description: "No prompts" },
    { id: "auto", label: "Auto", description: "Ask/allow based on policy" },
    { id: "always-ask", label: "Always Ask", description: "Always prompt" },
];
function createDeferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}
function isAskMode(config) {
    const mode = (config.modeId ?? "").toLowerCase();
    const policy = typeof config.providerOptions?.approval_policy === "string"
        ? config.providerOptions.approval_policy.toLowerCase()
        : "";
    // Default behavior for tests: ask unless explicitly bypassed.
    if (!mode && !policy) {
        return true;
    }
    if (policy === "never") {
        return false;
    }
    if (mode.includes("bypass") || mode.includes("full")) {
        return false;
    }
    if (mode.includes("read-only") ||
        mode.includes("default") ||
        mode.includes("plan") ||
        mode.includes("ask")) {
        return true;
    }
    // "auto" behaves like "ask" for potentially-destructive actions; callers decide per-tool.
    if (mode.includes("auto")) {
        return true;
    }
    return policy === "on-request";
}
function buildPersistence(provider, sessionId, metadata) {
    if (provider === "codex") {
        return { provider, sessionId, metadata: { conversationId: sessionId, ...metadata } };
    }
    return { provider, sessionId, ...(metadata ? { metadata } : {}) };
}
function buildClaudeToolCall(text) {
    if (text.includes("read") && text.includes("/etc/hosts")) {
        return { name: "Read", input: { path: "/etc/hosts" }, output: undefined };
    }
    if (text.includes("rm -f permission.txt")) {
        return { name: "Bash", input: { command: "rm -f permission.txt" }, output: { ok: true } };
    }
    if (text.includes("rm -f mcp-smoke.txt")) {
        return { name: "Bash", input: { command: "rm -f mcp-smoke.txt" }, output: { ok: true } };
    }
    if (text.includes("echo hello")) {
        return { name: "Bash", input: { command: "echo hello" }, output: { stdout: "hello\n" } };
    }
    if (text.includes("edit") && text.includes(".txt")) {
        return { name: "Edit", input: { file: "test.txt" }, output: { applied: true } };
    }
    return null;
}
function buildCodexToolCall(text) {
    if (text.includes("echo hello")) {
        return { name: "shell", input: { command: "echo hello" }, output: { stdout: "hello\n" } };
    }
    if (text.includes("read") && text.includes("/etc/hosts")) {
        return { name: "read_file", input: { path: "/etc/hosts" }, output: undefined };
    }
    if (text.includes("read") && text.includes("tool-create.txt")) {
        return { name: "read_file", input: { path: "tool-create.txt" }, output: undefined };
    }
    if (text.includes("edit") && text.includes(".txt")) {
        const output = text.includes("tool-create.txt")
            ? { applied: true, file: "tool-create.txt" }
            : { applied: true };
        return { name: "apply_patch", input: { patch: "*** Begin Patch\n*** End Patch\n" }, output };
    }
    const printfMatch = /printf\s+"ok"\s*>\s*([^\s`]+)/i.exec(text) ?? /printf\s+ok\s*>\s*([^\s`]+)/i.exec(text);
    if (printfMatch) {
        const fileName = printfMatch[1] ?? "permission.txt";
        return {
            name: "shell",
            input: { command: `printf "ok" > ${fileName}` },
            output: { ok: true },
        };
    }
    if (text.includes("sleep")) {
        return { name: "shell", input: { command: "sleep 30" }, output: null };
    }
    return null;
}
function buildOpenCodeToolCall(text) {
    if (text.includes("reason")) {
        return {
            name: "shell",
            input: { command: "echo reasoning" },
            output: { stdout: "reasoning\n" },
        };
    }
    return null;
}
function buildToolCallForPrompt(provider, prompt) {
    const text = prompt.toLowerCase();
    const createFileMatch = /create a file named\s+"([^"]+)"\s+with the content\s+"([^"]*)"/i.exec(prompt) ??
        /create a file named\s+"([^"]+)"\s+with the content\s+'([^']*)'/i.exec(prompt);
    if (createFileMatch) {
        const fileName = createFileMatch[1] ?? "test.txt";
        const content = createFileMatch[2] ?? "";
        if (provider === "codex") {
            return {
                name: "shell",
                input: { command: `printf "%s" "${content}" > ${fileName}` },
                output: { ok: true },
            };
        }
        return {
            name: "Bash",
            input: { command: `printf "%s" "${content}" > ${fileName}` },
            output: { ok: true },
        };
    }
    if (provider === "claude") {
        return buildClaudeToolCall(text);
    }
    if (provider === "codex") {
        return buildCodexToolCall(text);
    }
    if (provider === "opencode") {
        return buildOpenCodeToolCall(text);
    }
    return null;
}
function parseAgentStreamStressPrompt(prompt) {
    const match = /emit\s+(\d+)\s+(coalesced\s+)?agent stream updates/i.exec(prompt);
    if (!match) {
        return null;
    }
    const count = Number(match[1]);
    if (!Number.isFinite(count) || count <= 0) {
        return null;
    }
    return {
        count: Math.min(count, 5000),
        coalesced: Boolean(match[2]),
    };
}
function parseLargeAgentStreamPayloadPrompt(prompt) {
    const match = /emit\s+(\d+)\s+(?:byte\s+)?(?:large\s+)?(diff|file|image)\s+agent stream (?:update|payload)/i.exec(prompt);
    if (!match) {
        return null;
    }
    const bytes = Number(match[1]);
    if (!Number.isFinite(bytes) || bytes <= 0) {
        return null;
    }
    return {
        bytes: Math.min(bytes, 1000000),
        kind: match[2]?.toLowerCase(),
    };
}
function buildRepeatedPayload(bytes, prefix) {
    const line = `${prefix} ${"x".repeat(96)}\n`;
    let output = "";
    while (output.length < bytes) {
        output += line;
    }
    return output.slice(0, bytes);
}
function buildLargeTimelineItem(input) {
    const payload = buildRepeatedPayload(input.bytes, input.kind);
    if (input.kind === "diff") {
        return {
            type: "timeline",
            provider: input.provider,
            item: {
                type: "tool_call",
                name: "apply_patch",
                callId: input.callId,
                status: "completed",
                detail: {
                    type: "edit",
                    filePath: "src/large-diff.ts",
                    unifiedDiff: `diff --git a/src/large-diff.ts b/src/large-diff.ts\n${payload}`,
                },
                error: null,
            },
        };
    }
    if (input.kind === "file") {
        return {
            type: "timeline",
            provider: input.provider,
            item: {
                type: "tool_call",
                name: "read_file",
                callId: input.callId,
                status: "completed",
                detail: {
                    type: "read",
                    filePath: "src/large-file.txt",
                    content: payload,
                },
                error: null,
            },
        };
    }
    return {
        type: "timeline",
        provider: input.provider,
        item: {
            type: "assistant_message",
            text: `data:image/png;base64,${payload}`,
        },
    };
}
class FakeAgentSession {
    constructor(options) {
        this.interruptSignal = createDeferred();
        this.memoryMarker = null;
        this.pendingPermissions = [];
        this.permissionGate = null;
        this.subscribers = new Set();
        this.nextTurnOrdinal = 0;
        this.activeForegroundTurnId = null;
        this.capabilities = {
            ...TEST_CAPABILITIES,
            supportsMcpServers: options.supportsMcpServers === true,
        };
        this.providerName = options.providerName;
        this.config = options.config;
        this.id = options.sessionId ?? randomUUID();
        this.memoryMarker = options.memoryMarker ?? null;
        this.closeSession = options.closeSession;
        this.onStartTurn = options.onStartTurn;
        this.historyPath = path.join(tmpdir(), "paseo-fake-provider-history", this.providerName, `${this.id}.jsonl`);
    }
    get provider() {
        return this.providerName;
    }
    get features() {
        return [
            {
                type: "toggle",
                id: TEST_FEATURE_ID,
                label: "Test feature",
                description: "Deterministic provider feature used by MCP integration tests.",
                value: this.config.featureValues?.[TEST_FEATURE_ID] === true,
            },
        ];
    }
    async appendHistoryEvent(event) {
        const folder = path.dirname(this.historyPath);
        await mkdir(folder, { recursive: true });
        await appendFile(this.historyPath, JSON.stringify(event) + "\n", "utf8");
    }
    parseSlashCommandInput(text) {
        const trimmed = text.trim();
        if (!trimmed.startsWith("/") || trimmed.length <= 1) {
            return null;
        }
        const withoutPrefix = trimmed.slice(1);
        const firstWhitespaceIdx = withoutPrefix.search(/\s/);
        const commandName = firstWhitespaceIdx === -1 ? withoutPrefix : withoutPrefix.slice(0, firstWhitespaceIdx);
        if (!commandName || commandName.includes("/")) {
            return null;
        }
        const rawArgs = firstWhitespaceIdx === -1 ? "" : withoutPrefix.slice(firstWhitespaceIdx + 1).trim();
        return rawArgs ? { commandName, args: rawArgs } : { commandName };
    }
    async resolveSlashCommandInput(prompt) {
        if ((this.providerName !== "codex" && this.providerName !== "opencode") ||
            typeof prompt !== "string") {
            return null;
        }
        const parsed = this.parseSlashCommandInput(prompt);
        if (!parsed) {
            return null;
        }
        const commands = await this.listCommands();
        return commands.some((command) => command.name === parsed.commandName) ? parsed : null;
    }
    async run(prompt, options) {
        const slashCommand = await this.resolveSlashCommandInput(prompt);
        if (slashCommand) {
            const result = await this.runSlashCommand(slashCommand.commandName, slashCommand.args);
            return {
                sessionId: this.id,
                finalText: result.text,
                timeline: result.timeline,
                usage: result.usage,
            };
        }
        const timeline = [];
        const textPrompt = typeof prompt === "string" ? prompt : JSON.stringify(prompt);
        const resultText = this.buildAssistantText(textPrompt);
        timeline.push({ type: "assistant_message", text: resultText });
        const usage = options ? { inputTokens: 1, outputTokens: 1 } : undefined;
        return { sessionId: this.id, finalText: resultText, timeline, usage };
    }
    async startTurn(prompt) {
        if (this.activeForegroundTurnId) {
            throw new Error("A foreground turn is already active");
        }
        const turnId = `fake-turn-${this.nextTurnOrdinal++}`;
        this.activeForegroundTurnId = turnId;
        this.onStartTurn?.(prompt);
        void this.emitTurnEvents(prompt);
        return { turnId };
    }
    subscribe(callback) {
        this.subscribers.add(callback);
        return () => {
            this.subscribers.delete(callback);
        };
    }
    notifySubscribers(event) {
        const turnId = this.activeForegroundTurnId;
        const tagged = turnId ? { ...event, turnId } : event;
        for (const callback of this.subscribers) {
            try {
                callback(tagged);
            }
            catch {
                // Error isolation
            }
        }
    }
    async emitSlashCommandTurn(slashCommand) {
        const threadStarted = {
            type: "thread_started",
            provider: this.providerName,
            sessionId: this.id,
        };
        await this.appendHistoryEvent(threadStarted);
        this.notifySubscribers(threadStarted);
        const turnStarted = {
            type: "turn_started",
            provider: this.providerName,
        };
        await this.appendHistoryEvent(turnStarted);
        this.notifySubscribers(turnStarted);
        const result = await this.runSlashCommand(slashCommand.commandName, slashCommand.args);
        for (const item of result.timeline) {
            const timelineEvent = {
                type: "timeline",
                provider: this.providerName,
                item,
            };
            await this.appendHistoryEvent(timelineEvent);
            this.notifySubscribers(timelineEvent);
        }
        const completed = {
            type: "turn_completed",
            provider: this.providerName,
            usage: result.usage ?? { inputTokens: 1, outputTokens: 1 },
        };
        await this.appendHistoryEvent(completed);
        this.notifySubscribers(completed);
    }
    async emitStressTurn(stress) {
        for (let index = 0; index < stress.count; index += 1) {
            const stressUpdate = {
                type: "timeline",
                provider: this.providerName,
                item: stress.coalesced
                    ? {
                        type: "assistant_message",
                        text: `stress-update-${index}`,
                    }
                    : {
                        type: "todo",
                        items: [{ text: `stress-update-${index}`, completed: index % 2 === 0 }],
                    },
            };
            await this.appendHistoryEvent(stressUpdate);
            this.notifySubscribers(stressUpdate);
            await new Promise((resolve) => setImmediate(resolve));
        }
        const completed = {
            type: "turn_completed",
            provider: this.providerName,
            usage: { inputTokens: 1, outputTokens: stress.count },
        };
        await this.appendHistoryEvent(completed);
        this.notifySubscribers(completed);
    }
    async emitLargePayloadTurn(largePayload) {
        const largeUpdate = buildLargeTimelineItem({
            ...largePayload,
            callId: randomUUID(),
            provider: this.providerName,
        });
        await this.appendHistoryEvent(largeUpdate);
        this.notifySubscribers(largeUpdate);
        const completed = {
            type: "turn_completed",
            provider: this.providerName,
            usage: { inputTokens: 1, outputTokens: largePayload.bytes },
        };
        await this.appendHistoryEvent(completed);
        this.notifySubscribers(completed);
    }
    async resolveToolPermission(tool) {
        const request = {
            id: randomUUID(),
            provider: this.providerName,
            name: tool.name,
            kind: "tool",
            title: "Permission required",
            description: "Test permission request",
            input: tool.input ?? {},
        };
        this.pendingPermissions = [request];
        this.permissionGate = createDeferred();
        const permissionRequested = {
            type: "permission_requested",
            provider: this.providerName,
            request,
        };
        await this.appendHistoryEvent(permissionRequested);
        this.notifySubscribers(permissionRequested);
        const response = await Promise.race([
            this.permissionGate.promise,
            this.interruptSignal.promise.then(() => ({
                behavior: "deny",
                interrupt: true,
                message: "Interrupted",
            })),
        ]);
        this.pendingPermissions = [];
        this.permissionGate = null;
        const permissionResolved = {
            type: "permission_resolved",
            provider: this.providerName,
            requestId: request.id,
            resolution: response,
        };
        await this.appendHistoryEvent(permissionResolved);
        this.notifySubscribers(permissionResolved);
        return {
            denied: response.behavior === "deny",
            interrupted: response.behavior === "deny" && response.interrupt === true,
        };
    }
    async emitDeniedToolTurn(interrupted) {
        if (interrupted) {
            const canceled = {
                type: "turn_canceled",
                provider: this.providerName,
                reason: "permission denied",
            };
            await this.appendHistoryEvent(canceled);
            this.notifySubscribers(canceled);
            return;
        }
        const deniedCompleted = {
            type: "turn_completed",
            provider: this.providerName,
            usage: { inputTokens: 1, outputTokens: 0 },
        };
        await this.appendHistoryEvent(deniedCompleted);
        this.notifySubscribers(deniedCompleted);
    }
    resolveReadToolOutput(tool) {
        if (tool.output) {
            return tool.output;
        }
        if (tool.name !== "Read" && tool.name !== "read_file") {
            return undefined;
        }
        const pathInput = typeof tool.input?.path === "string" ? tool.input.path : "/etc/hosts";
        const resolvedPath = path.isAbsolute(pathInput)
            ? pathInput
            : path.join(this.config.cwd ?? process.cwd(), pathInput);
        try {
            const content = readFileSync(resolvedPath, "utf8");
            return { path: pathInput, content };
        }
        catch {
            return { path: pathInput, content: "" };
        }
    }
    async emitToolCallTurn(tool, textPrompt) {
        const needsPermission = this.needsPermissionForTool(tool.name, tool.input ?? {});
        const callId = randomUUID();
        const toolRunning = {
            type: "timeline",
            provider: this.providerName,
            item: {
                type: "tool_call",
                name: tool.name,
                callId,
                status: "running",
                detail: {
                    type: "unknown",
                    input: tool.input ?? null,
                    output: null,
                },
                error: null,
            },
        };
        await this.appendHistoryEvent(toolRunning);
        this.notifySubscribers(toolRunning);
        if (needsPermission) {
            const permission = await this.resolveToolPermission(tool);
            if (permission.denied) {
                await this.emitDeniedToolTurn(permission.interrupted);
                return true;
            }
        }
        await this.applyToolSideEffects(tool.name, tool.input ?? {}, textPrompt);
        const toolOutput = this.resolveReadToolOutput(tool);
        const toolCompleted = {
            type: "timeline",
            provider: this.providerName,
            item: {
                type: "tool_call",
                name: tool.name,
                callId,
                status: "completed",
                detail: {
                    type: "unknown",
                    input: tool.input ?? null,
                    output: toolOutput ?? { ok: true },
                },
                error: null,
            },
        };
        await this.appendHistoryEvent(toolCompleted);
        this.notifySubscribers(toolCompleted);
        return false;
    }
    async emitTurnEvents(prompt) {
        this.interruptSignal = createDeferred();
        const slashCommand = await this.resolveSlashCommandInput(prompt);
        const textPrompt = typeof prompt === "string" ? prompt : JSON.stringify(prompt);
        try {
            if (slashCommand) {
                await this.emitSlashCommandTurn(slashCommand);
                return;
            }
            const markerMatch = /remember (?:this )?(?:marker|string|project name)[^"]*"([^"]+)"/i.exec(textPrompt);
            if (markerMatch) {
                this.memoryMarker = markerMatch[1] ?? null;
            }
            const threadStarted = {
                type: "thread_started",
                provider: this.providerName,
                sessionId: this.id,
            };
            await this.appendHistoryEvent(threadStarted);
            this.notifySubscribers(threadStarted);
            const turnStarted = {
                type: "turn_started",
                provider: this.providerName,
            };
            await this.appendHistoryEvent(turnStarted);
            this.notifySubscribers(turnStarted);
            if (textPrompt === "Emit a provider child") {
                const child = {
                    type: "provider_subagent",
                    provider: this.providerName,
                    event: { type: "upsert", id: "fixture-child", title: "Fixture child", status: "running" },
                };
                await this.appendHistoryEvent(child);
                this.notifySubscribers(child);
            }
            if (textPrompt.toLowerCase().includes("emit a turn failure")) {
                const failed = {
                    type: "turn_failed",
                    provider: this.providerName,
                    error: "Requested fake provider failure",
                };
                await this.appendHistoryEvent(failed);
                this.notifySubscribers(failed);
                return;
            }
            const stress = parseAgentStreamStressPrompt(textPrompt);
            if (stress !== null) {
                await this.emitStressTurn(stress);
                return;
            }
            const largePayload = parseLargeAgentStreamPayloadPrompt(textPrompt);
            if (largePayload !== null) {
                await this.emitLargePayloadTurn(largePayload);
                return;
            }
            const tool = buildToolCallForPrompt(this.providerName, textPrompt);
            if (tool) {
                const returnedEarly = await this.emitToolCallTurn(tool, textPrompt);
                if (returnedEarly) {
                    return;
                }
            }
            const assistantText = this.buildAssistantText(textPrompt);
            const assistantChunkA = {
                type: "timeline",
                provider: this.providerName,
                item: { type: "assistant_message", text: assistantText.slice(0, 6) },
            };
            await this.appendHistoryEvent(assistantChunkA);
            this.notifySubscribers(assistantChunkA);
            const assistantChunkBText = assistantText.slice(6);
            if (assistantChunkBText.length > 0) {
                const assistantChunkB = {
                    type: "timeline",
                    provider: this.providerName,
                    item: { type: "assistant_message", text: assistantChunkBText },
                };
                await this.appendHistoryEvent(assistantChunkB);
                this.notifySubscribers(assistantChunkB);
            }
            const completed = {
                type: "turn_completed",
                provider: this.providerName,
                usage: { inputTokens: 1, outputTokens: 1 },
            };
            await this.appendHistoryEvent(completed);
            this.notifySubscribers(completed);
        }
        finally {
            this.activeForegroundTurnId = null;
        }
    }
    async *streamHistory() {
        let contents;
        try {
            contents = await readFile(this.historyPath, "utf8");
        }
        catch (error) {
            const code = error.code;
            if (code === "ENOENT") {
                return;
            }
            throw error;
        }
        for (const line of contents.split("\n")) {
            const trimmed = line.trim();
            if (!trimmed)
                continue;
            yield JSON.parse(trimmed);
        }
    }
    async getRuntimeInfo() {
        return {
            provider: this.providerName,
            sessionId: this.id,
            model: this.config.model ?? null,
            modeId: this.config.modeId ?? null,
        };
    }
    async getAvailableModes() {
        return TEST_MODES;
    }
    async getCurrentMode() {
        return this.config.modeId ?? null;
    }
    async setMode(modeId) {
        this.config.modeId = modeId;
    }
    async setFeature(featureId, value) {
        this.config.featureValues = {
            ...this.config.featureValues,
            [featureId]: value,
        };
    }
    getPendingPermissions() {
        return this.pendingPermissions;
    }
    async respondToPermission(_requestId, response) {
        if (!this.permissionGate) {
            return;
        }
        this.permissionGate.resolve(response);
        this.permissionGate = null;
    }
    describePersistence() {
        const metadata = {
            ...(this.memoryMarker ? { marker: this.memoryMarker } : {}),
            ...(this.config.mcpServers ? { mcpServers: this.config.mcpServers } : {}),
        };
        return buildPersistence(this.providerName, this.id, Object.keys(metadata).length > 0 ? metadata : undefined);
    }
    async interrupt() {
        this.interruptSignal.resolve();
    }
    async close() {
        await this.closeSession?.();
    }
    async listCommands() {
        if (this.providerName === "codex") {
            const codexHome = process.env.CODEX_HOME ?? path.join(process.env.HOME ?? "/tmp", ".codex");
            const commands = [];
            const promptsDir = path.join(codexHome, "prompts");
            try {
                for (const entry of readdirSync(promptsDir, { withFileTypes: true })) {
                    if (!entry.isFile())
                        continue;
                    if (!entry.name.endsWith(".md"))
                        continue;
                    const name = entry.name.slice(0, -".md".length);
                    commands.push({
                        name: `prompts:${name}`,
                        description: "Prompt command",
                        argumentHint: "",
                    });
                }
            }
            catch {
                // ignore missing dirs
            }
            const skillsDir = path.join(codexHome, "skills");
            try {
                for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
                    if (!entry.isDirectory())
                        continue;
                    commands.push({
                        name: entry.name,
                        description: "Skill command",
                        argumentHint: "",
                    });
                }
            }
            catch {
                // ignore
            }
            return commands;
        }
        // Keep deterministic defaults for non-codex providers.
        if (this.providerName === "claude") {
            return [
                { name: "help", description: "Help", argumentHint: "" },
                { name: "context", description: "Context", argumentHint: "" },
                {
                    name: "rewind",
                    description: "Rewind tracked files to a previous user message",
                    argumentHint: "[user_message_uuid]",
                },
            ];
        }
        return [
            { name: "help", description: "Help", argumentHint: "" },
            { name: "context", description: "Context", argumentHint: "" },
        ];
    }
    async runSlashCommand(commandName, args) {
        const fullName = commandName.trim();
        if (this.providerName === "codex" && fullName.startsWith("prompts:")) {
            const promptId = fullName.slice("prompts:".length);
            return {
                text: `PASEO_OK ${args ?? ""}`.trim(),
                timeline: [{ type: "assistant_message", text: `PASEO_OK ${promptId}` }],
                usage: { inputTokens: 1, outputTokens: 1 },
            };
        }
        return {
            text: "PASEO_SKILL_OK",
            timeline: [{ type: "assistant_message", text: "PASEO_SKILL_OK" }],
            usage: { inputTokens: 1, outputTokens: 1 },
        };
    }
    buildAssistantText(prompt) {
        const lower = prompt.toLowerCase();
        // Special-case for tests that ask the agent to run pwd but use a placeholder in the
        // "respond with exactly" instruction.
        if (lower.includes("run `pwd`") && lower.includes("respond with exactly: cwd:")) {
            const cwd = this.config.cwd ?? process.cwd();
            return `CWD: ${cwd}`;
        }
        const respondExactlyMatch = /respond with exactly:\s*([^\n\r]+)\s*$/i.exec(prompt) ??
            /respond with exactly:\s*([^\n\r]+)/i.exec(prompt);
        if (respondExactlyMatch) {
            return (respondExactlyMatch[1] ?? "").trim();
        }
        if (lower.includes("state saved"))
            return "state saved";
        if (lower.includes("timeline test"))
            return "timeline test";
        if (lower.includes("quick brown fox") && lower.includes("lazy dog")) {
            return "The quick brown fox jumps over the lazy dog. Then the fox ran away.";
        }
        if (lower.includes("what did i ask you to say earlier"))
            return "You asked me to say state saved.";
        if (lower.includes("say 'timeline test'"))
            return "timeline test";
        if (lower.includes("say 'state saved'"))
            return "state saved";
        if (lower.includes("return schema-valid json") || lower.includes("schema-valid json")) {
            return JSON.stringify({ ok: true });
        }
        if (lower.includes("what was the marker") || lower.includes("what was the project name")) {
            return this.memoryMarker ?? "unknown";
        }
        if (lower.includes("stop"))
            return "Stopped.";
        return "Hello world";
    }
    async applyReadToolSideEffect(toolInput) {
        const p = typeof toolInput.path === "string" ? toolInput.path : "/etc/hosts";
        try {
            readFileSync(p, "utf8");
        }
        catch {
            // ignore - tests only assert tool call presence
        }
    }
    async applyBashRemovalSideEffect(fileName) {
        const dest = path.join(this.config.cwd ?? process.cwd(), fileName);
        try {
            rmSync(dest, { force: true });
        }
        catch {
            // ignore
        }
    }
    async applyBashSleepSideEffect() {
        const interrupt = this.interruptSignal.promise.then(() => "interrupted");
        const completed = new Promise((resolve) => setTimeout(() => resolve("completed"), 250));
        return await Promise.race([interrupt, completed]);
    }
    async applyBashAbortableWriteSideEffect(fileName) {
        const dest = path.join(this.config.cwd ?? process.cwd(), fileName);
        let interrupted = false;
        const interrupt = this.interruptSignal.promise.then(() => {
            interrupted = true;
            return;
        });
        await Promise.race([interrupt, new Promise((r) => setTimeout(r, 500))]);
        if (!interrupted) {
            writeFileSync(dest, "ok");
        }
    }
    applyBashPrintfRedirectSideEffect(command, lower) {
        if (!(lower.includes("printf") && lower.includes(">") && lower.includes(".txt"))) {
            return;
        }
        const destMatch = />\s*([^\s`]+)\s*$/i.exec(command) ?? />\s*([^\s`]+)/i.exec(lower);
        const fileName = destMatch?.[1];
        if (!fileName) {
            return;
        }
        const dest = path.join(this.config.cwd ?? process.cwd(), fileName);
        writeFileSync(dest, "ok");
    }
    async applyBashSpecialCommandSideEffect(lower, command) {
        if (lower.includes("rm -f permission.txt") || command.includes("rm -f permission.txt")) {
            await this.applyBashRemovalSideEffect("permission.txt");
            return "handled";
        }
        if (lower.includes("rm -f mcp-smoke.txt") || command.includes("rm -f mcp-smoke.txt")) {
            await this.applyBashRemovalSideEffect("mcp-smoke.txt");
            return "handled";
        }
        if (lower.includes("printf") && lower.includes("permission.txt")) {
            const dest = path.join(this.config.cwd ?? process.cwd(), "permission.txt");
            writeFileSync(dest, "ok");
            return "handled";
        }
        return "not-handled";
    }
    async applyBashSideEffect(toolInput, prompt, createFileMatch) {
        const lower = prompt.toLowerCase();
        const command = typeof toolInput.command === "string" ? toolInput.command : "";
        if (createFileMatch) {
            const fileName = createFileMatch[1] ?? "test.txt";
            const content = createFileMatch[2] ?? "";
            const dest = path.join(this.config.cwd ?? process.cwd(), fileName);
            writeFileSync(dest, content);
            return;
        }
        const special = await this.applyBashSpecialCommandSideEffect(lower, command);
        if (special === "handled") {
            return;
        }
        if (command.includes("sleep")) {
            const outcome = await this.applyBashSleepSideEffect();
            if (outcome === "interrupted") {
                return;
            }
        }
        if (lower.includes("abort-test-file.txt")) {
            await this.applyBashAbortableWriteSideEffect("abort-test-file.txt");
            return;
        }
        this.applyBashPrintfRedirectSideEffect(command, lower);
    }
    async applyEditSideEffect(prompt) {
        const lowerPrompt = prompt.toLowerCase();
        const match = /edit the file\s+([^\s]+)\s+and change/i.exec(prompt);
        const filePath = match?.[1] ?? (lowerPrompt.includes("tool-create.txt") ? "tool-create.txt" : null);
        if (!filePath) {
            return;
        }
        try {
            const resolved = path.isAbsolute(filePath)
                ? filePath
                : path.join(this.config.cwd ?? process.cwd(), filePath);
            const before = readFileSync(resolved, "utf8");
            let after = before.replace(/hello/g, "goodbye");
            if (lowerPrompt.includes("alpha") && lowerPrompt.includes("beta")) {
                after = after.replace(/alpha/g, "beta");
            }
            writeFileSync(resolved, after);
        }
        catch {
            // ignore
        }
    }
    async applyToolSideEffects(toolName, toolInput, prompt) {
        const createFileMatch = /create a file named\s+"([^"]+)"\s+with the content\s+"([^"]*)"/i.exec(prompt) ??
            /create a file named\s+"([^"]+)"\s+with the content\s+'([^']*)'/i.exec(prompt);
        if (toolName === "Read" || toolName === "read_file") {
            await this.applyReadToolSideEffect(toolInput);
            return;
        }
        if (toolName === "Bash" || toolName === "shell") {
            await this.applyBashSideEffect(toolInput, prompt, createFileMatch);
            return;
        }
        if (toolName === "Edit" || toolName === "apply_patch") {
            await this.applyEditSideEffect(prompt);
        }
    }
    needsPermissionForTool(toolName, toolInput) {
        const mode = (this.config.modeId ?? "").toLowerCase();
        const policy = typeof this.config.providerOptions?.approval_policy === "string"
            ? this.config.providerOptions.approval_policy.toLowerCase()
            : "";
        if (policy === "never" || mode.includes("bypass") || mode.includes("full")) {
            return false;
        }
        if (isLikelyExternalToolName(toolName)) {
            return true;
        }
        // In "auto" we only require permission for writes/edits; simple commands like sleep are allowed.
        if (mode.includes("auto")) {
            if (toolName === "Edit" || toolName === "apply_patch") {
                return true;
            }
            if (toolName === "Bash" || toolName === "shell") {
                const cmd = typeof toolInput.command === "string" ? toolInput.command : "";
                const writes = cmd.includes(">") || cmd.includes("rm ") || cmd.includes("mv ") || cmd.includes("cp ");
                return writes;
            }
            return false;
        }
        // Default/read-only/etc: ask for everything.
        return isAskMode(this.config);
    }
}
class FakeAgentClient {
    constructor(provider, options) {
        this.provider = provider;
        this.options = options;
        this.capabilities = {
            ...TEST_CAPABILITIES,
            supportsMcpServers: options.supportsMcpServers === true,
        };
    }
    async createSession(config, _launchContext) {
        await this.options.beforeCreateSession?.();
        return new FakeAgentSession({
            providerName: this.provider,
            config: { ...config },
            supportsMcpServers: this.options.supportsMcpServers,
            closeSession: this.options.closeSession,
            onStartTurn: this.options.onStartTurn,
        });
    }
    async resumeSession(handle, overrides, _launchContext) {
        const cfg = {
            provider: this.provider,
            cwd: overrides?.cwd ?? process.cwd(),
            ...overrides,
        };
        const marker = handle.metadata?.marker ??
            handle.metadata?.conversationId ??
            null;
        return new FakeAgentSession({
            providerName: this.provider,
            config: cfg,
            supportsMcpServers: this.options.supportsMcpServers,
            sessionId: handle.sessionId,
            memoryMarker: typeof marker === "string" ? marker : null,
            closeSession: this.options.closeSession,
            onStartTurn: this.options.onStartTurn,
        });
    }
    async fetchCatalog(_options) {
        if (this.provider === "claude") {
            return {
                models: [
                    { provider: this.provider, id: "haiku", label: "Haiku", isDefault: true },
                    { provider: this.provider, id: "sonnet", label: "Sonnet", isDefault: false },
                ],
                modes: TEST_MODES,
            };
        }
        if (this.provider === "codex") {
            return {
                models: [
                    {
                        provider: this.provider,
                        id: "gpt-5.4-mini",
                        label: "gpt-5.4-mini",
                        isDefault: true,
                    },
                ],
                modes: TEST_MODES,
            };
        }
        return {
            models: [{ provider: this.provider, id: "test-model", label: "Test Model", isDefault: true }],
            modes: TEST_MODES,
        };
    }
    async isAvailable() {
        return true;
    }
}
export function createTestAgentClients(options = {}) {
    return {
        claude: new FakeAgentClient("claude", options),
        codex: new FakeAgentClient("codex", options),
        opencode: new FakeAgentClient("opencode", options),
    };
}
export function createTestAgentClient(provider, options = {}) {
    return new FakeAgentClient(provider, options);
}
//# sourceMappingURL=fake-agent-client.js.map