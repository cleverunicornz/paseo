import { appendFile } from "node:fs/promises";
let nextTraceId = 1;
let pendingTraceWrite = Promise.resolve();
function appendTrace(event) {
    const tracePath = process.env.PASEO_GIT_TRACE_FILE?.trim();
    if (!tracePath)
        return;
    pendingTraceWrite = pendingTraceWrite
        .then(() => appendFile(tracePath, `${JSON.stringify(event)}\n`, "utf8"))
        .catch(() => {
        // Diagnostic tracing must never change command execution.
    });
}
export async function flushGitCommandTrace() {
    await pendingTraceWrite;
}
export function submitGitCommandTrace(args, cwd, queue) {
    if (!process.env.PASEO_GIT_TRACE_FILE?.trim())
        return null;
    const submittedAtMs = Date.now();
    const context = {
        id: `${process.pid}:${nextTraceId++}`,
        args: [...args],
        cwd,
        submittedAtMs,
        startedAtMs: null,
        spawnedAtMs: null,
        pid: null,
        submittedQueue: { ...queue },
        startedQueue: null,
        settled: false,
    };
    return context;
}
export function startGitCommandTrace(context, queue) {
    if (!context)
        return;
    context.startedAtMs = Date.now();
    context.startedQueue = { ...queue };
}
export function spawnGitCommandTrace(context, pid) {
    if (!context)
        return;
    context.spawnedAtMs = Date.now();
    context.pid = pid ?? null;
}
export function settleGitCommandTrace(context, settlement) {
    if (!context || context.settled)
        return;
    context.settled = true;
    const atMs = Date.now();
    appendTrace({
        kind: "git_command",
        event: "settled",
        id: context.id,
        atMs,
        submittedAtMs: context.submittedAtMs,
        startedAtMs: context.startedAtMs,
        args: context.args,
        cwd: context.cwd,
        queueWaitMs: context.startedAtMs === null ? null : context.startedAtMs - context.submittedAtMs,
        spawnCallMs: context.startedAtMs === null || context.spawnedAtMs === null
            ? null
            : context.spawnedAtMs - context.startedAtMs,
        pid: context.pid,
        queue: {
            submitted: context.submittedQueue,
            started: context.startedQueue,
        },
        durationMs: atMs - context.submittedAtMs,
        ...settlement,
    });
}
//# sourceMappingURL=git-command-trace.js.map