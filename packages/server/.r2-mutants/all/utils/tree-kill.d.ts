export interface TreeKillTarget {
    pid?: number;
    exitCode?: number | null;
    signalCode?: NodeJS.Signals | null;
    kill(signal?: NodeJS.Signals | number): boolean;
    once?(event: "exit", listener: () => void): unknown;
}
export interface TerminateWithTreeKillOptions {
    gracefulSignal?: NodeJS.Signals;
    forceSignal?: NodeJS.Signals;
    gracefulTimeoutMs: number;
    forceTimeoutMs?: number;
    onForceSignal?: () => void;
}
export type TerminateWithTreeKillResult = "already-exited" | "terminated" | "killed" | "kill-timeout";
export type ProcessTerminator = (child: TreeKillTarget, options: TerminateWithTreeKillOptions) => Promise<TerminateWithTreeKillResult>;
export declare function terminateWithTreeKill(child: TreeKillTarget, options: TerminateWithTreeKillOptions): Promise<TerminateWithTreeKillResult>;
export declare function signalProcessTree(child: TreeKillTarget, signal: NodeJS.Signals): Promise<void>;
//# sourceMappingURL=tree-kill.d.ts.map