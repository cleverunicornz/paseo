import { toResolver } from "../speech/provider-resolver.js";
import { maybePersistDebugAudio } from "./stt-debug.js";
import { parsePcm16MonoWav, parsePcmRateFromFormat } from "../speech/audio.js";
import { Pcm16MonoResampler } from "./pcm16-resampler.js";
const BATCH_APPEND_CHUNK_SECONDS = 1;
const DEFAULT_BATCH_COMMIT_EVERY_SECONDS = 15;
const BATCH_FINAL_TIMEOUT_MS = 120000;
function assembleTranscriptionResult(params) {
    const { committedSegmentIds, transcriptsBySegmentId, finalTranscriptSegmentIds, transcriptMetaBySegmentId, durationMs, } = params;
    const committedSet = new Set(committedSegmentIds);
    const orderedSegmentIds = [...committedSegmentIds];
    for (const segmentId of transcriptsBySegmentId.keys()) {
        if (!committedSet.has(segmentId)) {
            orderedSegmentIds.push(segmentId);
        }
    }
    const transcript = orderedSegmentIds
        .map((segmentId) => transcriptsBySegmentId.get(segmentId) ?? "")
        .join(" ")
        .trim();
    const orderedFinalMeta = orderedSegmentIds
        .filter((segmentId) => finalTranscriptSegmentIds.has(segmentId))
        .map((segmentId) => transcriptMetaBySegmentId.get(segmentId))
        .filter((meta) => Boolean(meta));
    const language = orderedFinalMeta.find((meta) => meta.language)?.language;
    const singleSegmentMeta = orderedFinalMeta.length === 1 ? orderedFinalMeta[0] : null;
    const allLowConfidence = orderedFinalMeta.length > 0 && orderedFinalMeta.every((meta) => meta.isLowConfidence === true);
    return {
        text: transcript,
        ...(language ? { language } : {}),
        ...(singleSegmentMeta?.logprobs ? { logprobs: singleSegmentMeta.logprobs } : {}),
        ...(singleSegmentMeta?.avgLogprob !== undefined
            ? { avgLogprob: singleSegmentMeta.avgLogprob }
            : {}),
        ...(allLowConfidence ? { isLowConfidence: true } : {}),
        duration: durationMs,
    };
}
function preparePcmForModel(audio, format, requiredSampleRate) {
    let inputRate;
    let pcm16;
    if (format.toLowerCase().includes("audio/wav")) {
        const parsed = parsePcm16MonoWav(audio);
        inputRate = parsed.sampleRate;
        pcm16 = parsed.pcm16;
    }
    else if (format.toLowerCase().includes("audio/pcm")) {
        inputRate = parsePcmRateFromFormat(format, requiredSampleRate) ?? requiredSampleRate;
        pcm16 = audio;
    }
    else {
        throw new Error(`Unsupported audio format for STT: ${format}`);
    }
    if (inputRate === requiredSampleRate) {
        return pcm16;
    }
    const resampler = new Pcm16MonoResampler({
        inputRate,
        outputRate: requiredSampleRate,
    });
    return resampler.processChunk(pcm16);
}
function resolveBatchCommitEverySeconds() {
    const fromEnv = process.env.PASEO_STT_BATCH_COMMIT_EVERY_SECONDS;
    if (!fromEnv) {
        return DEFAULT_BATCH_COMMIT_EVERY_SECONDS;
    }
    const parsed = Number.parseFloat(fromEnv);
    if (!Number.isFinite(parsed) || parsed < 0) {
        return DEFAULT_BATCH_COMMIT_EVERY_SECONDS;
    }
    return parsed;
}
/**
 * Per-session STT manager
 * Handles speech-to-text transcription
 */
