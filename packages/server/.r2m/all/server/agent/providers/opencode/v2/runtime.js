import { decorateOpenCodeV2Env, materializeOpenCodeV2Plugin } from "../bridge.js";
import { resolvePaseoHome } from "../../../../paseo-home.js";
import { OpenCode } from "@opencode/client";
import { randomBytes } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { spawnProcess } from "../../../../../utils/spawn.js";
import { terminateWithTreeKill } from "../../../../../utils/tree-kill.js";
import { createProviderEnvSpec, resolveProviderLaunch, } from "../../../provider-launch-config.js";
import { resolveOpenCodeHomeDir } from "../paths.js";
import { OpenCodeHttpError } from "../http-error.js";
import { raceProviderRefreshAbort } from "../../../provider-refresh-deadline.js";
// The runtime owns a credential for each subprocess; sessions only receive its authenticated client.
export class V2Runtime {
    constructor(options) {
        this.options = options;
        this.current = null;
        this.generations = new Set();
        this.starts = new Set();
        this.closed = false;
    }
    async acquire(input = {}) {
        if (this.closed)
            throw new Error("OpenCode runtime is closed");
        input.signal?.throwIfAborted();
        let pending;
        if (input.env || input.dedicated) {
            pending = this.startTracked(input.env);
        }
        else {
            if (input.fresh || !this.current)
                this.current = this.startTracked();
            pending = this.current;
        }
        let generation;
        try {
            generation = await raceProviderRefreshAbort(input.signal, pending);
        }
        catch (error) {
            if (this.current === pending)
                this.current = null;
            if (input.signal?.aborted) {
                void pending
                    .then(async (started) => {
                    if (started.users !== 0)
                        return undefined;
                    this.generations.delete(started);
                    await started.stop();
                    return undefined;
                })
                    .catch((cleanupError) => {
                    this.options.logger.warn({ error: String(cleanupError) }, "OpenCode canceled startup cleanup failed");
                });
            }
            throw error;
        }
        if (!this.generations.has(generation)) {
            if (this.current === pending)
                this.current = null;
            throw new Error("OpenCode helper server exited");
        }
        const connection = this.lease(generation, pending);
        if (input.signal?.aborted || this.closed) {
            await connection.release();
            input.signal?.throwIfAborted();
            throw new Error("OpenCode runtime is closed");
        }
        return connection;
    }
    lease(generation, pending) {
        if (this.closed || !this.generations.has(generation))
            throw new Error("OpenCode helper server is no longer running");
        generation.users += 1;
        let released = false;
        const release = async () => {
            if (released)
                return;
            released = true;
            generation.users -= 1;
            if (generation.users !== 0)
                return;
            if (this.current === pending)
                this.current = null;
            this.generations.delete(generation);
            await generation.stop();
        };
        return {
            client: generation.client,
            release,
            retain: () => this.lease(generation, pending),
            exited: generation.exited,
        };
    }
    async shutdown() {
        this.closed = true;
        await Promise.allSettled(this.starts);
        await Promise.all([...this.generations].map((generation) => generation.stop()));
        this.generations.clear();
        this.current = null;
    }
    startTracked(env) {
        const pending = this.start(env);
        this.starts.add(pending);
        void pending.then((generation) => generation.exited.then(() => {
            if (this.current === pending)
                this.current = null;
            return undefined;
        }), () => undefined);
        void pending.then(() => this.starts.delete(pending), () => this.starts.delete(pending));
        return pending;
    }
    async start(env = {}) {
        const { settings, managedProcesses, logger } = this.options;
        const launch = await resolveProviderLaunch({
            commandConfig: settings?.command,
            defaultBinary: "opencode",
        });
        const cwd = resolveOpenCodeHomeDir();
        await mkdir(cwd, { recursive: true });
        const password = randomBytes(32).toString("base64url");
        const inheritedConfig = globalThis.process.env.OPENCODE_CONFIG_CONTENT;
        const configured = {
            ...(inheritedConfig ? { OPENCODE_CONFIG_CONTENT: inheritedConfig } : {}),
            ...settings?.env,
            ...env,
        };
        const decorated = this.options.decorateEnv
            ? await this.options.decorateEnv(configured)
            : decorateOpenCodeV2Env(configured, await materializeOpenCodeV2Plugin(resolvePaseoHome()));
        const args = [...launch.args, "serve", "--hostname", "127.0.0.1", "--port", "0"];
        const process = spawnProcess(launch.command, args, {
            cwd,
            detached: globalThis.process.platform !== "win32",
            stdio: ["ignore", "pipe", "pipe"],
            ...createProviderEnvSpec({
                runtimeSettings: settings,
                overlays: [{ ...decorated, OPENCODE_PASSWORD: password }],
            }),
        });
        const processAbort = new AbortController();
        const exited = new Promise((resolve) => process.once("exit", (code) => {
            const error = new Error(`OpenCode helper server exited (${code})`);
            processAbort.abort(error);
            resolve(error);
        }));
        let stopped;
        const record = process.pid && managedProcesses
            ? managedProcesses
                .record({
                owner: { provider: "opencode", kind: "helper-server" },
                pid: process.pid,
                command: launch.command,
                args,
            })
                .catch((error) => {
                logger.warn({ error }, "Could not record OpenCode helper process");
                return null;
            })
            : Promise.resolve(null);
        const stop = () => {
            stopped ?? (stopped = (async () => {
                await terminateWithTreeKill(process, { gracefulTimeoutMs: 5000, forceTimeoutMs: 1000 });
                const entry = await record;
                if (entry)
                    await managedProcesses?.remove(entry.id);
            })());
            return stopped;
        };
        const deadline = Date.now() + 30000;
        try {
            const url = await new Promise((resolve, reject) => {
                const timer = setTimeout(() => finish(new Error("OpenCode v2 server startup timed out after 30s")), 30000);
                let buffer = "";
                const finish = (result) => {
                    clearTimeout(timer);
                    process.stdout?.off("data", onData);
                    process.off("error", onError);
                    process.off("exit", onExit);
                    if (result instanceof Error)
                        reject(result);
                    else
                        resolve(result);
                };
                const onData = (chunk) => {
                    buffer = (buffer + chunk.toString()).slice(-8192);
                    const match = buffer.match(/server listening on (http:\/\/127\.0\.0\.1:\d+)(?:\r?\n)/);
                    if (match)
                        finish(match[1]);
                };
                const onError = (error) => finish(error);
                const onExit = (code) => finish(new Error(`OpenCode v2 server exited during startup (${code})`));
                process.stdout?.on("data", onData);
                process.once("error", onError);
                process.once("exit", onExit);
                // Drain stderr without retaining provider output that may contain credentials.
                process.stderr?.on("data", () => undefined);
            });
            const client = OpenCode.make({
                baseUrl: url,
                headers: {
                    Authorization: `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`,
                },
                fetch: async (request, init) => {
                    const signal = init?.signal
                        ? AbortSignal.any([init.signal, processAbort.signal])
                        : processAbort.signal;
                    const response = await fetch(request, { ...init, signal });
                    const html = response.headers.get("content-type")?.includes("text/html") ?? false;
                    if (!response.ok || html) {
                        const requestUrl = request instanceof Request ? request.url : String(request);
                        throw new OpenCodeHttpError(new URL(requestUrl).pathname, response.status, html);
                    }
                    return response;
                },
            });
            await client.server.info({ signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())) });
            const generation = { client, users: 0, stop, exited };
            this.generations.add(generation);
            process.once("exit", () => {
                this.generations.delete(generation);
                void stop().catch((error) => logger.warn({ error }, "OpenCode process cleanup failed"));
            });
            return generation;
        }
        catch (error) {
            await stop();
            throw error;
        }
    }
}
//# sourceMappingURL=runtime.js.map