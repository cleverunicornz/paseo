import { spawnProcess } from "../../../utils/spawn.js";
import { terminateWithTreeKill } from "../../../utils/tree-kill.js";
import { JsonlFrameDecoder } from "./jsonl-frame-decoder.js";
export { supportsJsonlRpcProtocolV2 } from "./jsonl-frame-decoder.js";
/** Default wall-clock timeout for control-plane / short RPC calls. */
export const JSONL_RPC_DEFAULT_TIMEOUT_MS = 30000;
/**
 * Pass as `timeoutMs` to wait only for a response, process death, or `close()`.
 * Use for long-running blocking RPCs (e.g. LLM-backed compact).
 */
export const JSONL_RPC_NO_TIMEOUT = null;
const STDERR_BUFFER_LIMIT = 8192;
const GRACEFUL_SHUTDOWN_TIMEOUT_MS = 2000;
const FORCE_SHUTDOWN_TIMEOUT_MS = 1000;
function assertChildWithPipes(child) {
    if (!child.stdin || !child.stdout || !child.stderr) {
        throw new Error("JSONL RPC process was spawned without stdio streams");
    }
}
function spawnJsonlRpcProcess(launch) {
    const child = spawnProcess(launch.command, launch.args, {
        cwd: launch.cwd,
        envOverlay: launch.env,
        stdio: ["pipe", "pipe", "pipe"],
    });
    assertChildWithPipes(child);
    return child;
}
export class JsonlRpcProcess {
    constructor(options) {
        this.options = options;
        this.pending = new Map();
        this.messageSubscribers = new Set();
        this.exitSubscribers = new Set();
        this.stderrBuffer = "";
        this.nextRequestId = 1;
        this.disposed = false;
        this.exited = false;
        this.closing = null;
        this.diagnosticName = options.diagnosticName ?? "JSONL RPC";
        this.frameDecoder = new JsonlFrameDecoder({
            frame: (message) => this.dispatchFrame(message),
            problem: (problem, detail) => {
                this.options.logger.warn({ problem, detail }, `Ignoring invalid ${this.diagnosticName} frame`);
            },
        });
        this.child = (options.spawn ?? spawnJsonlRpcProcess)(options.launch);
        this.child.stdout.on("data", (chunk) => {
            this.handleStdoutChunk(chunk.toString());
        });
        this.child.stderr.on("data", (chunk) => {
            this.stderrBuffer += chunk.toString();
            if (this.stderrBuffer.length > STDERR_BUFFER_LIMIT) {
                this.stderrBuffer = this.stderrBuffer.slice(-STDERR_BUFFER_LIMIT);
            }
        });
        this.child.stdin.on("error", (error) => {
            this.handleStdinError(error);
        });
        this.child.on("error", (error) => {
            this.failAll(error instanceof Error ? error : new Error(String(error)));
        });
        this.child.on("exit", (code, signal) => {
            this.exited = true;
            const error = new Error(`${this.diagnosticName} process exited with code ${code ?? "null"} and signal ${signal ?? "null"}\n${this.stderrBuffer}`.trim());
            const exit = { code, signal, error };
            for (const subscriber of this.exitSubscribers) {
                subscriber(exit);
            }
            this.failAll(error);
        });
    }
    onMessage(callback) {
        this.messageSubscribers.add(callback);
        return () => {
            this.messageSubscribers.delete(callback);
        };
    }
    onExit(callback) {
        this.exitSubscribers.add(callback);
        return () => {
            this.exitSubscribers.delete(callback);
        };
    }
    startRequest(command, timeoutMs) {
        if (this.disposed) {
            return {
                id: "",
                promise: Promise.reject(new Error(`${this.diagnosticName} process is closed`)),
            };
        }
        const id = `req_${this.nextRequestId}`;
        this.nextRequestId += 1;
        const requestTimeoutMs = timeoutMs === undefined
            ? (this.options.defaultRequestTimeoutMs ?? JSONL_RPC_DEFAULT_TIMEOUT_MS)
            : timeoutMs;
        const startedAt = Date.now();
        const promise = new Promise((resolve, reject) => {
            const timer = createRequestTimeout(requestTimeoutMs, () => {
                this.pending.delete(id);
                reject(new Error(`${this.diagnosticName} request timed out phase=${command.type} elapsedMs=${Date.now() - startedAt} timeoutMs=${requestTimeoutMs}\n${this.stderrBuffer}`.trim()));
            });
            this.pending.set(id, { resolve, reject, timer });
            this.send({ ...command, id });
        });
        return { id, promise };
    }
    request(command, timeoutMs) {
        return this.startRequest(command, timeoutMs).promise;
    }
    /**
     * Send a command whose goal an exited process has already met — stopping a turn,
     * clearing a queue. Resolves once the child has exited instead of rejecting,
     * because nothing is queued and nothing is running, which is what the caller
     * asked for. Use `request` when the caller needs an answer from a live process.
     *
     * Keyed on an observed exit rather than on `disposed`: `close()` disposes the
     * transport before termination completes, and a child that outlives SIGKILL can
     * still be working, so a disposed transport is not proof the work stopped.
     */
    async requestStopWork(command, timeoutMs) {
        if (this.exited) {
            return;
        }
        try {
            await this.request(command, timeoutMs);
        }
        catch (error) {
            // A dying child breaks its stdin pipe a fraction before it emits `exit`, which
            // fails this request and starts a termination. Wait for that termination to reach
            // an answer rather than refusing a stop the runtime went on to honor.
            await this.closing?.catch(() => undefined);
            if (!this.exited) {
                throw error;
            }
        }
    }
    send(message) {
        if (this.disposed) {
            return;
        }
        if (this.child.stdin.destroyed || !this.child.stdin.writable) {
            this.handleStdinError(new Error(`${this.diagnosticName} stdin is not writable`));
            return;
        }
        try {
            this.child.stdin.write(`${JSON.stringify(message)}\n`);
        }
        catch (error) {
            this.handleStdinError(error);
        }
    }
    async close(error = new Error(`${this.diagnosticName} process is closed`)) {
        if (this.disposed)
            return;
        this.failAll(error);
        this.closing = this.terminate();
        await this.closing;
    }
    async terminate() {
        try {
            this.child.stdin.end();
        }
        catch {
            // Ignore cleanup races.
        }
        const result = await terminateWithTreeKill(this.child, {
            gracefulTimeoutMs: GRACEFUL_SHUTDOWN_TIMEOUT_MS,
            forceTimeoutMs: FORCE_SHUTDOWN_TIMEOUT_MS,
            onForceSignal: () => {
                this.options.logger.warn({ timeoutMs: GRACEFUL_SHUTDOWN_TIMEOUT_MS }, `${this.diagnosticName} process did not exit after SIGTERM; sending SIGKILL`);
            },
        });
        if (result === "kill-timeout") {
            this.options.logger.warn({ timeoutMs: FORCE_SHUTDOWN_TIMEOUT_MS }, `${this.diagnosticName} process did not report exit after SIGKILL`);
        }
    }
    handleStdoutChunk(chunk) {
        this.frameDecoder.write(chunk);
    }
    /** Route a complete logical frame to its consumer (pending request or subscriber). */
    dispatchFrame(message) {
        const pending = message.type === "response" && typeof message.id === "string"
            ? this.pending.get(message.id)
            : undefined;
        if (pending) {
            this.settleRequest(pending, message);
            return;
        }
        // A response nothing is waiting for is published like any other frame, so a provider
        // can read it as an event, such as OMP 18.3 rejecting a prompt after acknowledging it.
        for (const subscriber of this.messageSubscribers) {
            subscriber(message);
        }
    }
    settleRequest(pending, response) {
        if (pending.timer) {
            clearTimeout(pending.timer);
        }
        this.pending.delete(response.id);
        if (!response.success) {
            pending.reject(new Error(response.error ?? `${this.diagnosticName} ${response.command ?? "request"} failed`));
            return;
        }
        pending.resolve(response.data);
    }
    handleStdinError(error) {
        if (this.disposed) {
            return;
        }
        const err = error instanceof Error ? error : new Error(String(error));
        this.options.logger.warn({ err }, `${this.diagnosticName} stdin write failed`);
        void this.close(err);
    }
    failAll(error) {
        if (this.disposed) {
            return;
        }
        this.disposed = true;
        for (const pending of this.pending.values()) {
            if (pending.timer) {
                clearTimeout(pending.timer);
            }
            pending.reject(error);
        }
        this.pending.clear();
    }
}
/**
 * Schedule a request timeout, or return null when the call should wait
 * indefinitely for a response, process exit, or close().
 */
function createRequestTimeout(timeoutMs, onTimeout) {
    if (timeoutMs == null || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
        return null;
    }
    return setTimeout(onTimeout, timeoutMs);
}
//# sourceMappingURL=jsonl-rpc-process.js.map