export class STTManager {
    constructor(sessionId, logger, stt, options) {
        this.sessionId = sessionId;
        this.logger = logger.child({ module: "agent", component: "stt-manager", sessionId });
        this.resolveStt = toResolver(stt);
        this.language = options?.language ?? "en";
    }
    getProvider() {
        return this.resolveStt();
    }
    /**
     * Transcribe audio buffer to text
     */
    async transcribe(audio, format, metadata) {
        const stt = this.resolveStt();
        if (!stt) {
            throw new Error("STT not configured");
        }
        this.logger.debug({ bytes: audio.length, format, label: metadata?.label }, "Transcribing audio");
        let debugRecordingPath = null;
        try {
            debugRecordingPath = await maybePersistDebugAudio(audio, {
                sessionId: this.sessionId,
                agentId: metadata?.agentId,
                requestId: metadata?.requestId,
                label: metadata?.label,
                format,
            }, this.logger);
        }
        catch (error) {
            this.logger.warn({ err: error }, "Failed to persist debug audio");
        }
        const session = stt.createSession({
            logger: this.logger.child({ component: "stt-session" }),
            language: this.language,
        });
        const pcmForModel = preparePcmForModel(audio, format, session.requiredSampleRate);
        try {
            const startedAt = Date.now();
            await session.connect();
            const committedSegmentIds = [];
            const transcriptsBySegmentId = new Map();
            const finalTranscriptSegmentIds = new Set();
            const transcriptMetaBySegmentId = new Map();
            let expectedFinals = 0;
            let settle = null;
            let fail = null;
            let settled = false;
            const allFinalsReady = new Promise((resolve, reject) => {
                settle = resolve;
                fail = reject;
            });
            const resolveIfComplete = () => {
                if (settled) {
                    return;
                }
                if (expectedFinals > 0 && finalTranscriptSegmentIds.size >= expectedFinals) {
                    settled = true;
                    settle?.();
                    return;
                }
                if (expectedFinals === 0 && finalTranscriptSegmentIds.size > 0) {
                    settled = true;
                    settle?.();
                }
            };
            const rejectWith = (error) => {
                if (settled) {
                    return;
                }
                settled = true;
                fail?.(error);
            };
            session.on("error", (error) => {
                rejectWith(error instanceof Error ? error : new Error(String(error)));
            });
            session.on("committed", ({ segmentId }) => {
                committedSegmentIds.push(segmentId);
                expectedFinals += 1;
                resolveIfComplete();
            });
            session.on("transcript", (payload) => {
                transcriptsBySegmentId.set(payload.segmentId, payload.transcript);
                if (!payload.isFinal) {
                    return;
                }
                finalTranscriptSegmentIds.add(payload.segmentId);
                transcriptMetaBySegmentId.set(payload.segmentId, {
                    language: payload.language,
                    logprobs: payload.logprobs,
                    avgLogprob: payload.avgLogprob,
                    isLowConfidence: payload.isLowConfidence,
                });
                resolveIfComplete();
            });
            const appendChunkBytes = Math.max(1, Math.round(session.requiredSampleRate * 2 * BATCH_APPEND_CHUNK_SECONDS));
            const commitEverySeconds = resolveBatchCommitEverySeconds();
            const commitEveryBytes = commitEverySeconds > 0
                ? Math.max(1, Math.round(session.requiredSampleRate * 2 * commitEverySeconds))
                : 0;
            let bytesSinceCommit = 0;
            for (let offset = 0; offset < pcmForModel.length; offset += appendChunkBytes) {
                const chunk = pcmForModel.subarray(offset, Math.min(pcmForModel.length, offset + appendChunkBytes));
                if (chunk.length === 0) {
                    continue;
                }
                session.appendPcm16(chunk);
                bytesSinceCommit += chunk.length;
                if (commitEveryBytes > 0 && bytesSinceCommit >= commitEveryBytes) {
                    session.commit();
                    bytesSinceCommit = 0;
                }
            }
            if (bytesSinceCommit > 0 || expectedFinals === 0) {
                session.commit();
            }
            const finalTimeout = setTimeout(() => {
                if (settled) {
                    return;
                }
                settled = true;
                this.logger.warn({
                    expectedFinals,
                    receivedFinals: finalTranscriptSegmentIds.size,
                    label: metadata?.label,
                }, "Timed out waiting for final STT segments; returning available transcripts");
                settle?.();
            }, BATCH_FINAL_TIMEOUT_MS);
            await allFinalsReady;
            clearTimeout(finalTimeout);
            const result = assembleTranscriptionResult({
                committedSegmentIds,
                transcriptsBySegmentId,
                finalTranscriptSegmentIds,
                transcriptMetaBySegmentId,
                durationMs: Date.now() - startedAt,
            });
            // Filter out low-confidence transcriptions (non-speech sounds)
            if (result.isLowConfidence) {
                this.logger.debug({ text: result.text, avgLogprob: result.avgLogprob }, "Filtered low-confidence transcription (likely non-speech)");
                // Return empty text to ignore this transcription
                return {
                    ...result,
                    text: "",
                    byteLength: audio.length,
                    format,
                    debugRecordingPath: debugRecordingPath ?? undefined,
                };
            }
            this.logger.debug({ text: result.text, avgLogprob: result.avgLogprob }, "Transcription complete");
            return {
                ...result,
                debugRecordingPath: debugRecordingPath ?? undefined,
                byteLength: audio.length,
                format,
            };
        }
        finally {
            session.close();
        }
    }
    /**
     * Cleanup (currently no-op, but provides extension point)
     */
    cleanup() {
        // No cleanup needed for STT currently
    }
}
//# sourceMappingURL=stt-manager.js.map