export class TerminalActivityTracker {
    constructor() {
        // unknown != idle: a plain shell, or a terminal whose agent was killed, has no dot or rollup.
        this.resolvedState = null;
        this.attentionReason = null;
        this.changedAt = Date.now();
        this.changeListeners = new Set();
    }
    set(state) {
        if (state === "idle" && this.resolvedState === "working") {
            this.setState("idle", "finished");
            return;
        }
        if (state === "idle" && this.attentionReason === "finished") {
            return;
        }
        this.setState(state === "attention" ? "idle" : state, state === "attention" ? "needs_input" : null);
    }
    clear() {
        this.setState(null, null);
    }
    clearAttention() {
        if (!this.attentionReason) {
            return false;
        }
        this.setState("idle", null);
        return true;
    }
    interrupt() {
        if (this.resolvedState !== "working") {
            return;
        }
        this.setState(null, null);
    }
    setState(state, attentionReason) {
        if (state === this.resolvedState && attentionReason === this.attentionReason) {
            return;
        }
        const previous = this.getSnapshot();
        this.resolvedState = state;
        this.attentionReason = attentionReason;
        this.changedAt = Date.now();
        const snapshot = this.getSnapshot();
        for (const listener of Array.from(this.changeListeners)) {
            listener(snapshot, previous);
        }
    }
    onChange(listener) {
        this.changeListeners.add(listener);
        return () => {
            this.changeListeners.delete(listener);
        };
    }
    getSnapshot() {
        return {
            state: this.resolvedState,
            attentionReason: this.attentionReason,
            changedAt: this.changedAt,
        };
    }
    dispose() {
        this.changeListeners.clear();
    }
}
//# sourceMappingURL=terminal-activity-tracker.js.map