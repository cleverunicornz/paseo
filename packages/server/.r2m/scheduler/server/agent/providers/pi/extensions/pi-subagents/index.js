import { z } from "zod";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { extractTextFromToolResult } from "../../tool-call-mapper.js";
const Args = z
    .object({
    agent: z.string().trim().min(1).optional(),
    task: z.string().trim().min(1).optional(),
    async: z.boolean().optional(),
    action: z.unknown().optional(),
})
    .passthrough();
const Row = z
    .object({
    index: z.number().int().nonnegative().optional(),
    agent: z.string().trim().min(1),
    exitCode: z.number().optional(),
    success: z.boolean().optional(),
    sessionFile: z.string().trim().min(1).optional(),
})
    .passthrough();
const Completion = z
    .object({ runId: z.string().trim().min(1), results: z.array(Row) })
    .passthrough();
const Details = z
    .object({
    mode: z.string(),
    runId: z.string().optional(),
    asyncId: z.string().optional(),
    asyncDir: z.string().trim().min(1).optional(),
    results: z.array(Row),
    completions: z.array(Completion).optional(),
})
    .passthrough();
const AsyncStatus = z
    .object({
    state: z.string(),
    steps: z.array(z
        .object({
        agent: z.string().trim().min(1),
        status: z.string().optional(),
        sessionFile: z.string().trim().min(1).optional(),
    })
        .passthrough()),
})
    .passthrough();
