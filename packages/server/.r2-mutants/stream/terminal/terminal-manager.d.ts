import { type TerminalSession, type TerminalStateSnapshot, type TerminalStateSnapshotOptions } from "./terminal.js";
import { type CaptureTerminalLinesResult } from "./terminal-capture.js";
import type { TerminalActivity, TerminalActivityState } from "@getpaseo/protocol/terminal-activity";
export interface TerminalListItem {
    id: string;
    name: string;
    cwd: string;
    workspaceId: string;
    title?: string;
    activity: TerminalActivity | null;
}
export interface TerminalsChangedEvent {
    cwd: string;
    terminals: TerminalListItem[];
}
export type TerminalsChangedListener = (input: TerminalsChangedEvent) => void;
export interface TerminalActivityTransitionEvent {
    terminalId: string;
    name: string;
    cwd: string;
    workspaceId: string;
    activity: TerminalActivity | null;
    previous: TerminalActivity | null;
}
export type TerminalActivityListener = (event: TerminalActivityTransitionEvent) => void;
export interface TerminalWorkspaceContributionChangedEvent {
    terminalId: string;
    cwd: string;
    workspaceId: string;
}
export type TerminalWorkspaceContributionChangedListener = (event: TerminalWorkspaceContributionChangedEvent) => void;
export interface TerminalManager {
    getTerminals(cwd: string, options?: {
        workspaceId?: string;
    }): Promise<TerminalSession[]>;
    createTerminal(options: {
        id?: string;
        cwd: string;
        workspaceId: string;
        name?: string;
        title?: string;
        env?: Record<string, string>;
        command?: string;
        args?: string[];
        rows?: number;
        cols?: number;
        activityToken?: string;
        activityUrl?: string | null;
    }): Promise<TerminalSession>;
    registerCwdEnv(options: {
        cwd: string;
        env: Record<string, string>;
    }): void;
    validateTerminalActivityToken(terminalId: string, token: string): "valid" | "unknown" | "invalid";
    getTerminal(id: string): TerminalSession | undefined;
    getTerminalState(id: string, options?: TerminalStateSnapshotOptions): Promise<TerminalStateSnapshot | null>;
    setTerminalTitle(id: string, title: string): boolean;
    setTerminalActivity(id: string, state: TerminalActivityState): Promise<boolean>;
    clearTerminalAttention(id: string): Promise<boolean>;
    killTerminal(id: string): void;
    killTerminalAndWait(id: string, options?: {
        gracefulTimeoutMs?: number;
        forceTimeoutMs?: number;
    }): Promise<void>;
    captureTerminal(id: string, options?: {
        start?: number;
        end?: number;
        stripAnsi?: boolean;
    }): Promise<CaptureTerminalLinesResult>;
    listDirectories(): string[];
    killAll(): void;
    subscribeTerminalsChanged(listener: TerminalsChangedListener): () => void;
    subscribeTerminalActivity(listener: TerminalActivityListener): () => void;
    subscribeTerminalWorkspaceContributionChanged(listener: TerminalWorkspaceContributionChangedListener): () => void;
}
export interface TerminalManagerOptions {
    getTerminalActivityUrl?: () => string | null;
}
export declare function createTerminalManager(managerOptions?: TerminalManagerOptions): TerminalManager;
//# sourceMappingURL=terminal-manager.d.ts.map