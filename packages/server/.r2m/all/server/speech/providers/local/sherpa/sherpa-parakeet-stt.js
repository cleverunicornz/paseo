import { EventEmitter } from "node:events";
import { v4 as uuidv4 } from "uuid";
import { Pcm16MonoResampler } from "../../../../agent/pcm16-resampler.js";
import { parsePcm16MonoWav, parsePcmRateFromFormat, pcm16lePeakAbs, pcm16leToFloat32, } from "../../../audio.js";
export class SherpaOnnxParakeetSTT {
    constructor(config, logger) {
        this.id = "local";
        this.engine = config.engine;
        this.silencePeakThreshold = config.silencePeakThreshold ?? 300;
        this.logger = logger.child({ module: "speech", provider: "local", component: "parakeet-stt" });
    }
    createSession(params) {
        const emitter = new EventEmitter();
        const logger = params.logger.child({ provider: "local", component: "parakeet-stt-session" });
        const requiredSampleRate = this.engine.sampleRate;
        let connected = false;
        let segmentId = uuidv4();
        let previousSegmentId = null;
        let pcm16 = Buffer.alloc(0);
        return {
            requiredSampleRate,
            async connect() {
                connected = true;
            },
            appendPcm16(chunk) {
                if (!connected) {
                    emitter.emit("error", new Error("STT session not connected"));
                    return;
                }
                pcm16 = pcm16.length === 0 ? chunk : Buffer.concat([pcm16, chunk]);
            },
            commit: () => {
                if (!connected) {
                    emitter.emit("error", new Error("STT session not connected"));
                    return;
                }
                const committedId = segmentId;
                const prev = previousSegmentId;
                const committedPcm16 = pcm16;
                previousSegmentId = committedId;
                segmentId = uuidv4();
                pcm16 = Buffer.alloc(0);
                emitter.emit("committed", { segmentId: committedId, previousSegmentId: prev });
                void (async () => {
                    try {
                        const rt = await this.transcribeAudio(committedPcm16, `audio/pcm;rate=${requiredSampleRate}`);
                        emitter.emit("transcript", {
                            segmentId: committedId,
                            transcript: rt.text,
                            isFinal: true,
                            language: rt.language,
                            logprobs: rt.logprobs,
                            avgLogprob: rt.avgLogprob,
                            isLowConfidence: rt.isLowConfidence,
                        });
                    }
                    catch (err) {
                        emitter.emit("error", err);
                    }
                    finally {
                        logger.debug({ bytes: committedPcm16.length }, "Parakeet session reset");
                    }
                })();
            },
            clear() {
                pcm16 = Buffer.alloc(0);
                segmentId = uuidv4();
            },
            close() {
                connected = false;
                pcm16 = Buffer.alloc(0);
            },
            on(event, handler) {
                emitter.on(event, handler);
                return undefined;
            },
        };
    }
    async transcribeAudio(audioBuffer, format) {
        const start = Date.now();
        let inputRate;
        let pcm16;
        if (format.toLowerCase().includes("audio/wav")) {
            const parsed = parsePcm16MonoWav(audioBuffer);
            inputRate = parsed.sampleRate;
            pcm16 = parsed.pcm16;
        }
        else if (format.toLowerCase().includes("audio/pcm")) {
            inputRate = parsePcmRateFromFormat(format, this.engine.sampleRate) ?? this.engine.sampleRate;
            pcm16 = audioBuffer;
        }
        else {
            throw new Error(`Unsupported audio format for sherpa Parakeet STT: ${format}`);
        }
        const peak = pcm16lePeakAbs(pcm16);
        if (peak < this.silencePeakThreshold) {
            return { text: "", duration: Date.now() - start, isLowConfidence: true };
        }
        let pcmForModel = pcm16;
        if (inputRate !== this.engine.sampleRate) {
            const resampler = new Pcm16MonoResampler({ inputRate, outputRate: this.engine.sampleRate });
            pcmForModel = resampler.processChunk(pcm16);
            inputRate = this.engine.sampleRate;
        }
        const peakForModel = pcm16lePeakAbs(pcmForModel);
        const peakFloat = peakForModel / 32768.0;
        const targetPeak = 0.6;
        const maxGain = 50;
        const gain = peakFloat > 0 && peakFloat < targetPeak ? Math.min(maxGain, targetPeak / peakFloat) : 1;
        const stream = this.engine.createStream();
        try {
            const floatSamples = pcm16leToFloat32(pcmForModel, gain);
            this.engine.acceptWaveform(stream, inputRate, floatSamples);
            this.engine.recognizer.decode(stream);
            const result = this.engine.recognizer.getResult(stream);
            const text = String((typeof result === "object" && result && "text" in result ? result.text : undefined) ??
                result ??
                "").trim();
            const duration = Date.now() - start;
            this.logger.debug({ duration, textLength: text.length }, "Parakeet transcription complete");
            return { text, duration, ...(text.length === 0 ? { isLowConfidence: true } : {}) };
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
//# sourceMappingURL=sherpa-parakeet-stt.js.map