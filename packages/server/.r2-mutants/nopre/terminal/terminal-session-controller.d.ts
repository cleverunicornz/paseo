import type pino from "pino";
import type { SessionDelivery } from "../server/session/owned-subscriptions/index.js";
import type { SessionInboundMessage, SessionOutboundMessage } from "../server/messages.js";
import { type TerminalStreamFrame } from "@getpaseo/protocol/binary-frames/index";
import type { TerminalManager } from "./terminal-manager.js";
export interface TerminalSessionControllerOptions {
    terminalManager: TerminalManager | null;
    emit: (msg: SessionOutboundMessage) => void;
    hasBinaryChannel: () => boolean;
    isPathWithinRoot: (rootPath: string, candidatePath: string) => boolean;
    sessionLogger: pino.Logger;
    listTerminalWorkspaceRefs?: () => Promise<readonly TerminalWorkspaceRef[]>;
    listTerminalWorkspaceRoots?: () => Promise<readonly string[]>;
    clientSupportsWrapReflow?: (source: object) => boolean;
    getClientBufferedAmount?: (source: object) => number | null;
}
interface TerminalWorkspaceRef {
    workspaceId: string;
    cwd: string;
}
export interface TerminalSessionControllerMetrics {
    directorySubscriptionCount: number;
    streamSubscriptionCount: number;
}
export declare class TerminalSessionController {
    private readonly terminalManager;
    private readonly emit;
    private readonly hasBinaryChannel;
    private readonly isPathWithinRoot;
    private readonly sessionLogger;
    private readonly listTerminalWorkspaceRefs;
    private readonly listTerminalWorkspaceRoots;
    private readonly clientSupportsWrapReflow;
    private readonly getClientBufferedAmount;
    private readonly subscribedDirectories;
    private unsubscribeTerminalsChanged;
    private readonly activeStreams;
    private nextSlot;
    constructor(options: TerminalSessionControllerOptions);
    start(): void;
    getMetrics(): TerminalSessionControllerMetrics;
    hasDirectorySubscription(input: {
        cwd: string;
        workspaceId?: string;
    }, source?: object): Promise<boolean>;
    dispatch(msg: SessionInboundMessage, ownership: SessionDelivery): Promise<void> | undefined;
    handleBinaryFrame(frame: TerminalStreamFrame, source: object): void;
    killTerminalForClose(terminalId: string): {
        terminalId: string;
        success: boolean;
    };
    killTerminalsForWorkspace(workspaceId: string): Promise<void>;
    dispose(): void;
    private toTerminalInfo;
    private handleTerminalsChanged;
    private handleSubscribeTerminalsRequest;
    private emitTerminalsSnapshotForSubscription;
    private handleListTerminalsRequest;
    private getAllTerminalSessions;
    private getTerminalsForWorkspaceRoot;
    private terminalBelongsToRoot;
    private resolveTerminalOwnerRoot;
    private isSamePath;
    private handleCreateTerminalRequest;
    private resolveLegacyTerminalWorkspaceId;
    private handleRenameTerminalRequest;
    private handleSubscribeTerminalRequest;
    private handleTerminalInput;
    private killTracked;
    private handleKillTerminalRequest;
    private handleCaptureTerminalRequest;
    private bindActiveStream;
    private trySendSnapshot;
    private sendSnapshot;
    private emitLegacySnapshot;
    private emitRestoreSnapshot;
    private replayTerminalOutputAfterSnapshot;
    private allocateSlot;
    private detachStream;
    private completeStream;
    private detachRegistration;
}
export {};
//# sourceMappingURL=terminal-session-controller.d.ts.map