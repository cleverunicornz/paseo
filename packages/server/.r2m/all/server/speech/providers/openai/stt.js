import { EventEmitter } from "node:events";
import { OpenAI } from "openai";
import { writeFile, unlink } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { v4 } from "uuid";
import { inferAudioExtension } from "../../../agent/audio-utils.js";
function isObject(value) {
    return typeof value === "object" && value !== null;
}
function isLogprobToken(value) {
    if (!isObject(value)) {
        return false;
    }
    if (typeof value.token !== "string") {
        return false;
    }
    if (typeof value.logprob !== "number") {
        return false;
    }
    if (value.bytes === undefined) {
        return true;
    }
    return Array.isArray(value.bytes) && value.bytes.every((entry) => typeof entry === "number");
}
function isLogprobTokenArray(value) {
    return Array.isArray(value) && value.every((entry) => isLogprobToken(entry));
}
export class OpenAISTT {
    constructor(sttConfig, parentLogger) {
        this.id = "openai";
        this.config = sttConfig;
        this.logger = parentLogger.child({ module: "agent", provider: "openai", component: "stt" });
        this.openaiClient = new OpenAI({
            apiKey: sttConfig.apiKey,
            ...(sttConfig.baseUrl ? { baseURL: sttConfig.baseUrl } : {}),
        });
        this.logger.info({ model: sttConfig.model || "whisper-1" }, "STT (OpenAI Whisper) initialized");
    }
    createSession(params) {
        const emitter = new EventEmitter();
        const logger = params.logger.child({ provider: "openai", component: "stt-session" });
        const requiredSampleRate = 24000;
        let connected = false;
        let segmentId = v4();
        let previousSegmentId = null;
        let pcm16 = Buffer.alloc(0);
        const transcribeAudio = this.transcribeAudioInternal.bind(this);
        const convertPCMToWavBuffer = (pcmBuffer) => {
            const headerSize = 44;
            const channels = 1;
            const bitsPerSample = 16;
            const sampleRate = requiredSampleRate;
            const wavBuffer = Buffer.alloc(headerSize + pcmBuffer.length);
            const byteRate = (sampleRate * channels * bitsPerSample) / 8;
            const blockAlign = (channels * bitsPerSample) / 8;
            wavBuffer.write("RIFF", 0);
            wavBuffer.writeUInt32LE(36 + pcmBuffer.length, 4);
            wavBuffer.write("WAVE", 8);
            wavBuffer.write("fmt ", 12);
            wavBuffer.writeUInt32LE(16, 16);
            wavBuffer.writeUInt16LE(1, 20);
            wavBuffer.writeUInt16LE(channels, 22);
            wavBuffer.writeUInt32LE(sampleRate, 24);
            wavBuffer.writeUInt32LE(byteRate, 28);
            wavBuffer.writeUInt16LE(blockAlign, 32);
            wavBuffer.writeUInt16LE(bitsPerSample, 34);
            wavBuffer.write("data", 36);
            wavBuffer.writeUInt32LE(pcmBuffer.length, 40);
            pcmBuffer.copy(wavBuffer, 44);
            return wavBuffer;
        };
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
            commit() {
                if (!connected) {
                    emitter.emit("error", new Error("STT session not connected"));
                    return;
                }
                const committedId = segmentId;
                const prev = previousSegmentId;
                emitter.emit("committed", { segmentId: committedId, previousSegmentId: prev });
                void (async () => {
                    try {
                        if (pcm16.length === 0) {
                            emitter.emit("transcript", {
                                segmentId: committedId,
                                transcript: "",
                                isFinal: true,
                                language: params.language,
                                isLowConfidence: true,
                            });
                            return;
                        }
                        const wav = convertPCMToWavBuffer(pcm16);
                        const result = await transcribeAudio(wav, "audio/wav", params.language ?? "en", logger, params.prompt);
                        emitter.emit("transcript", {
                            segmentId: committedId,
                            transcript: result.text,
                            isFinal: true,
                            language: result.language,
                            logprobs: result.logprobs,
                            avgLogprob: result.avgLogprob,
                            isLowConfidence: result.isLowConfidence,
                        });
                    }
                    catch (err) {
                        emitter.emit("error", err);
                    }
                    finally {
                        previousSegmentId = committedId;
                        segmentId = v4();
                        pcm16 = Buffer.alloc(0);
                    }
                })();
            },
            clear() {
                pcm16 = Buffer.alloc(0);
                segmentId = v4();
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
    async transcribeAudioInternal(audioBuffer, format, language, logger, prompt) {
        const startTime = Date.now();
        let tempFilePath = null;
        try {
            const ext = inferAudioExtension(format);
            tempFilePath = join(tmpdir(), `audio-${v4()}.${ext}`);
            await writeFile(tempFilePath, audioBuffer);
            logger.debug({ tempFilePath, bytes: audioBuffer.length }, "Transcribing audio file");
            const modelToUse = this.config.model ?? "whisper-1";
            const supportsLogprobs = modelToUse === "gpt-4o-transcribe" || modelToUse === "gpt-4o-mini-transcribe";
            const includeLogprobs = ["logprobs"];
            const response = await this.openaiClient.audio.transcriptions.create({
                file: await import("fs").then((fs) => fs.createReadStream(tempFilePath)),
                language,
                model: modelToUse,
                ...(prompt ? { prompt } : {}),
                ...(supportsLogprobs ? { include: includeLogprobs } : {}),
                response_format: "json",
            });
            const duration = Date.now() - startTime;
            const confidenceThreshold = this.config.confidenceThreshold ?? -3.0;
            let avgLogprob;
            let isLowConfidence = false;
            const logprobs = supportsLogprobs && isObject(response) && isLogprobTokenArray(response.logprobs)
                ? response.logprobs
                : undefined;
            if (logprobs && logprobs.length > 0) {
                const totalLogprob = logprobs.reduce((sum, token) => sum + token.logprob, 0);
                avgLogprob = totalLogprob / logprobs.length;
                isLowConfidence = avgLogprob < confidenceThreshold;
                if (isLowConfidence) {
                    logger.debug({
                        avgLogprob,
                        threshold: confidenceThreshold,
                        text: response.text,
                        tokenLogprobs: logprobs.map((t) => `${t.token}:${t.logprob.toFixed(2)}`).join(", "),
                    }, "Low confidence transcription detected");
                }
            }
            logger.debug({ duration, text: response.text, avgLogprob }, "Transcription complete");
            return {
                text: response.text,
                duration: duration,
                logprobs: logprobs,
                avgLogprob: avgLogprob,
                isLowConfidence: isLowConfidence,
                language: isObject(response) && typeof response.language === "string"
                    ? response.language
                    : undefined,
            };
        }
        catch (error) {
            logger.error({ err: error }, "Transcription error");
            const message = error instanceof Error ? error.message : String(error);
            throw new Error(`STT transcription failed: ${message}`, { cause: error });
        }
        finally {
            if (tempFilePath) {
                try {
                    await unlink(tempFilePath);
                }
                catch {
                    logger.warn({ tempFilePath }, "Failed to clean up temp file");
                }
            }
        }
    }
}
//# sourceMappingURL=stt.js.map