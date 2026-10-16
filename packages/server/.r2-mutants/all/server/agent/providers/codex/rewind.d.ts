import type { CodexThreadForkParams, CodexThreadForkResponse, CodexThreadRollbackParams, CodexThreadRollbackResponse } from "./app-server-transport.js";
export interface CodexRewindClient {
    forkThread?(params: CodexThreadForkParams): Promise<CodexThreadForkResponse>;
    rollbackThread?(params: CodexThreadRollbackParams): Promise<CodexThreadRollbackResponse>;
    request(method: string, params?: unknown, timeoutMs?: number): Promise<unknown>;
}
export interface CodexUserMessageTurnIndex {
    resolve(messageId: string): {
        index: number;
        turnId: string | null;
    } | null;
    count(): number;
}
export declare function revertCodexConversation(input: {
    client: CodexRewindClient;
    threadId: string | null;
    messageId: string;
    cwd?: string | null;
    model?: string | null;
    serviceTier?: string | null;
    config?: Record<string, unknown> | null;
    userMessageTurns: CodexUserMessageTurnIndex;
    threadRollbackAvailable: boolean;
    setThreadId: (threadId: string) => void | Promise<void>;
}): Promise<void>;
//# sourceMappingURL=rewind.d.ts.map