import { createOpencodeClient, } from "@opencode-ai/sdk/v2/client";
const FIRST_RECORD_WATCHDOG_MS = 5000;
const WATCHDOG_MS = 30000;
const MAX_BACKOFF_MS = 5000;
const FAILURE_WARNING_ATTEMPT = 4;
const systemTiming = {
    arm(delayMs, callback) {
        const handle = setTimeout(callback, delayMs);
        return () => clearTimeout(handle);
    },
    wait(delayMs, signal) {
        if (signal.aborted)
            return Promise.reject(signal.reason);
        return new Promise((resolve, reject) => {
            const handle = setTimeout(() => {
                signal.removeEventListener("abort", onAbort);
                resolve();
            }, delayMs);
            const onAbort = () => {
                clearTimeout(handle);
                reject(signal.reason);
            };
            signal.addEventListener("abort", onAbort, { once: true });
        });
    },
};
export class OpenCodeEventConsumer {
    constructor(options) {
        this.listeners = new Set();
        this.startedAt = Date.now();
        this.connectionAbort = new AbortController();
        this.attempt = 0;
        this.phase = "first-record";
        this.connected = false;
        this.closed = false;
        this.client =
            options.createClient?.(options.serverUrl) ??
                createOpencodeClient({ baseUrl: options.serverUrl });
        this.logger = options.logger;
        this.timing = options.timing ?? systemTiming;
        this.readyPromise = new Promise((resolve, reject) => {
            this.resolveReady = resolve;
            this.rejectReady = reject;
        });
        void this.readyPromise.catch(() => undefined);
        this.connectionTask = this.consume(options.processExit, options.listening);
        void this.connectionTask.catch(() => undefined);
    }
    ready() {
        return this.readyPromise;
    }
    subscribe(listener) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }
    diagnostics() {
        return {
            attempt: this.attempt,
            phase: this.phase,
            elapsedMs: Date.now() - this.startedAt,
            ...(this.lastOutcome === undefined ? {} : { lastOutcome: this.lastOutcome }),
            ...(this.lastError === undefined ? {} : { lastError: this.lastError }),
        };
    }
    async close() {
        if (this.closed)
            return;
        this.closed = true;
        this.listeners.clear();
        const error = new Error("OpenCode event source closed");
        this.rejectReady(error);
        this.connectionAbort.abort(error);
        await this.connectionTask.catch(() => undefined);
    }
    async consume(processExit, listening) {
        void processExit.then((error) => this.exit(error));
        if (listening) {
            const signal = this.connectionAbort.signal;
            let stopWaiting;
            const stopped = new Promise((resolve) => {
                stopWaiting = resolve;
            });
            signal.addEventListener("abort", stopWaiting, { once: true });
            try {
                await Promise.race([listening, stopped]);
            }
            catch {
                return;
            }
            finally {
                signal.removeEventListener("abort", stopWaiting);
            }
        }
        let reconnectAttempt = 0;
        while (!this.closed) {
            this.attempt += 1;
            this.phase = "first-record";
            const result = await this.consumeConnection(this.connectionAbort.signal);
            if (this.closed)
                return;
            this.lastOutcome = result.outcome;
            this.lastError = result.error === undefined ? undefined : errorMessage(result.error);
            reconnectAttempt = result.delivered ? 0 : reconnectAttempt + 1;
            const delayMs = Math.min(100 * 2 ** Math.max(0, reconnectAttempt - 1), MAX_BACKOFF_MS);
            this.logConnectionFailure(result, this.attempt, reconnectAttempt, delayMs);
            await this.timing.wait(delayMs, this.connectionAbort.signal).catch(() => undefined);
        }
    }
    async consumeConnection(signal) {
        const requestAbort = new AbortController();
        const attemptToken = { active: true };
        let resolveAbandoned;
        const abandoned = new Promise((resolve) => {
            resolveAbandoned = resolve;
        });
        const abortRequest = () => {
            attemptToken.active = false;
            resolveAbandoned({ delivered, phase, outcome: "ended" });
            requestAbort.abort(signal.reason);
        };
        signal.addEventListener("abort", abortRequest, { once: true });
        let cancelWatchdog = () => undefined;
        let delivered = false;
        let phase = "first-record";
        let sseError;
        const armWatchdog = () => {
            cancelWatchdog();
            cancelWatchdog = this.timing.arm(this.connected ? WATCHDOG_MS : FIRST_RECORD_WATCHDOG_MS, () => {
                const error = new Error(`OpenCode event stream ${phase} watchdog expired`);
                // Abandon a stalled request even when fetch ignores abort, for example during OpenCode startup.
                attemptToken.active = false;
                resolveAbandoned({ delivered, phase, outcome: "watchdog", error });
                requestAbort.abort(error);
            });
        };
        const consumeStream = async () => {
            try {
                const result = await this.client.global.event({
                    signal: requestAbort.signal,
                    sseMaxRetryAttempts: 0,
                    onSseError: (error) => {
                        sseError = error;
                    },
                });
                for await (const event of result.stream) {
                    // Ignore late records from abandoned requests, for example a delayed server.connected event.
                    if (this.closed || !attemptToken.active) {
                        return { delivered, phase, outcome: "ended" };
                    }
                    delivered = true;
                    phase = "stream";
                    this.phase = phase;
                    if (!this.connected && event.payload.type === "server.connected") {
                        this.connected = true;
                        this.resolveReady();
                        armWatchdog();
                        continue;
                    }
                    armWatchdog();
                    this.logPluginFailure(event);
                    this.publish(event);
                }
                let outcome = "ended";
                if (sseError !== undefined)
                    outcome = "error";
                return {
                    delivered,
                    phase,
                    outcome,
                    ...(sseError === undefined ? {} : { error: sseError }),
                };
            }
            catch (error) {
                return {
                    delivered,
                    phase,
                    outcome: "error",
                    error,
                };
            }
        };
        armWatchdog();
        try {
            return await Promise.race([consumeStream(), abandoned]);
        }
        finally {
            attemptToken.active = false;
            cancelWatchdog();
            signal.removeEventListener("abort", abortRequest);
            requestAbort.abort();
        }
    }
    logPluginFailure(event) {
        if (event.payload.type !== "session.error")
            return;
        const error = event.payload.properties.error;
        if (!containsPluginError(error))
            return;
        this.logger.warn({
            directory: event.directory,
            sessionId: event.payload.properties.sessionID,
            error,
        }, "OpenCode plugin failed");
    }
    logConnectionFailure(result, attempt, consecutiveFailures, retryDelayMs) {
        const elapsedMs = Date.now() - this.startedAt;
        const details = {
            ...(result.error === undefined ? {} : { err: result.error }),
            phase: result.phase,
            outcome: result.outcome,
            attempt,
            consecutiveFailures,
            elapsedMs,
            retryDelayMs,
            everReady: this.connected,
        };
        const log = result.outcome === "watchdog" ||
            this.connected ||
            consecutiveFailures >= FAILURE_WARNING_ATTEMPT
            ? this.logger.warn.bind(this.logger)
            : this.logger.debug.bind(this.logger);
        log(details, "OpenCode event stream connection failed; retrying");
    }
    exit(error) {
        if (this.closed)
            return;
        this.closed = true;
        this.connectionAbort.abort(error);
        if (!this.connected)
            this.rejectReady(error);
        this.publish({ type: "server-exited", error });
        this.listeners.clear();
    }
    publish(input) {
        for (const listener of this.listeners) {
            try {
                listener(input);
            }
            catch {
                // A session callback cannot tear down the generation-owned transport.
            }
        }
    }
}
function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}
function containsPluginError(error) {
    try {
        return JSON.stringify(error).toLowerCase().includes("plugin");
    }
    catch {
        return false;
    }
}
//# sourceMappingURL=event-consumer.js.map