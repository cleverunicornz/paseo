import { TerminalStreamOpcode, encodeTerminalSnapshotPayload, encodeTerminalStreamFrame, } from "@getpaseo/protocol/binary-frames/index";
import { renderTerminalSnapshotToAnsi } from "@getpaseo/protocol/terminal-snapshot";
export const MAX_TERMINAL_OUTPUT_FRAME_BYTES = 256 * 1024;
// A client is only forced onto the snapshot catch-up path once its transport is
// genuinely backed up — measured by the socket's bufferedAmount, not by how much
// the terminal has produced. Set well above any normal in-flight burst (a
// keeping-up client drains continuously and never approaches this) but low
// enough that a stalled socket crosses it long before a large burst finishes.
export const MAX_CLIENT_BUFFERED_BYTES = 4 * 1024 * 1024;
const DEFAULT_VISIBLE_RESTORE_SCROLLBACK_LINES = 200;
const MAX_VISIBLE_RESTORE_SCROLLBACK_LINES = 500;
export function resolveTerminalSubscriptionSnapshotMode(restore) {
    return restore ? "ready" : "state";
}
export function resolveRestoreAfterOutputOverflow(restore) {
    if (restore?.mode === "live") {
        return { mode: "visible-snapshot" };
    }
    return restore;
}
export function resolveTerminalRestoreSnapshotOptions(restore) {
    if (restore.mode === "live") {
        return null;
    }
    if (restore.mode === "visible-snapshot") {
        return {
            scrollbackLines: resolveVisibleRestoreScrollbackLines(restore.scrollbackLines),
        };
    }
    return undefined;
}
export function encodeLegacyTerminalSnapshotFrame(input) {
    return encodeTerminalStreamFrame({
        opcode: TerminalStreamOpcode.Snapshot,
        slot: input.slot,
        payload: encodeTerminalSnapshotPayload(input.snapshot.state),
    });
}
export function encodeTerminalRestoreFrame(input) {
    return encodeTerminalStreamFrame({
        opcode: TerminalStreamOpcode.Restore,
        slot: input.slot,
        payload: renderTerminalSnapshotToAnsi(input.snapshot.state),
    });
}
function resolveVisibleRestoreScrollbackLines(value) {
    if (typeof value !== "number") {
        return DEFAULT_VISIBLE_RESTORE_SCROLLBACK_LINES;
    }
    return Math.min(Math.max(0, value), MAX_VISIBLE_RESTORE_SCROLLBACK_LINES);
}
//# sourceMappingURL=terminal-restore.js.map