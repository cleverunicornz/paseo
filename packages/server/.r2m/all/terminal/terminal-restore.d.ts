import type { SubscribeTerminalRequest } from "@getpaseo/protocol/messages";
import type { TerminalStateSnapshot, TerminalStateSnapshotOptions } from "./terminal.js";
export declare const MAX_TERMINAL_OUTPUT_FRAME_BYTES: number;
export declare const MAX_CLIENT_BUFFERED_BYTES: number;
export type TerminalRestoreOptions = NonNullable<SubscribeTerminalRequest["restore"]>;
export type TerminalSubscriptionSnapshotMode = "state" | "ready";
export declare function resolveTerminalSubscriptionSnapshotMode(restore: TerminalRestoreOptions | undefined): TerminalSubscriptionSnapshotMode;
export declare function resolveRestoreAfterOutputOverflow(restore: TerminalRestoreOptions | undefined): TerminalRestoreOptions | undefined;
export declare function resolveTerminalRestoreSnapshotOptions(restore: TerminalRestoreOptions): TerminalStateSnapshotOptions | null | undefined;
export declare function encodeLegacyTerminalSnapshotFrame(input: {
    slot: number;
    snapshot: TerminalStateSnapshot;
}): Uint8Array;
export declare function encodeTerminalRestoreFrame(input: {
    slot: number;
    snapshot: TerminalStateSnapshot;
}): Uint8Array;
//# sourceMappingURL=terminal-restore.d.ts.map