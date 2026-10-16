import type { TerminalState } from "@getpaseo/protocol/messages";
import type { TerminalActivity, TerminalActivityState } from "@getpaseo/protocol/terminal-activity";
export interface TerminalExitInfo {
    exitCode: number | null;
    signal: number | null;
    lastOutputLines: string[];
}
export interface TerminalCommandFinishedInfo {
    exitCode: number | null;
}
export interface TerminalStateSnapshot {
    state: TerminalState;
    revision: number;
    replayPreamble?: string;
}
export interface TerminalStateSnapshotOptions {
    scrollbackLines?: number;
    includeWrapFlags?: boolean;
}
export interface TerminalSubscribeOptions {
    initialSnapshot?: "state" | "ready";
}
export type ClientMessage = {
    type: "input";
    data: string;
} | {
    type: "resize";
    rows: number;
    cols: number;
} | {
    type: "mouse";
    row: number;
    col: number;
    button: number;
    action: "down" | "up" | "move";
};
export type ServerMessage = {
    type: "output";
    data: string;
    revision?: number;
} | {
    type: "snapshot";
    state: TerminalState;
    revision?: number;
} | {
    type: "snapshotReady";
    revision?: number;
    replayPreamble?: string;
} | {
    type: "titleChange";
    title?: string;
};
export interface TerminalActivityTransition {
    activity: TerminalActivity | null;
    previous: TerminalActivity | null;
}
export interface TerminalSession {
    id: string;
    name: string;
    cwd: string;
    workspaceId: string;
    send(msg: ClientMessage): void;
    subscribe(listener: (msg: ServerMessage) => void, options?: TerminalSubscribeOptions): () => void;
    onExit(listener: (info: TerminalExitInfo) => void): () => void;
    onCommandFinished(listener: (info: TerminalCommandFinishedInfo) => void): () => void;
    onTitleChange(listener: (title?: string) => void): () => void;
    onActivityChange(listener: (transition: TerminalActivityTransition) => void): () => void;
    getSize(): {
        rows: number;
        cols: number;
    };
    getState(): TerminalState;
    getStateSnapshot(options?: TerminalStateSnapshotOptions): TerminalStateSnapshot;
    getReplayPreamble(): string;
    getTitle(): string | undefined;
    getActivity(): TerminalActivity | null;
    setActivity(state: TerminalActivityState): void;
    clearActivityAttention(): boolean;
    setTitle(title: string): void;
    getExitInfo(): TerminalExitInfo | null;
    kill(): void;
    killAndWait(options?: {
        gracefulTimeoutMs?: number;
        forceTimeoutMs?: number;
    }): Promise<void>;
}
export interface CreateTerminalOptions {
    id?: string;
    cwd: string;
    workspaceId: string;
    shell?: string;
    env?: Record<string, string>;
    activityEnv?: Record<string, string>;
    rows?: number;
    cols?: number;
    name?: string;
    title?: string;
    command?: string;
    args?: string[];
}
interface BuildTerminalEnvironmentInput {
    shell: string;
    env: Record<string, string>;
    zshShellIntegrationDir?: string;
    paseoCliBinDir?: string | null;
    paseoHookCliPath?: string | null;
}
interface EnsureNodePtySpawnHelperExecutableOptions {
    packageRoot?: string;
    platform?: NodeJS.Platform;
    arch?: string;
    force?: boolean;
}
export declare function ensureNodePtySpawnHelperExecutableForCurrentPlatform(options?: EnsureNodePtySpawnHelperExecutableOptions): void;
export declare function resolveDefaultTerminalShell(options?: {
    platform?: NodeJS.Platform;
    env?: NodeJS.ProcessEnv;
}): string;
export interface ResolvedTerminalCommand {
    command: string;
    args: string[] | string;
}
export interface ResolveTerminalSpawnCommandOptions {
    platform?: NodeJS.Platform;
    env?: Record<string, string | undefined>;
    resolveExecutable?: (name: string) => Promise<string | null>;
}
/**
 * Resolve a terminal profile command (e.g. `claude`) into something node-pty's
 * conpty backend can actually launch on Windows.
 *
 * On Windows, conpty's underlying `CreateProcess` does not apply `PATHEXT`, so a
 * bare `claude` (installed by npm as `claude.cmd`) fails with `error code: 2`
 * (`ERROR_FILE_NOT_FOUND`). Worse, conpty completes the spawn asynchronously on
 * its own conout worker thread, so that failure surfaces as an uncaught
 * exception that takes down the whole terminal worker process. Resolving the
 * real path up front — and routing `.cmd`/`.bat` shims through `cmd.exe /c`
 * (node-pty has no `shell` option) — keeps the profile launchable.
 *
 * Non-Windows and the default-shell path (no explicit command) are unchanged.
 */
export declare function resolveTerminalSpawnCommand(command: string, args: string[], options?: ResolveTerminalSpawnCommandOptions): Promise<ResolvedTerminalCommand>;
export declare function resolveZshShellIntegrationDir(): string;
export declare function resolvePaseoCliBinDir(): string | null;
export declare function resolvePaseoCliExecutablePath(): string | null;
export declare function buildTerminalEnvironment(input: BuildTerminalEnvironmentInput): Record<string, string>;
export declare function normalizeProcessTitle(processTitle: string): string | undefined;
export declare function humanizeProcessTitle(processTitle: string): string | undefined;
export declare function createTerminal(options: CreateTerminalOptions): Promise<TerminalSession>;
export {};
//# sourceMappingURL=terminal.d.ts.map