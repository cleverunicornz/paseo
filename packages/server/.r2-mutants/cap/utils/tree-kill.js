import treeKill from "tree-kill";
export async function terminateWithTreeKill(child, options) {
    if (isProcessExited(child)) {
        return "already-exited";
    }
    const exitPromise = waitForProcessExit(child);
    await signalProcessTree(child, options.gracefulSignal ?? "SIGTERM");
    if (await waitForExitOrTimeout(exitPromise, options.gracefulTimeoutMs)) {
        return "terminated";
    }
    options.onForceSignal?.();
    await signalProcessTree(child, options.forceSignal ?? "SIGKILL");
    if (options.forceTimeoutMs === undefined) {
        return "killed";
    }
    return (await waitForExitOrTimeout(exitPromise, options.forceTimeoutMs))
        ? "killed"
        : "kill-timeout";
}
export function signalProcessTree(child, signal) {
    if (isProcessExited(child)) {
        return Promise.resolve();
    }
    const pid = child.pid;
    if (typeof pid !== "number" || pid <= 0) {
        signalDirectChild(child, signal);
        return Promise.resolve();
    }
    return new Promise((resolve) => {
        treeKill(pid, signal, (error) => {
            if (error) {
                signalDirectChild(child, signal);
            }
            resolve();
        });
    });
}
function signalDirectChild(child, signal) {
    try {
        child.kill(signal);
    }
    catch {
        // Ignore cleanup races.
    }
}
function isProcessExited(child) {
    return ((child.exitCode !== null && child.exitCode !== undefined) ||
        (child.signalCode !== null && child.signalCode !== undefined));
}
function waitForProcessExit(child) {
    if (isProcessExited(child)) {
        return Promise.resolve();
    }
    if (!child.once) {
        return new Promise(() => undefined);
    }
    return new Promise((resolve) => {
        child.once?.("exit", resolve);
    });
}
async function waitForExitOrTimeout(exitPromise, timeoutMs) {
    let timer = null;
    try {
        return await Promise.race([
            exitPromise.then(() => true),
            new Promise((resolve) => {
                timer = setTimeout(() => resolve(false), timeoutMs);
            }),
        ]);
    }
    finally {
        if (timer) {
            clearTimeout(timer);
        }
    }
}
//# sourceMappingURL=tree-kill.js.map