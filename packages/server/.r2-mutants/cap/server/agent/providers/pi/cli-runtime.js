import { createExternalProcessEnv } from "../../../paseo-env.js";
import { JSONL_RPC_NO_TIMEOUT, JsonlRpcProcess, } from "../jsonl-rpc-process.js";
import { buildPiLaunch, } from "./runtime.js";
const DEFAULT_PI_COMMAND = [
    process.env.PI_COMMAND ?? process.env.PI_ACP_PI_COMMAND ?? "pi",
];
const DEFAULT_COMMANDS_RPC_NAME = "get_commands";
export class PiCliRuntime {
    constructor(options) {
        this.options = options;
        this.command = options.command ?? DEFAULT_PI_COMMAND;
        this.commandsRpcName = options.commandsRpcName ?? DEFAULT_COMMANDS_RPC_NAME;
        this.spawnProcess = options.spawnProcess;
    }
    async startSession(input) {
        const launch = buildPiLaunch({
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
            diagnosticName: "Pi RPC",
            defaultRequestTimeoutMs: this.options.requestTimeoutMs,
            ...(spawn ? { spawn: () => spawn(launch) } : {}),
        };
        const process = new JsonlRpcProcess(processOptions);
        if (input.signal?.aborted) {
            await process.close(input.signal.reason);
            input.signal.throwIfAborted();
        }
        return new PiCliRuntimeSession(process, this.commandsRpcName, launch.env);
    }
}
class PiCliRuntimeSession {
    constructor(process, commandsRpcName, launchEnvironment) {
        this.process = process;
        this.commandsRpcName = commandsRpcName;
        this.launchEnvironment = launchEnvironment;
        this.subscribers = new Set();
        process.onMessage((message) => {
            this.emit(message);
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
        const data = await promise;
        if (typeof data === "object" && data !== null && !Array.isArray(data)) {
            const { agentInvoked } = data;
            if (typeof agentInvoked === "boolean") {
                return { requestId, agentInvoked };
            }
        }
        return { requestId };
    }
    async steer(message, images) {
        await this.request({
            type: "steer",
            message,
            ...(images?.length ? { images } : {}),
        });
    }
    async clearQueue() {
        await this.requestStopWork({ type: "clear_queue" });
    }
    async compact(customInstructions) {
        await this.waitForCompletion({
            type: "compact",
            ...(customInstructions ? { customInstructions } : {}),
        });
    }
    async setAutoCompaction(enabled) {
        await this.request({ type: "set_auto_compaction", enabled });
    }
    async abort() {
        await this.requestStopWork({ type: "abort" });
    }
    async getState() {
        return (await this.request({ type: "get_state" }));
    }
    async getMessages() {
        const data = (await this.request({ type: "get_messages" }));
        return data.messages ?? [];
    }
    async getAvailableModels(timeoutMs) {
        const data = (await this.request({ type: "get_available_models" }, timeoutMs));
        return data.models ?? [];
    }
    async setModel(provider, modelId) {
        return (await this.request({ type: "set_model", provider, modelId }));
    }
    async setThinkingLevel(level) {
        await this.request({ type: "set_thinking_level", level: level });
    }
    async getSessionStats() {
        // COMPAT(piGetStateFallback): added in v0.1.105 — older Oh My Pi binaries
        // lack the `get_session_stats` RPC command; fall back to extracting
        // context window usage from `get_state`. Remove after 2027-01-10 once the
        // supported Oh My Pi floor includes `get_session_stats`.
        let stats;
        try {
            stats = (await this.request({ type: "get_session_stats" }));
        }
        catch {
            // get_session_stats not supported by this binary — will try get_state below
        }
        if (stats?.tokens == null && stats?.cost == null && stats?.contextUsage == null) {
            try {
                const state = (await this.request({ type: "get_state" }));
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
        const data = (await this.request({ type: this.commandsRpcName }));
        return data.commands ?? [];
    }
    sendRawFrame(frame) {
        this.process.send(frame);
    }
    respondToExtensionUiRequest(id, response) {
        this.process.send({ type: "extension_ui_response", id, ...response });
    }
    cancelExtensionUiRequest(id) {
        this.respondToExtensionUiRequest(id, { cancelled: true });
    }
    async close() {
        await this.process.close(new Error("Pi RPC session is closed"));
    }
    request(command, timeoutMs) {
        return this.process.request(command, timeoutMs);
    }
    requestStopWork(command) {
        return this.process.requestStopWork(command);
    }
    async waitForCompletion(command) {
        // Pi only replies after its compaction work is durable. Its child process and
        // session close paths already reject pending RPCs, so no elapsed-time failure
        // is useful here.
        await this.process.request(command, JSONL_RPC_NO_TIMEOUT);
    }
    emit(event) {
        for (const subscriber of this.subscribers) {
            subscriber(event);
        }
    }
}
//# sourceMappingURL=cli-runtime.js.map