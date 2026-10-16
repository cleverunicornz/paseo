import { EventEmitter } from "node:events";
import { v4 as uuidv4 } from "uuid";
import { pcm16lePeakAbs, pcm16leToFloat32 } from "../../../audio.js";
export class SherpaParakeetRealtimeTranscriptionSession extends EventEmitter {
    constructor(params) {
        super();
        this.connected = false;
        this.currentSegmentId = null;
        this.previousSegmentId = null;
        this.lastPartialText = "";
        this.pcm16 = Buffer.alloc(0);
        this.lastDecodeAt = 0;
        this.decoding = false;
        this.pendingDecode = false;
        this.engine = params.engine;
        this.requiredSampleRate = this.engine.sampleRate;
        this.minDecodeIntervalMs = params.minDecodeIntervalMs ?? 350;
    }
    async connect() {
        if (this.connected) {
            return;
        }
        this.currentSegmentId = uuidv4();
        this.connected = true;
    }
    appendPcm16(chunk) {
        if (!this.connected || !this.currentSegmentId) {
            this.emit("error", new Error("Parakeet realtime session not connected"));
            return;
        }
        try {
            this.pcm16 = this.pcm16.length === 0 ? chunk : Buffer.concat([this.pcm16, chunk]);
            void this.maybeDecode(false);
        }
        catch (err) {
            this.emit("error", err instanceof Error ? err : new Error(String(err)));
        }
    }
    commit() {
        if (!this.connected || !this.currentSegmentId) {
            this.emit("error", new Error("Parakeet realtime session not connected"));
            return;
        }
        void (async () => {
            try {
                await this.maybeDecode(true);
                const finalText = this.lastPartialText;
                const segmentId = this.currentSegmentId;
                const previousSegmentId = this.previousSegmentId;
                this.emit("committed", { segmentId, previousSegmentId });
                this.emit("transcript", { segmentId, transcript: finalText, isFinal: true });
                this.previousSegmentId = segmentId;
                this.currentSegmentId = uuidv4();
                this.lastPartialText = "";
                this.pcm16 = Buffer.alloc(0);
            }
            catch (err) {
                this.emit("error", err instanceof Error ? err : new Error(String(err)));
            }
        })();
    }
    clear() {
        if (!this.connected) {
            return;
        }
        this.pcm16 = Buffer.alloc(0);
        this.currentSegmentId = uuidv4();
        this.lastPartialText = "";
    }
    close() {
        this.connected = false;
        this.currentSegmentId = null;
        this.pcm16 = Buffer.alloc(0);
    }
    async maybeDecode(force) {
        if (!this.connected || !this.currentSegmentId) {
            return;
        }
        const now = Date.now();
        if (!force && now - this.lastDecodeAt < this.minDecodeIntervalMs) {
            return;
        }
        if (this.decoding) {
            this.pendingDecode = true;
            return;
        }
        this.decoding = true;
        try {
            const text = await this.decodeNow();
            this.lastDecodeAt = Date.now();
            if (text !== this.lastPartialText) {
                this.lastPartialText = text;
                this.emit("transcript", {
                    segmentId: this.currentSegmentId,
                    transcript: text,
                    isFinal: false,
                });
            }
        }
        finally {
            this.decoding = false;
            if (this.pendingDecode) {
                this.pendingDecode = false;
                await this.maybeDecode(true);
            }
        }
    }
    async decodeNow() {
        if (this.pcm16.length === 0) {
            return "";
        }
        const peak = pcm16lePeakAbs(this.pcm16);
        const peakFloat = peak / 32768.0;
        const targetPeak = 0.6;
        const maxGain = 50;
        const gain = peakFloat > 0 && peakFloat < targetPeak ? Math.min(maxGain, targetPeak / peakFloat) : 1;
        const stream = this.engine.createStream();
        try {
            const floatSamples = pcm16leToFloat32(this.pcm16, gain);
            this.engine.acceptWaveform(stream, this.engine.sampleRate, floatSamples);
            this.engine.recognizer.decode(stream);
            const result = this.engine.recognizer.getResult(stream);
            return String((typeof result === "object" && result && "text" in result ? result.text : undefined) ??
                result ??
                "").trim();
        }
        finally {
            try {
                stream.free?.();
            }
            catch {
                // ignore
            }
        }
    }
}
//# sourceMappingURL=sherpa-parakeet-realtime-session.js.map