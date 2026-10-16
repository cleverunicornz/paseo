export class FakeClaudeSdk {
    constructor() {
        this.recordedForks = [];
        this.recordedFileRewinds = [];
        this.nextSessionId = "forked-session-1";
    }
    setNextSessionId(sessionId) {
        this.nextSessionId = sessionId;
    }
    async forkSession(_sessionId, options) {
        this.recordedForks.push({ upToMessageId: options.upToMessageId });
        return { sessionId: this.nextSessionId };
    }
    createQuery() {
        return {
            rewindFiles: async (userMessageId) => {
                this.recordedFileRewinds.push({ userMessageId });
                return { canRewind: true };
            },
        };
    }
}
//# sourceMappingURL=test-rewind-claude-sdk.js.map