function asyncChildStatus(runState, stepStatus) {
    if (!["complete", "failed", "stopped"].includes(runState))
        return "running";
    if (runState === "stopped" || stepStatus === "stopped")
        return "canceled";
    if (runState === "failed" || stepStatus === "failed" || stepStatus === "error")
        return "failed";
    return "completed";
}
/** The `subagent-notify` header; a grouped notice reports every run as completed. */
function noticeStatus(header) {
    if (/^Background tasks completed \(\d+\):/.test(header))
        return "completed";
    const outcome = header.match(/^(?:Background task|Detached foreground task) (completed|failed|stopped): \*\*/)?.[1];
    if (outcome === "stopped")
        return "canceled";
    return outcome;
}
export const piSubagents = {
    id: "pi-subagents",
    createSession: () => {
        const callsByRun = new Map();
        const readSessions = new Set();
        /** Keyed by async directory, which both status.json and the completion notice carry. */
        const asyncRuns = new Map();
        const rememberAsyncRun = (details, call) => {
            if (details.asyncDir && call.status !== "failed") {
                asyncRuns.set(details.asyncDir, { owner: call.callId, polling: true });
            }
        };
        const collectRows = (owner, rows, description, failed = false) => {
            const subagents = [];
            const childSessions = [];
            for (const [index, row] of rows.entries()) {
                const id = rows.length === 1 ? owner : `${owner}:${row.index ?? index}`;
                subagents.push({
                    type: "upsert",
                    id,
                    title: row.agent,
                    description,
                    toolCallId: owner,
                    status: failed || row.success === false || (row.success !== true && row.exitCode !== 0)
                        ? "failed"
                        : "completed",
                });
                if (row.sessionFile && !readSessions.has(row.sessionFile)) {
                    readSessions.add(row.sessionFile);
                    childSessions.push({ id, file: row.sessionFile });
                }
            }
            return { subagents, childSessions };
        };
        const mapWait = (call) => {
            if (call.status === "running")
                return undefined;
            const details = Details.safeParse(typeof call.result === "object" ? call.result?.details : null);
            if (!details.success || !details.data.completions)
                return undefined;
            const subagents = [];
            const childSessions = [];
            for (const completion of details.data.completions) {
                const owner = callsByRun.get(completion.runId);
                if (!owner)
                    continue;
                const mapped = collectRows(owner, completion.results);
                subagents.push(...mapped.subagents);
                childSessions.push(...mapped.childSessions);
            }
            return subagents.length ? { subagents, childSessions } : undefined;
        };
        const mapSpawn = (call) => {
            const args = Args.safeParse(call.args);
            if (!args.success || args.data.action !== undefined || !args.data.agent || !args.data.task)
                return undefined;
            const detail = {
                type: "sub_agent",
                subAgentType: args.data.agent,
                description: args.data.task,
                log: extractTextFromToolResult(call.result)?.trim() ?? "",
            };
            const base = {
                type: "upsert",
                id: call.callId,
                title: args.data.agent,
                description: args.data.task,
                toolCallId: call.callId,
            };
            if (call.status === "running")
                return { detail, subagents: [{ ...base, status: "running" }] };
            const details = Details.safeParse(typeof call.result === "object" ? call.result?.details : null);
            if (!details.success || details.data.mode === "management")
                return call.status === "failed"
                    ? { detail, subagents: [{ ...base, status: "failed" }] }
                    : { detail };
            if (details.data.runId)
                callsByRun.set(details.data.runId, call.callId);
            if (details.data.results.length === 0 && (details.data.asyncId || args.data.async)) {
                rememberAsyncRun(details.data, call);
                return {
                    detail,
                    subagents: [
                        {
                            ...base,
                            status: call.status === "failed" ? "failed" : "running",
                        },
                    ],
                };
            }
            if (details.data.results.length === 0 && call.status === "failed")
                return { detail, subagents: [{ ...base, status: "failed" }] };
            return {
                detail,
                ...collectRows(call.callId, details.data.results, args.data.task, call.status === "failed"),
            };
        };
        return {
            mapToolCall(call) {
                if (call.toolName === "bg_wait")
                    return mapWait(call);
                if (call.toolName === "subagent")
                    return mapSpawn(call);
                return undefined;
            },
            // The notice is the only completion Pi persists, so replay settles async runs from it.
            mapCustomMessage(message) {
                if (message.customType !== "subagent-notify")
                    return undefined;
                const text = typeof message.content === "string"
                    ? message.content
                    : extractTextFromToolResult({ content: message.content });
                const lines = text?.split("\n") ?? [];
                const status = noticeStatus(lines[0] ?? "");
                if (!status)
                    return undefined;
                const subagents = [];
                const childSessions = [];
                // Each run's session line follows its async directory line; earlier lines are child output.
                let owner;
                for (const line of lines) {
                    const dir = line.match(/^Retention-managed async directory: (.+)$/)?.[1];
                    if (dir) {
                        owner = asyncRuns.get(dir)?.owner;
                        if (owner)
                            subagents.push({ type: "upsert", id: owner, status });
                        continue;
                    }
                    const file = owner ? line.match(/^Session file: (.+)$/)?.[1] : undefined;
                    if (!owner || !file)
                        continue;
                    if (!readSessions.has(file)) {
                        readSessions.add(file);
                        childSessions.push({ id: owner, file });
                    }
                    owner = undefined;
                }
                return subagents.length ? { subagents, childSessions } : undefined;
            },
            poll() {
                const subagents = [];
                const childSessions = [];
                for (const [dir, run] of asyncRuns) {
                    if (!run.polling)
                        continue;
                    let raw;
                    try {
                        raw = JSON.parse(readFileSync(join(dir, "status.json"), "utf8"));
                    }
                    catch {
                        continue;
                    }
                    const parsed = AsyncStatus.safeParse(raw);
                    if (!parsed.success)
                        continue;
                    const terminal = ["complete", "failed", "stopped"].includes(parsed.data.state);
                    for (const [index, step] of parsed.data.steps.entries()) {
                        const id = parsed.data.steps.length === 1 ? run.owner : `${run.owner}:${index}`;
                        const status = asyncChildStatus(parsed.data.state, step.status);
                        subagents.push({ type: "upsert", id, title: step.agent, status });
                        if (step.sessionFile && !readSessions.has(step.sessionFile)) {
                            readSessions.add(step.sessionFile);
                            childSessions.push({ id, file: step.sessionFile });
                        }
                    }
                    if (terminal) {
                        if (parsed.data.steps.length === 0) {
                            subagents.push({
                                type: "upsert",
                                id: run.owner,
                                status: parsed.data.state === "complete" ? "completed" : "failed",
                            });
                        }
                        run.polling = false;
                    }
                }
                return subagents.length || childSessions.length ? { subagents, childSessions } : undefined;
            },
        };
    },
};
//# sourceMappingURL=index.js.map