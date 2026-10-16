const DEFAULT_FLUSH_DELAY_MS = 5;
export class TerminalOutputCoalescer {
    constructor(options) {
        this.chunks = [];
        this.bytes = 0;
        this.chars = 0;
        this.flushTimer = null;
        this.lastFlushAt = null;
        this.timers = options.timers;
        this.flushDelayMs = options.flushDelayMs ?? DEFAULT_FLUSH_DELAY_MS;
        this.now = options.now ?? Date.now;
        this.onFlush = options.onFlush;
    }
    handle(data) {
        if (data.length === 0) {
            return;
        }
        const chunk = Buffer.from(data, "utf8");
        this.chunks.push(chunk);
        this.bytes += chunk.byteLength;
        this.chars += data.length;
        // Leading edge: if nothing is pending and no flush happened within the last
        // flushDelayMs, flush immediately so interactive echo isn't delayed a full
        // window. Otherwise accumulate and let the trailing timer drain the burst.
        if (!this.flushTimer) {
            const elapsed = this.lastFlushAt === null ? Number.POSITIVE_INFINITY : this.now() - this.lastFlushAt;
            if (elapsed >= this.flushDelayMs) {
                this.flush();
                return;
            }
            this.flushTimer = this.timers.setTimeout(() => {
                this.flushTimer = null;
                this.flush();
            }, this.flushDelayMs);
        }
    }
    flush() {
        this.clearTimer();
        if (this.chunks.length === 0) {
            return;
        }
        const payload = this.chunks.length === 1 ? this.chunks[0] : Buffer.concat(this.chunks, this.bytes);
        const bytes = this.bytes;
        const chars = this.chars;
        this.clearPending();
        this.lastFlushAt = this.now();
        this.onFlush({ payload, bytes, chars });
    }
    // Record that a frame was emitted out-of-band on this stream (e.g. a snapshot
    // frame sent directly, bypassing the coalescer). This keeps the next handled
    // chunk on the trailing path instead of leading-edge flushing it back-to-back
    // with that frame, preserving the small gap consumers rely on after a snapshot.
    markFlushed() {
        this.lastFlushAt = this.now();
    }
    dispose() {
        this.clearTimer();
        this.clearPending();
    }
    clearTimer() {
        if (!this.flushTimer) {
            return;
        }
        this.timers.clearTimeout(this.flushTimer);
        this.flushTimer = null;
    }
    clearPending() {
        this.chunks = [];
        this.bytes = 0;
        this.chars = 0;
    }
}
//# sourceMappingURL=terminal-output-coalescer.js.map