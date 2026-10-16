export const REWIND_TEST_CAPABILITIES = {
    supportsStreaming: true,
    supportsSessionPersistence: true,
    supportsDynamicModes: false,
    supportsMcpServers: false,
    supportsReasoningStream: false,
    supportsToolInvocations: false,
    supportsRewindConversation: true,
    supportsRewindFiles: true,
    supportsRewindBoth: true,
};
export class FakeRewindSession {
    constructor(waitBeforeHistory) {
        this.waitBeforeHistory = waitBeforeHistory;
        this.provider = "claude";
        this.id = "fake-rewind-session";
        this.capabilities = REWIND_TEST_CAPABILITIES;
        this.recordedRewinds = [];
        this.aborted = false;
        this.historyReadCount = 0;
        this.history = [{ type: "user_message", text: "before", messageId: "message-1" }];
        this.subscribers = new Set();
        this.activeTurnId = null;
    }
    async run() {
        return { sessionId: this.id, finalText: "", timeline: [] };
    }
    async startTurn() {
        this.aborted = false;
        this.activeTurnId = "turn-1";
        queueMicrotask(() => {
            this.emit({ type: "turn_started", provider: this.provider, turnId: "turn-1" });
        });
        return { turnId: "turn-1" };
    }
    subscribe(callback) {
        this.subscribers.add(callback);
        return () => this.subscribers.delete(callback);
    }
    async *streamHistory() {
        this.historyReadCount += 1;
        await this.waitBeforeHistory?.();
        for (const item of this.history) {
            yield { type: "timeline", provider: this.provider, item };
        }
    }
    async getRuntimeInfo() {
        return { provider: this.provider, sessionId: this.id };
    }
    async getAvailableModes() {
        return [];
    }
    async getCurrentMode() {
        return null;
    }
    async setMode() { }
    getPendingPermissions() {
        return [];
    }
    async respondToPermission(_requestId, _response) { }
    describePersistence() {
        return { provider: this.provider, sessionId: this.id };
    }
    async interrupt() {
        this.aborted = true;
        if (this.activeTurnId) {
            const turnId = this.activeTurnId;
            this.activeTurnId = null;
            this.emit({ type: "turn_canceled", provider: this.provider, reason: "interrupted", turnId });
        }
    }
    async close() { }
    async revertConversation(input) {
        this.recordedRewinds.push({ mode: "conversation", messageId: input.messageId });
    }
    async revertFiles(input) {
        this.recordedRewinds.push({ mode: "files", messageId: input.messageId });
    }
    async revertBoth(input) {
        this.recordedRewinds.push({ mode: "both", messageId: input.messageId });
    }
    emit(event) {
        for (const subscriber of this.subscribers) {
            subscriber(event);
        }
    }
}
//# sourceMappingURL=test-rewind-session.js.map