export interface OpenCodeRewindClient {
    session: {
        revert(input: {
            sessionID: string;
            directory: string;
            messageID: string;
        }): Promise<{
            error?: unknown;
        }>;
    };
}
export declare function revertOpenCodeConversationAndFiles(input: {
    client: OpenCodeRewindClient;
    sessionId: string;
    cwd: string;
    messageId: string;
}): Promise<void>;
//# sourceMappingURL=rewind.d.ts.map