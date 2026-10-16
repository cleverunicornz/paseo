import { mkdirSync } from "node:fs";
import { stat } from "node:fs/promises";
import net from "node:net";
import { createRequire } from "node:module";
import path from "node:path";
import { findExecutable } from "../../../../executable-resolution/executable-resolution.js";
import { spawnProcess } from "../../../../utils/spawn.js";
import { terminateWithTreeKill } from "../../../../utils/tree-kill.js";
import { createProviderEnv, resolveProviderCommandPrefix, } from "../../provider-launch-config.js";
import { resolveOpenCodeHomeDir } from "./paths.js";
import { OpenCodeEventConsumer, } from "./event-consumer.js";
/** Budget for the OpenCode HTTP server to become usable after spawn. */
export const OPENCODE_SERVER_STARTUP_TIMEOUT_MS = 30000;
/** One stalled SSE attempt plus enough time for the consumer's retry. */
export const OPENCODE_EVENT_STREAM_READY_TIMEOUT_MS = 45000;
const OPENCODE_SERVER_GRACEFUL_SHUTDOWN_TIMEOUT_MS = 5000;
const OPENCODE_SERVER_FORCE_SHUTDOWN_TIMEOUT_MS = 1000;
export class OpenCodeServerManager {
    constructor(options) {
        this.currentServer = null;
        this.retiredServers = new Set();
        this.startPromise = null;
        this.newServerPromise = null;
        this.logger = options.logger;
        this.baseEnv = options.baseEnv;
        this.runtimeSettings = options.runtimeSettings;
        this.runtimeSettingsKey = JSON.stringify(this.runtimeSettings ?? {});
        this.managedProcesses = options.managedProcesses;
        this.terminateProcess = options.terminateProcess ?? terminateWithTreeKill;
        this.portAllocator = options.portAllocator ?? findAvailablePort;
        this.resolveCommandPrefix =
            options.resolveCommandPrefix ??
                (() => resolveProviderCommandPrefix(this.runtimeSettings?.command, resolveOpenCodeBinary));
        this.resolveHomeDir = options.resolveHomeDir ?? resolveOpenCodeHomeDir;
        this.spawnServerProcess = options.spawnServerProcess ?? spawnProcess;
        this.createEventSource =
            options.createEventSource ?? ((input) => new OpenCodeEventConsumer(input));
        this.decorateServerEnv = options.decorateServerEnv;
    }
    static getInstance(logger, runtimeSettings, options = {}) {
        const nextSettingsKey = JSON.stringify(runtimeSettings ?? {});
        if (!OpenCodeServerManager.instance) {
            OpenCodeServerManager.instance = new OpenCodeServerManager({
                logger,
                runtimeSettings,
                ...options,
            });
            OpenCodeServerManager.registerExitHandler();
        }
        else if (OpenCodeServerManager.instance.runtimeSettingsKey !== nextSettingsKey) {
            logger.warn({
                existingRuntimeSettings: OpenCodeServerManager.instance.runtimeSettingsKey,
                requestedRuntimeSettings: nextSettingsKey,
            }, "OpenCode server manager already initialized with different runtime settings");
        }
        return OpenCodeServerManager.instance;
    }
    static registerExitHandler() {
        if (OpenCodeServerManager.exitHandlerRegistered) {
            return;
        }
        OpenCodeServerManager.exitHandlerRegistered = true;
        const cleanup = () => {
            const instance = OpenCodeServerManager.instance;
            void instance?.shutdown();
        };
        process.on("exit", cleanup);
        process.on("SIGTERM", cleanup);
        process.on("SIGINT", cleanup);
    }
    async acquireCurrent(signal) {
        signal?.throwIfAborted();
        const server = await waitForServerAcquisition(this.getCurrentServer(), signal);
        signal?.throwIfAborted();
        return this.acquireServer(server);
    }
    async acquireNew(signal) {
        signal?.throwIfAborted();
        const server = await waitForServerAcquisition(this.getNewServer(), signal);
        signal?.throwIfAborted();
        return this.acquireServer(server);
    }
    async acquireDedicated(env) {
        const server = await this.startServer(env);
        server.retired = true;
        this.retiredServers.add(server);
        const acquisition = this.acquireServer(server);
        try {
            await server.ready;
            return acquisition;
        }
        catch (error) {
            await acquisition.release();
            throw error;
        }
    }
    acquireExisting(url) {
        const server = this.findLiveServerByUrl(url);
        return server ? this.acquireServer(server) : null;
    }
    findLiveServerByUrl(url) {
        const servers = [
            ...(this.currentServer ? [this.currentServer] : []),
            ...Array.from(this.retiredServers),
        ];
        return servers.find((server) => server.url === url && this.isServerLive(server)) ?? null;
    }
    isServerLive(server) {
        return (!server.process.killed &&
            server.process.exitCode === null &&
            server.process.signalCode === null);
    }
    acquireServer(server) {
        server.refCount += 1;
        let releasePromise = null;
        return {
            server: { port: server.port, url: server.url },
            events: server.events,
            environment: server.environment,
            release: async () => {
                if (releasePromise) {
                    return releasePromise;
                }
                releasePromise = this.releaseServer(server);
                return releasePromise;
            },
        };
    }
    async releaseServer(server) {
        server.refCount = Math.max(0, server.refCount - 1);
        if (server.refCount > 0) {
            return;
        }
        if (this.currentServer === server) {
            this.currentServer = null;
            server.retired = true;
        }
        if (!server.retired) {
            return;
        }
        this.retiredServers.delete(server);
        this.logger.info(generationLogContext(server), "OpenCode server generation released");
        await this.killServer(server);
    }
    async getNewServer() {
        if (this.newServerPromise) {
            return this.newServerPromise;
        }
        this.newServerPromise = Promise.resolve()
            .then(async () => {
            await this.rotateCurrentServer();
            const server = await this.startServer();
            if (!server.retired) {
                this.currentServer = server;
            }
            await server.ready;
            return server;
        })
            .finally(() => {
            this.newServerPromise = null;
        });
        return this.newServerPromise;
    }
    async getCurrentServer() {
        if (this.newServerPromise) {
            return this.newServerPromise;
        }
        if (this.startPromise) {
            const server = await this.startPromise;
            await server.ready;
            return server;
        }
        if (this.currentServer && !this.currentServer.process.killed) {
            await this.currentServer.ready;
            return this.currentServer;
        }
        this.startPromise = this.startServer().then((server) => {
            if (!server.retired) {
                this.currentServer = server;
            }
            return server;
        });
        const currentStart = this.startPromise;
        const result = await currentStart.finally(() => {
            if (this.startPromise === currentStart) {
                this.startPromise = null;
            }
        });
        await result.ready;
        return result;
    }
    async rotateCurrentServer() {
        const existing = this.currentServer;
        if (existing) {
            existing.retired = true;
            this.retiredServers.add(existing);
            this.currentServer = null;
            this.logger.info(generationLogContext(existing), "OpenCode server generation retired");
            await this.cleanupRetiredServers();
        }
        if (this.startPromise) {
            const pending = await this.startPromise;
            pending.retired = true;
            this.retiredServers.add(pending);
            this.currentServer = null;
            this.logger.info(generationLogContext(pending), "OpenCode server generation retired");
            await this.cleanupRetiredServers();
        }
    }
    async startServer(launchEnv) {
        const port = await this.portAllocator();
        const url = `http://127.0.0.1:${port}`;
        const launchPrefix = await this.resolveCommandPrefix();
        const serverArgs = [...launchPrefix.args, "serve", "--port", String(port)];
        // Use a neutral OpenCode home as the server cwd. Launching from the user's
        // home directory causes OpenCode to treat it as the default workspace and
        // index the entire home tree.
        const serverCwd = this.resolveHomeDir();
        mkdirSync(serverCwd, { recursive: true });
        const existingConfigContent = launchEnv?.OPENCODE_CONFIG_CONTENT ??
            this.runtimeSettings?.env?.OPENCODE_CONFIG_CONTENT ??
            (typeof this.baseEnv?.OPENCODE_CONFIG_CONTENT === "string"
                ? this.baseEnv.OPENCODE_CONFIG_CONTENT
                : process.env.OPENCODE_CONFIG_CONTENT);
        const bridgeEnv = this.decorateServerEnv?.(existingConfigContent ? { OPENCODE_CONFIG_CONTENT: existingConfigContent } : {});
        const environment = createProviderEnv({
            baseEnv: this.baseEnv,
            runtimeSettings: this.runtimeSettings,
            overlays: [launchEnv, bridgeEnv],
        });
        const serverProcess = this.spawnServerProcess(launchPrefix.command, serverArgs, {
            cwd: serverCwd,
            detached: process.platform !== "win32",
            stdio: ["ignore", "pipe", "pipe"],
            baseEnv: environment,
        });
        const managedProcessRecord = this.recordManagedServerProcess({
            process: serverProcess,
            command: launchPrefix.command,
            args: serverArgs,
            port,
        });
        let resolveProcessExit;
        const processExit = new Promise((resolve) => {
            resolveProcessExit = resolve;
        });
        let resolveListening;
        let rejectListening;
        const ready = new Promise((resolve, reject) => {
            resolveListening = resolve;
            rejectListening = reject;
        });
        const server = {
            environment,
            process: serverProcess,
            port,
            url,
            refCount: 0,
            retired: false,
            ready: Promise.resolve(),
            events: this.createEventSource({
                serverUrl: url,
                processExit,
                logger: this.logger,
                listening: ready,
            }),
            managedProcessRecord,
        };
        this.logger.info({ ...generationLogContext(server), dedicated: launchEnv !== undefined }, "OpenCode server generation started");
        void managedProcessRecord.then((record) => {
            if (record && server.managedProcessRecord === managedProcessRecord) {
                server.managedProcessId = record.id;
            }
            return undefined;
        });
        let started = false;
        let settled = false;
        let stderrBuffer = "";
        let stdoutBuffer = "";
        const STARTUP_BUFFER_CAP = 8192;
        const appendCapped = (current, chunk) => {
            if (current.length >= STARTUP_BUFFER_CAP) {
                return current;
            }
            const remaining = STARTUP_BUFFER_CAP - current.length;
            return current + chunk.slice(0, remaining);
        };
        const buildStartupErrorMessage = (headline) => {
            const sections = [headline];
            const stderrTrimmed = stderrBuffer.trim();
            if (stderrTrimmed.length > 0) {
                sections.push(`stderr: ${stderrTrimmed}`);
            }
            const stdoutTrimmed = stdoutBuffer.trim();
            if (stdoutTrimmed.length > 0) {
                sections.push(`stdout: ${stdoutTrimmed}`);
            }
            return sections.join("\n");
        };
        {
            let timeout;
            const failStartup = (error) => {
                if (settled) {
                    return;
                }
                settled = true;
                clearTimeout(timeout);
                rejectListening(error);
            };
            timeout = setTimeout(() => {
                if (!started) {
                    failStartup(new Error(buildStartupErrorMessage("OpenCode server startup timeout")));
                }
            }, OPENCODE_SERVER_STARTUP_TIMEOUT_MS);
            serverProcess.stdout?.on("data", (data) => {
                const output = data.toString();
                stdoutBuffer = appendCapped(stdoutBuffer, output);
                if (output.includes("listening on") && !settled) {
                    started = true;
                    settled = true;
                    clearTimeout(timeout);
                    resolveListening();
                }
            });
            serverProcess.stderr?.on("data", (data) => {
                const output = data.toString();
                stderrBuffer = appendCapped(stderrBuffer, output);
                this.logger.error({ stderr: output.trim() }, "OpenCode server stderr");
            });
            serverProcess.on("error", (error) => {
                const headline = error instanceof Error ? error.message : String(error);
                failStartup(new Error(buildStartupErrorMessage(headline)));
            });
            serverProcess.on("exit", (code, signal) => {
                this.logger.info({ ...generationLogContext(server), code, signal }, "OpenCode server generation exited");
                resolveProcessExit(new Error(`OpenCode server exited with code ${code}`));
                this.removeManagedServerRecord(server);
                if (!started) {
                    failStartup(new Error(buildStartupErrorMessage(`OpenCode server exited with code ${code}`)));
                }
                if (this.currentServer?.process === serverProcess) {
                    this.currentServer = null;
                }
                for (const retired of Array.from(this.retiredServers)) {
                    if (retired.process === serverProcess) {
                        this.retiredServers.delete(retired);
                    }
                }
            });
        }
        server.ready = ready.catch(async (error) => {
            await this.killServer(server);
            if (this.currentServer === server) {
                this.currentServer = null;
            }
            this.retiredServers.delete(server);
            throw error;
        });
        return server;
    }
    async shutdown() {
        const servers = [
            ...(this.currentServer ? [this.currentServer] : []),
            ...Array.from(this.retiredServers),
        ];
        for (const server of servers) {
            this.logger.info(generationLogContext(server), "OpenCode server generation stopping");
        }
        await Promise.all(servers.map((server) => this.killServer(server)));
        this.currentServer = null;
        this.retiredServers.clear();
    }
    async cleanupRetiredServers() {
        const cleanup = [];
        for (const server of Array.from(this.retiredServers)) {
            if (server.refCount === 0) {
                this.retiredServers.delete(server);
                cleanup.push(this.killServer(server));
            }
        }
        await Promise.all(cleanup);
    }
    async killServer(server) {
        await server.events.close();
        if ((server.process.exitCode !== null && server.process.exitCode !== undefined) ||
            (server.process.signalCode !== null && server.process.signalCode !== undefined)) {
            return;
        }
        const result = await this.terminateProcess(server.process, {
            gracefulTimeoutMs: OPENCODE_SERVER_GRACEFUL_SHUTDOWN_TIMEOUT_MS,
            forceTimeoutMs: OPENCODE_SERVER_FORCE_SHUTDOWN_TIMEOUT_MS,
            onForceSignal: () => {
                this.logger.warn({ timeoutMs: OPENCODE_SERVER_GRACEFUL_SHUTDOWN_TIMEOUT_MS }, "OpenCode server did not exit after SIGTERM; sending SIGKILL");
            },
        });
        if (result === "kill-timeout") {
            this.logger.warn({ timeoutMs: OPENCODE_SERVER_FORCE_SHUTDOWN_TIMEOUT_MS }, "OpenCode server did not report exit after SIGKILL");
        }
        if (server.managedProcessId) {
            await this.removeManagedProcessId(server.managedProcessId);
            server.managedProcessId = undefined;
            server.managedProcessRecord = undefined;
        }
        else {
            this.removeManagedServerRecord(server);
        }
    }
    async recordManagedServerProcess(options) {
        const pid = options.process.pid;
        if (!this.managedProcesses || typeof pid !== "number" || pid <= 0) {
            return null;
        }
        try {
            return await this.managedProcesses.record({
                owner: { provider: "opencode", kind: "helper-server" },
                pid,
                command: options.command,
                args: options.args,
                metadata: { port: options.port },
            });
        }
        catch (error) {
            this.logger.warn({ err: error, pid, port: options.port }, "Failed to record OpenCode helper process");
            return null;
        }
    }
    removeManagedProcessRecordWhenResolved(record) {
        void record.then((resolved) => {
            if (resolved) {
                return this.removeManagedProcessId(resolved.id);
            }
            return undefined;
        });
    }
    removeManagedServerRecord(server) {
        const record = server.managedProcessRecord;
        server.managedProcessRecord = undefined;
        if (server.managedProcessId) {
            void this.removeManagedProcessId(server.managedProcessId);
            server.managedProcessId = undefined;
            return;
        }
        if (record) {
            this.removeManagedProcessRecordWhenResolved(record);
        }
    }
    async removeManagedProcessId(id) {
        try {
            await this.managedProcesses?.remove(id);
        }
        catch (error) {
            this.logger.warn({ err: error, id }, "Failed to remove OpenCode helper process record");
        }
    }
}
OpenCodeServerManager.instance = null;
OpenCodeServerManager.exitHandlerRegistered = false;
function generationLogContext(server) {
    return {
        pid: server.process.pid,
        port: server.port,
        url: server.url,
        refCount: server.refCount,
        retired: server.retired,
    };
}
async function waitForServerAcquisition(operation, signal) {
    if (!signal)
        return await operation;
    let handleAbort;
    const aborted = new Promise((_resolve, reject) => {
        handleAbort = () => reject(signal.reason);
        signal.addEventListener("abort", handleAbort, { once: true });
    });
    try {
        return await Promise.race([operation, aborted]);
    }
    finally {
        if (handleAbort)
            signal.removeEventListener("abort", handleAbort);
    }
}
async function resolveOpenCodeBinary() {
    const found = await findExecutable("opencode");
    if (!found) {
        throw new Error("OpenCode binary not found. Install OpenCode (https://github.com/opencode-ai/opencode) and ensure it is available in your shell PATH.");
    }
    if (process.platform === "win32" && path.extname(found).toLowerCase() === ".cmd") {
        const packageDirectories = [
            path.join(path.dirname(found), "node_modules", "opencode-ai"),
            path.join(path.dirname(found), "..", "opencode-ai"),
        ];
        for (const packageDirectory of packageDirectories) {
            const bundledBinary = path.join(packageDirectory, "bin", "opencode.exe");
            if (await pathExists(bundledBinary))
                return bundledBinary;
            // Newer npm releases keep the executable in a platform dependency.
            // Resolve from the CLI package so nested installs and pnpm both work.
            try {
                const require = createRequire(path.join(packageDirectory, "package.json"));
                return require.resolve(`opencode-windows-${process.arch}/bin/opencode.exe`);
            }
            catch {
                // Try the other npm layout before retaining the original command.
            }
        }
        console.warn("[opencode-server] Found opencode.cmd but could not resolve the real opencode.exe. " +
            "The process may not be properly terminated on exit. Path: %s", found);
    }
    return found;
}
async function pathExists(filePath) {
    try {
        await stat(filePath);
        return true;
    }
    catch {
        return false;
    }
}
function findAvailablePort() {
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.listen(0, "127.0.0.1", () => {
            const address = server.address();
            server.close(() => {
                if (typeof address === "object" && address) {
                    resolve(address.port);
                }
                else {
                    reject(new Error("Failed to allocate port"));
                }
            });
        });
        server.on("error", reject);
    });
}
//# sourceMappingURL=server-manager.js.map