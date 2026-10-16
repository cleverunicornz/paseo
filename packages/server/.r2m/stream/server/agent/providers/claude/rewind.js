import { forkSession as claudeForkSession } from "@anthropic-ai/claude-agent-sdk";
export const realClaudeRewindSdk = {
    forkSession: claudeForkSession,
};
export async function revertClaudeConversation(input) {
    if (!input.sessionId) {
        throw new Error("Claude session is not ready for rewind");
    }
    const messageId = (await input.resolveMessageId?.(input.messageId)) ?? input.messageId;
    const fork = await input.sdk.forkSession(input.sessionId, {
        upToMessageId: messageId,
    });
    input.setSessionId(fork.sessionId);
}
export async function revertClaudeFiles(input) {
    const messageId = (await input.resolveMessageId?.(input.messageId)) ?? input.messageId;
    const result = await input.query.rewindFiles(messageId, { dryRun: false });
    if (!result.canRewind) {
        throw new Error(result.error ?? `No file checkpoint found for message ${messageId}`);
    }
}
export async function revertClaudeConversationAndFiles(input) {
    await revertClaudeFiles({
        query: input.query,
        messageId: input.messageId,
        resolveMessageId: input.resolveMessageId,
    });
    await revertClaudeConversation(input);
}
//# sourceMappingURL=rewind.js.map