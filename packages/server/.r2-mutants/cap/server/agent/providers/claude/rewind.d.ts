import { type Query } from "@anthropic-ai/claude-agent-sdk";
export interface ClaudeRewindSdk {
    forkSession(sessionId: string, options: {
        upToMessageId: string;
    }): Promise<{
        sessionId: string;
    }>;
}
export declare const realClaudeRewindSdk: ClaudeRewindSdk;
export declare function revertClaudeConversation(input: {
    sdk: ClaudeRewindSdk;
    sessionId: string | null;
    messageId: string;
    resolveMessageId?: (messageId: string) => string | Promise<string>;
    setSessionId: (sessionId: string) => void;
}): Promise<void>;
export declare function revertClaudeFiles(input: {
    query: Query;
    messageId: string;
    resolveMessageId?: (messageId: string) => string | Promise<string>;
}): Promise<void>;
export declare function revertClaudeConversationAndFiles(input: {
    sdk: ClaudeRewindSdk;
    query: Query;
    sessionId: string | null;
    messageId: string;
    resolveMessageId?: (messageId: string) => string | Promise<string>;
    setSessionId: (sessionId: string) => void;
}): Promise<void>;
//# sourceMappingURL=rewind.d.ts.map