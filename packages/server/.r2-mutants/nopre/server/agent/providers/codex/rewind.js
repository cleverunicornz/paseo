import { parseCodexThreadForkResponse, parseCodexThreadRollbackResponse, } from "./app-server-transport.js";
async function readCodexThreadHistoryMode(client, threadId) {
    const response = await client.request("thread/read", { threadId, includeTurns: false });
    if (typeof response !== "object" || response === null || !("thread" in response)) {
        throw new Error("Codex thread/read did not return thread metadata");
    }
    const thread = response.thread;
    if (typeof thread !== "object" || thread === null || !("historyMode" in thread)) {
        return "legacy";
    }
    if (thread.historyMode === "legacy" || thread.historyMode === "paginated") {
        return thread.historyMode;
    }
    throw new Error(`Codex thread/read returned unknown history mode ${String(thread.historyMode)}`);
}
async function forkCodexThread(client, params) {
    if (client.forkThread) {
        return client.forkThread(params);
    }
    return parseCodexThreadForkResponse(await client.request("thread/fork", params));
}
async function rollbackCodexThread(client, params) {
    if (client.rollbackThread) {
        return client.rollbackThread(params);
    }
    return parseCodexThreadRollbackResponse(await client.request("thread/rollback", params));
}
export async function revertCodexConversation(input) {
    if (!input.threadId) {
        throw new Error("Codex thread is not ready for rewind");
    }
    const targetTurn = input.userMessageTurns.resolve(input.messageId);
    if (targetTurn === null) {
        throw new Error(`Codex could not find user message ${input.messageId} in the current thread`);
    }
    const currentUserTurnCount = input.userMessageTurns.count();
    const numTurns = currentUserTurnCount - targetTurn.index;
    if (numTurns < 0) {
        throw new Error(`Codex user message ${input.messageId} is outside the current thread`);
    }
    // Codex does not carry the parent thread's config into a fork; without it the
    // forked thread falls back to the default model provider.
    const forkParams = {
        threadId: input.threadId,
        cwd: input.cwd ?? null,
        model: input.model ?? null,
        serviceTier: input.serviceTier ?? null,
        ...(input.config ? { config: input.config } : {}),
        excludeTurns: false,
        persistExtendedHistory: true,
    };
    if (!input.threadRollbackAvailable ||
        (await readCodexThreadHistoryMode(input.client, input.threadId)) === "paginated") {
        if (!targetTurn.turnId) {
            throw new Error(`Codex could not find the turn containing user message ${input.messageId}`);
        }
        const forked = await forkCodexThread(input.client, {
            ...forkParams,
            beforeTurnId: targetTurn.turnId,
        });
        await input.setThreadId(forked.thread.id);
        return;
    }
    // Legacy threads on Codex before 0.156 fork and then roll back. Fork is
    // non-destructive: the old thread file stays on disk and remains
    // recoverable with `codex resume <old-uuid>` if the rewind target was wrong.
    const forked = await forkCodexThread(input.client, forkParams);
    const forkedThreadId = forked.thread.id;
    // Codex rollback is chat-only by design. File edits from rewound turns stay
    // on disk; a future file primitive would be a separate capability.
    const rolledBack = await rollbackCodexThread(input.client, {
        threadId: forkedThreadId,
        numTurns,
    });
    await input.setThreadId(rolledBack.thread.id);
}
//# sourceMappingURL=rewind.js.map