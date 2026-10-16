import type { ClaudeRewindSdk } from "./rewind.js";
export declare class FakeClaudeSdk implements ClaudeRewindSdk {
    readonly recordedForks: Array<{
        upToMessageId: string;
    }>;
    readonly recordedFileRewinds: Array<{
        userMessageId: string;
    }>;
    private nextSessionId;
    setNextSessionId(sessionId: string): void;
    forkSession(_sessionId: string, options: {
        upToMessageId: string;
    }): Promise<{
        sessionId: string;
    }>;
    createQuery(): {
        rewindFiles: (userMessageId: string, options?: {
            dryRun?: boolean;
        }) => Promise<{
            canRewind: boolean;
        }>;
    };
}
//# sourceMappingURL=test-rewind-claude-sdk.d.ts.map