import type { TerminalActivityAttentionReason, TerminalActivityState } from "@getpaseo/protocol/terminal-activity";
export interface TerminalActivitySnapshot {
    state: TerminalActivityState | null;
    attentionReason: TerminalActivityAttentionReason | null;
    changedAt: number;
}
export declare class TerminalActivityTracker {
    private resolvedState;
    private attentionReason;
    private changedAt;
    private readonly changeListeners;
    set(state: TerminalActivityState): void;
    clear(): void;
    clearAttention(): boolean;
    interrupt(): void;
    private setState;
    onChange(listener: (snapshot: TerminalActivitySnapshot, previous: TerminalActivitySnapshot) => void): () => void;
    getSnapshot(): TerminalActivitySnapshot;
    dispose(): void;
}
//# sourceMappingURL=terminal-activity-tracker.d.ts.map