import { createExternalProcessEnv } from "../../../paseo-env.js";
import { z } from "zod";
import { JSONL_RPC_NO_TIMEOUT, JsonlRpcProcess, } from "../jsonl-rpc-process.js";
import { establishOmpProtocol } from "./protocol-session.js";
import { buildOmpLaunch, } from "./runtime.js";
import { OmpBranchMessagesResultSchema, OmpBranchResultSchema, OmpCommandsResultSchema, OmpHostToolsResultSchema, OmpMessagesResultSchema, OmpModelSchema, OmpModelsResultSchema, OmpPromptAckSchema, OmpRpcCommandSchema, parseOmpRuntimeEvent, OmpSessionStateSchema, OmpSessionStatsSchema, } from "./rpc-types.js";
const DEFAULT_OMP_COMMAND = [process.env.OMP_COMMAND ?? "omp"];
const DEFAULT_COMMANDS_RPC_NAME = "get_available_commands";
export class OmpCliRuntime {
    constructor(options) {
        this.options = options;
        this.command = options.command ?? DEFAULT_OMP_COMMAND;
        this.commandsRpcName = options.commandsRpcName ?? DEFAULT_COMMANDS_RPC_NAME;
        this.spawnProcess = options.spawnProcess;
    }
    async startSession(input) {
        const launch = buildOmpLaunch({
            command: this.command,
            runtimeSettings: this.options.runtimeSettings,
            session: input,
        });
        launch.env = createExternalProcessEnv(globalThis.process.env, launch.env ?? {});
        const [command, ...args] = launch.argv;
        const processLaunch = {
            command,
            args,
            cwd: launch.cwd,
            env: launch.env,
        };
        const spawn = this.spawnProcess;
        const processOptions = {
            launch: processLaunch,
            logger: this.options.logger,
            diagnosticName: "OMP RPC",
            defaultRequestTimeoutMs: this.options.requestTimeoutMs,
            ...(spawn ? { spawn: () => spawn(launch) } : {}),
        };
        const process = new JsonlRpcProcess(processOptions);
        const handleAbort = () => void process.close(input.signal?.reason).catch(() => undefined);
        input.signal?.addEventListener("abort", handleAbort, { once: true });
        try {
            await establishOmpProtocol(process, this.options.logger, {
                readyTimeoutMs: this.options.readyTimeoutMs,
                requestTimeoutMs: this.options.requestTimeoutMs,
            });
            input.signal?.throwIfAborted();
            return new OmpCliRuntimeSession(process, this.commandsRpcName, launch.env);
        }
        catch (error) {
            const startupError = error instanceof Error ? error : new Error(String(error));
            await process.close(startupError);
            throw startupError;
        }
        finally {
            input.signal?.removeEventListener("abort", handleAbort);
        }
    }
}
class OmpCliRuntimeSession {
    constructor(process, commandsRpcName, launchEnvironment) {
        this.process = process;
        this.commandsRpcName = commandsRpcName;
        this.launchEnvironment = launchEnvironment;
        this.subscribers = new Set();
        process.onMessage((message) => {
            const event = parseOmpRuntimeEvent(message);
            if (event) {
                this.emit(event);
            }
        });
        process.onExit(({ error }) => {
            this.emit({ type: "process_exit", error: error.message });
        });
    }
    get environment() {
        return this.launchEnvironment;
    }
    onEvent(callback) {
        this.subscribers.add(callback);
        return () => {
            this.subscribers.delete(callback);
        };
    }
    async prompt(message, images) {
        const { id: requestId, promise } = this.process.startRequest({
            type: "prompt",
            message,
            ...(images?.length ? { images } : {}),
        });
        const ack = OmpPromptAckSchema.parse(await promise) ?? {};
        return { requestId, ...ack };
    }
    async compact(customInstructions) {
        await this.request({
            type: "compact",
            ...(customInstructions ? { customInstructions } : {}),
        }, JSONL_RPC_NO_TIMEOUT);
    }
    async setAutoCompaction(enabled) {
        await this.request({ type: "set_auto_compaction", enabled });
    }
    async abort() {
        await this.requestStopWork({ type: "abort" });
    }
    async getState() {
        return OmpSessionStateSchema.parse(await this.request({ type: "get_state" }));
    }
    async setFastMode(enabled) {
        const result = await this.request({ type: "set_fast_mode", enabled });
        return z.object({ enabled: z.boolean(), active: z.boolean() }).parse(result);
    }
    async getMessages() {
        const data = OmpMessagesResultSchema.parse(await this.request({ type: "get_messages" }));
        return data.messages ?? [];
    }
    async getAvailableModels(timeoutMs) {
        const data = OmpModelsResultSchema.parse(await this.request({ type: "get_available_models" }, timeoutMs));
        return data.models ?? [];
    }
    async setModel(provider, modelId) {
        return OmpModelSchema.parse(await this.request({ type: "set_model", provider, modelId }));
    }
    async setThinkingLevel(level) {
        await this.request({ type: "set_thinking_level", level });
    }
    async getSessionStats() {
        // COMPAT(ompGetStateFallback): added in v0.1.105 — older OMP binaries
        // lack the `get_session_stats` RPC command; fall back to extracting
        // context window usage from `get_state`. Remove after 2027-01-10 once the
        // supported OMP floor includes `get_session_stats`.
        let stats;
        try {
            stats = OmpSessionStatsSchema.parse(await this.request({ type: "get_session_stats" }));
        }
        catch {
            // get_session_stats not supported by this binary — will try get_state below
        }
        if (stats?.tokens == null && stats?.cost == null && stats?.contextUsage == null) {
            try {
                const state = OmpSessionStateSchema.parse(await this.request({ type: "get_state" }));
                const ctx = state.contextUsage;
                if (ctx) {
                    return {
                        contextUsage: {
                            tokens: typeof ctx.tokens === "number" ? ctx.tokens : undefined,
                            contextWindow: typeof ctx.contextWindow === "number" ? ctx.contextWindow : undefined,
                        },
                    };
                }
            }
            catch {
                // get_state also failed — nothing we can do
            }
        }
        return stats ?? {};
    }
    async getCommands() {
        const data = OmpCommandsResultSchema.parse(await this.request({ type: this.commandsRpcName }));
        return data.commands ?? [];
    }
    async setSubagentSubscription(level) {
        await this.request({ type: "set_subagent_subscription", level });
    }
    async setHostTools(tools) {
        const data = OmpHostToolsResultSchema.parse(await this.request({ type: "set_host_tools", tools }));
        return data.toolNames ?? [];
    }
    sendHostToolResult(result) {
        this.process.send({ ...result });
    }
    sendHostToolUpdate(update) {
        this.process.send({ ...update });
    }
    async branch(entryId) {
        const data = OmpBranchResultSchema.parse(await this.request({ type: "branch", entryId }));
        if (data.cancelled === true) {
            throw new Error("OMP branch was cancelled");
        }
        if (typeof data.text !== "string") {
            throw new Error("OMP branch response did not include restored prompt text");
        }
        this.activeBranchEntryId = entryId;
        return { text: data.text };
    }
    async getBranchMessages() {
        const data = OmpBranchMessagesResultSchema.parse(await this.request({ type: "get_branch_messages" }));
        return data.messages ?? [];
    }
    async steer(message, images) {
        await this.request({ type: "steer", message, ...(images?.length ? { images } : {}) });
    }
    followUp(message, images) {
        this.process.send({ type: "follow_up", message, ...(images?.length ? { images } : {}) });
    }
    async handoff(customInstructions) {
        await this.request({
            type: "handoff",
            ...(customInstructions ? { customInstructions } : {}),
        });
    }
    respondToExtensionUiRequest(id, response) {
        this.process.send({ type: "extension_ui_response", id, ...response });
    }
    cancelExtensionUiRequest(id) {
        this.respondToExtensionUiRequest(id, { cancelled: true });
    }
    async close() {
        await this.process.close(new Error("OMP RPC session is closed"));
    }
    request(command, timeoutMs) {
        return this.process.request(OmpRpcCommandSchema.parse(command), timeoutMs);
    }
    requestStopWork(command) {
        return this.process.requestStopWork(OmpRpcCommandSchema.parse(command));
    }
    emit(event) {
        for (const subscriber of this.subscribers) {
            subscriber(event);
        }
    }
}
//# sourceMappingURL=cli-runtime.js.map