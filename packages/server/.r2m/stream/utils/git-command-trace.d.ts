interface GitCommandTraceContext {
    id: string;
    args: string[];
    cwd: string;
    submittedAtMs: number;
    startedAtMs: number | null;
    spawnedAtMs: number | null;
    pid: number | null;
    submittedQueue: GitCommandTraceQueueState;
    startedQueue: GitCommandTraceQueueState | null;
    settled: boolean;
}
interface GitCommandTraceQueueState {
    active: number;
    pending: number;
}
interface GitCommandTraceSettlement {
    outcome: "closed" | "spawn_error" | "timed_out";
    exitCode?: number | null;
    signal?: NodeJS.Signals | null;
    truncated?: boolean;
}
export declare function flushGitCommandTrace(): Promise<void>;
export declare function submitGitCommandTrace(args: string[], cwd: string, queue: GitCommandTraceQueueState): GitCommandTraceContext | null;
export declare function startGitCommandTrace(context: GitCommandTraceContext | null, queue: GitCommandTraceQueueState): void;
export declare function spawnGitCommandTrace(context: GitCommandTraceContext | null, pid: number | undefined): void;
export declare function settleGitCommandTrace(context: GitCommandTraceContext | null, settlement: GitCommandTraceSettlement): void;
export {};
//# sourceMappingURL=git-command-trace.d.ts.map