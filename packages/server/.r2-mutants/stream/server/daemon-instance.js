import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { getPidLockInfo, isPidLockOwnerRunning, isSamePidLock, releasePidLock, } from "./pid-lock.js";
import { daemonLaunchEnvironment } from "./config-environment.js";
import { readPersistedConfig } from "./persisted-config.js";
import treeKill from "tree-kill";
const killTree = (pid, signal) => new Promise((resolve, reject) => treeKill(pid, signal, (error) => {
    if (error) {
        reject(error);
        return;
    }
    resolve();
}));
// Process ownership only: desktop and CLI load this entry in their own processes.
// Keep daemon bootstrap and WebSocket schemas out of its dependency tree.
export { resolvePaseoHome } from "./paseo-home.js";
export { ensurePrivateDirectory } from "./private-files.js";
export { daemonLaunchEnvironment } from "./config-environment.js";
export { readLocalCredentialForTarget } from "./local-credential.js";
export { isSamePidLock as isSameDaemonInstance, } from "./pid-lock.js";
export class DaemonInstanceError extends Error {
    constructor(code, message) {
        super(message);
        this.code = code;
    }
}
export async function readDaemonInstance(home) {
    const lock = await getPidLockInfo(home);
    return lock && isPidLockOwnerRunning(lock) ? lock : null;
}
export function daemonLogPath(home) {
    try {
        return path.resolve(home, readPersistedConfig(home).log?.file?.path ?? "daemon.log");
    }
    catch {
        return path.join(home, "daemon.log");
    }
}
export async function waitForDaemonReady(home, options = {}) {
    const deadline = Date.now() + (options.timeoutMs ?? 600000);
    while (true) {
        options.signal?.throwIfAborted();
        const instance = await readDaemonInstance(home);
        if (!instance)
            throw new DaemonInstanceError("DAEMON_NOT_RUNNING", `Daemon is not running for ${home}. Start with: paseo daemon start --home ${JSON.stringify(home)}`);
        if (options.instance && !isSamePidLock(instance, options.instance)) {
            throw new DaemonInstanceError("DAEMON_REPLACED", `Supervisor changed for ${home}; refusing to follow PID ${instance.pid}.`);
        }
        if (instance.listen)
            return { ...instance, listen: instance.listen };
        if (Date.now() >= deadline)
            throw notReady(home, instance);
        await delay(100, undefined, { signal: options.signal });
    }
}
function notReady(home, instance) {
    return new DaemonInstanceError("DAEMON_NOT_READY", `Daemon PID ${instance.pid} remains running but is not ready for ${home}.\nLogs: ${daemonLogPath(home)}\nStatus: paseo daemon status --home ${JSON.stringify(home)}\nStop: paseo daemon stop --home ${JSON.stringify(home)}`);
}
async function requestInstanceStop(home, instance, options) {
    let forced = false;
    let usedLifecycleRpc = false;
    if (process.platform === "win32") {
        if (instance.listen && options.requestShutdown) {
            try {
                await options.requestShutdown({ ...instance, listen: instance.listen });
                usedLifecycleRpc = true;
            }
            catch (error) {
                if (!options.force)
                    throw error;
                const current = await getPidLockInfo(home);
                if (current && !isSamePidLock(instance, current))
                    throw new DaemonInstanceError("DAEMON_REPLACED", `Supervisor changed for ${home}; refusing forced cleanup.`);
                await killTree(instance.pid, "SIGKILL");
                forced = true;
            }
        }
        else if (!options.force) {
            throw new DaemonInstanceError("STOP_NO_GRACEFUL_CHANNEL", `PID ${instance.pid} for ${home} has no graceful shutdown channel. Use --force explicitly to terminate it.`);
        }
        else {
            await killTree(instance.pid, "SIGKILL");
            forced = true;
        }
    }
    else {
        try {
            process.kill(instance.pid, "SIGTERM");
        }
        catch (error) {
            if (error.code !== "ESRCH")
                throw error;
        }
    }
    return { forced, usedLifecycleRpc };
}
export async function stopDaemonInstance(home, options = {}) {
    const { timeoutMs = 15000, killTimeoutMs = 3000 } = options;
    const deadline = Date.now() + timeoutMs;
    const instance = await getPidLockInfo(home);
    if (options.instance && instance && !isSamePidLock(instance, options.instance)) {
        throw new DaemonInstanceError("DAEMON_REPLACED", `Supervisor changed for ${home}; refusing to stop PID ${instance.pid}.`);
    }
    if (!instance || !isPidLockOwnerRunning(instance)) {
        if (instance)
            await releasePidLock(home, { ownerPid: instance.pid, startedAt: instance.startedAt });
        return {
            action: "not_running",
            pid: instance?.pid ?? null,
            forced: false,
            usedLifecycleRpc: false,
        };
    }
    if (instance.pid <= 1 || instance.pid === process.pid)
        throw new Error("Refusing to stop invalid supervisor PID");
    let { forced, usedLifecycleRpc } = await requestInstanceStop(home, instance, options);
    const waitForExit = async (waitMs) => {
        const exitDeadline = Date.now() + waitMs;
        while (isPidLockOwnerRunning(instance)) {
            const current = await getPidLockInfo(home);
            if (current && !isSamePidLock(instance, current))
                throw new DaemonInstanceError("DAEMON_REPLACED", `Supervisor changed for ${home}; stop of PID ${instance.pid} was not confirmed.`);
            if (Date.now() >= exitDeadline)
                return false;
            await delay(100);
        }
        return true;
    };
    let stopped = await waitForExit(forced ? killTimeoutMs : Math.max(0, deadline - Date.now()));
    if (!stopped && options.force && !forced) {
        await killTree(instance.pid, "SIGKILL");
        forced = true;
        stopped = await waitForExit(killTimeoutMs);
    }
    if (!stopped)
        throw new DaemonInstanceError("STOP_NOT_CONFIRMED", `Timed out waiting for supervisor PID ${instance.pid} in ${home} to exit${options.force ? "" : "; use --force to permit forced cleanup"}.`);
    await releasePidLock(home, { ownerPid: instance.pid, startedAt: instance.startedAt });
    return { action: "stopped", pid: instance.pid, forced, usedLifecycleRpc };
}
export async function startDaemonInstance(input) {
    input.signal?.throwIfAborted();
    const existing = await readDaemonInstance(input.home);
    if (existing)
        return { instance: existing, spawned: false };
    const { foreground = false, timeoutMs = 600000, signal, onAcquired = () => { }, onReady = () => { }, } = input;
    const child = spawn(input.command, input.args, {
        env: daemonLaunchEnvironment(input),
        detached: !foreground,
        stdio: foreground ? "inherit" : "ignore",
        windowsHide: true,
    });
    let exit;
    const exited = new Promise((resolve) => {
        child.once("error", (error) => {
            exit = { code: 1, error };
            resolve(1);
        });
        child.once("exit", (code) => {
            exit = { code: code ?? 1 };
            resolve(code ?? 1);
        });
    });
    const cancel = () => {
        if (child.pid && !exit) {
            child.ref();
            child.kill("SIGTERM");
        }
    };
    signal?.addEventListener("abort", cancel, { once: true });
    if (!foreground)
        child.unref();
    const deadline = foreground ? Infinity : Date.now() + timeoutMs;
    let acquired;
    async function waitUntilReady() {
        while (true) {
            signal?.throwIfAborted();
            const instance = await readDaemonInstance(input.home);
            if (instance && instance.pid !== child.pid)
                return { instance, spawned: false };
            if (instance && !acquired) {
                acquired = instance;
                onAcquired(instance);
            }
            if (exit) {
                const logPath = daemonLogPath(input.home);
                const log = await readFile(logPath, "utf8").catch(() => "");
                throw new DaemonInstanceError("DAEMON_START_FAILED", `Daemon failed to start (${exit.error?.message ?? `exit ${exit.code}`}). Logs: ${logPath}\n${log.split("\n").slice(-30).join("\n")}`);
            }
            if (instance?.listen) {
                const ready = { ...instance, listen: instance.listen };
                onReady(ready);
                return {
                    instance: ready,
                    spawned: true,
                    ...(foreground ? { exitCode: await exited } : {}),
                };
            }
            if (Date.now() >= deadline) {
                if (acquired)
                    throw notReady(input.home, acquired);
                throw new DaemonInstanceError("DAEMON_NOT_READY", `Supervisor PID ${child.pid} remains running but has not published its lock for ${input.home}. Logs: ${daemonLogPath(input.home)}. Check paseo daemon status --home ${JSON.stringify(input.home)}. Stop with paseo daemon stop --home ${JSON.stringify(input.home)} once its lock is published, or signal this PID.`);
            }
            await delay(100, undefined, { signal });
        }
    }
    try {
        return await waitUntilReady();
    }
    catch (error) {
        if (!(error instanceof DaemonInstanceError && error.code === "DAEMON_NOT_READY")) {
            cancel();
            const stopped = await Promise.race([
                exited.then(() => true),
                delay(15000, false, { ref: false }),
            ]);
            if (!stopped && child.pid) {
                await killTree(child.pid, "SIGKILL");
                await exited;
            }
        }
        throw error;
    }
    finally {
        signal?.removeEventListener("abort", cancel);
    }
}
//# sourceMappingURL=daemon-instance.js.map