import { v4 as uuidv4 } from "uuid";
import { z } from "zod";
import { getErrorMessage } from "@getpaseo/protocol/error-utils";
import { TTSManager } from "../../agent/tts-manager.js";
import { STTManager } from "../../agent/stt-manager.js";
import { maybePersistTtsDebugAudio } from "../../agent/tts-debug.js";
import { isPaseoDictationDebugEnabled } from "../../agent/recordings-debug.js";
import { DictationStreamManager, } from "../../dictation/dictation-stream-manager.js";
import { createVoiceTurnController } from "./voice-turn-controller.js";
import { buildVoiceModeSystemPrompt, stripVoiceModeSystemPrompt } from "../../voice-config.js";
import { toResolver } from "../../speech/provider-resolver.js";
const PCM_SAMPLE_RATE = 16000;
const PCM_CHANNELS = 1;
const PCM_BITS_PER_SAMPLE = 16;
const PCM_BYTES_PER_MS = (PCM_SAMPLE_RATE * PCM_CHANNELS * (PCM_BITS_PER_SAMPLE / 8)) / 1000;
const MIN_STREAMING_SEGMENT_DURATION_MS = 1000;
const MIN_STREAMING_SEGMENT_BYTES = Math.round(PCM_BYTES_PER_MS * MIN_STREAMING_SEGMENT_DURATION_MS);
const AgentIdSchema = z.guid();
class VoiceFeatureUnavailableError extends Error {
    constructor(context) {
        super(context.message);
        this.name = "VoiceFeatureUnavailableError";
        this.reasonCode = context.reasonCode;
        this.retryable = context.retryable;
        this.missingModelIds = [...context.missingModelIds];
    }
}
function convertPCMToWavBuffer(pcmBuffer, sampleRate, channels, bitsPerSample) {
    const headerSize = 44;
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
}
/**
 * Owns the voice half of a client session: speech-to-text/text-to-speech
 * managers, dictation streaming, the barge-in audio-buffering state machine,
 * voice-turn detection, and the MCP voice bridge. The session delegates the
 * voice/dictation/abort message types here and otherwise knows nothing about
 * audio buffering or processing phases.
 */
export class VoiceSession {
    constructor(options) {
        this.closed = false;
        this.processingPhase = "idle";
        this.isVoiceMode = false;
        this.speechInProgress = false;
        this.voiceTurnController = null;
        this.voiceInputChunkCount = 0;
        this.voiceInputBytes = 0;
        this.voiceInputWindowStartedAt = Date.now();
        // Audio buffering for interruption handling
        this.pendingAudioSegments = [];
        this.bufferTimeout = null;
        this.audioBuffer = null;
        // Optional TTS debug capture (persisted per utterance)
        this.ttsDebugStreams = new Map();
        this.voiceModeAgentId = null;
        this.voiceModeBaseConfig = null;
        const { host, logger, sessionId, sttLanguage, tts, stt, voice, voiceBridge, dictation } = options;
        this.host = host;
        this.onIdle = options.onIdle;
        this.sessionLogger = logger;
        this.sessionId = sessionId;
        this.sttLanguage = sttLanguage ?? "en";
        this.abortController = new AbortController();
        this.resolveVoiceTurnDetection = toResolver(voice?.turnDetection ?? null);
        this.registerVoiceSpeakHandler = voiceBridge?.registerVoiceSpeakHandler;
        this.unregisterVoiceSpeakHandler = voiceBridge?.unregisterVoiceSpeakHandler;
        this.registerVoiceCallerContext = voiceBridge?.registerVoiceCallerContext;
        this.unregisterVoiceCallerContext = voiceBridge?.unregisterVoiceCallerContext;
        this.getSpeechReadiness = dictation?.getSpeechReadiness;
        this.ttsManager = new TTSManager(this.sessionId, this.sessionLogger, tts);
        this.sttManager = new STTManager(this.sessionId, this.sessionLogger, stt, {
            language: sttLanguage,
        });
        this.dictationStreamManager = new DictationStreamManager({
            logger: this.sessionLogger,
            sessionId: this.sessionId,
            emit: (msg) => this.handleDictationManagerMessage(msg),
            stt: dictation?.stt ?? null,
            language: dictation?.sttLanguage,
            finalTimeoutMs: dictation?.finalTimeoutMs,
            onIdle: this.onIdle,
        });
    }
    get hasDemand() {
        return (this.isVoiceMode ||
            this.dictationStreamManager.hasDemand ||
            this.processingPhase !== "idle" ||
            this.audioBuffer !== null ||
            this.pendingAudioSegments.length > 0);
    }
    isActiveForAgent(agentId) {
        return this.isVoiceMode && this.voiceModeAgentId === agentId;
    }
    handleDictationChunk(params) {
        return this.dictationStreamManager.handleChunk(params);
    }
    handleDictationFinish(dictationId, finalSeq) {
        return this.dictationStreamManager.handleFinish(dictationId, finalSeq);
    }
    handleDictationCancel(dictationId) {
        this.dictationStreamManager.handleCancel(dictationId);
    }
    async handleDictationStreamStart(msg) {
        const unavailable = this.resolveVoiceFeatureUnavailableContext("dictation");
        if (unavailable) {
            this.emit({
                type: "dictation_stream_error",
                payload: {
                    dictationId: msg.dictationId,
                    error: unavailable.message,
                    retryable: unavailable.retryable,
                    reasonCode: unavailable.reasonCode,
                    missingModelIds: unavailable.missingModelIds,
                },
            });
            return;
        }
        await this.dictationStreamManager.handleStart(msg.dictationId, msg.format);
    }
    toVoiceFeatureUnavailableContext(state) {
        return {
            reasonCode: state.reasonCode,
            message: state.message,
            retryable: state.retryable,
            missingModelIds: [...state.missingModelIds],
        };
    }
    resolveModeReadinessState(readiness, mode) {
        if (mode === "voice_mode") {
            return readiness.realtimeVoice;
        }
        return readiness.dictation;
    }
    getVoiceFeatureUnavailableResponseMetadata(error) {
        if (!(error instanceof VoiceFeatureUnavailableError)) {
            return {};
        }
        return {
            reasonCode: error.reasonCode,
            retryable: error.retryable,
            missingModelIds: error.missingModelIds,
        };
    }
    resolveVoiceFeatureUnavailableContext(mode) {
        const readiness = this.getSpeechReadiness?.();
        if (!readiness) {
            return null;
        }
        const modeReadiness = this.resolveModeReadinessState(readiness, mode);
        if (!modeReadiness.enabled) {
            return this.toVoiceFeatureUnavailableContext(modeReadiness);
        }
        if (!readiness.voiceFeature.available) {
            return this.toVoiceFeatureUnavailableContext(readiness.voiceFeature);
        }
        if (!modeReadiness.available) {
            return this.toVoiceFeatureUnavailableContext(modeReadiness);
        }
        return null;
    }
    /**
     * Handle voice mode toggle
     */
    async handleSetVoiceMode(enabled, agentId, requestId) {
        const startedAt = Date.now();
        try {
            this.sessionLogger.info({ enabled, requestedAgentId: agentId ?? null, requestId: requestId ?? null }, "set_voice_mode started");
            if (enabled) {
                const unavailable = this.resolveVoiceFeatureUnavailableContext("voice_mode");
                if (unavailable) {
                    throw new VoiceFeatureUnavailableError(unavailable);
                }
                const normalizedAgentId = this.parseVoiceTargetAgentId(agentId ?? "", "set_voice_mode");
                if (this.isVoiceMode &&
                    this.voiceModeAgentId &&
                    this.voiceModeAgentId !== normalizedAgentId) {
                    this.sessionLogger.info({
                        previousAgentId: this.voiceModeAgentId,
                        nextAgentId: normalizedAgentId,
                        elapsedMs: Date.now() - startedAt,
                    }, "set_voice_mode disabling previous active voice agent");
                    await this.disableVoiceModeForActiveAgent(true);
                }
                if (!this.isVoiceMode || this.voiceModeAgentId !== normalizedAgentId) {
                    this.sessionLogger.info({ agentId: normalizedAgentId, elapsedMs: Date.now() - startedAt }, "set_voice_mode enabling voice for agent");
                    const refreshedAgentId = await this.enableVoiceModeForAgent(normalizedAgentId);
                    this.voiceModeAgentId = refreshedAgentId;
                    if (this.closed) {
                        await this.disableVoiceModeForActiveAgent(true);
                        return;
                    }
                    this.sessionLogger.info({ agentId: refreshedAgentId, elapsedMs: Date.now() - startedAt }, "set_voice_mode agent enable complete");
                }
                this.sessionLogger.info({ agentId: this.voiceModeAgentId, elapsedMs: Date.now() - startedAt }, "set_voice_mode starting voice turn controller");
                await this.startVoiceTurnController();
                this.sessionLogger.info({ agentId: this.voiceModeAgentId, elapsedMs: Date.now() - startedAt }, "set_voice_mode voice turn controller started");
                this.isVoiceMode = !this.closed;
                this.sessionLogger.info({
                    agentId: this.voiceModeAgentId,
                    elapsedMs: Date.now() - startedAt,
                }, "Voice mode enabled for existing agent");
                if (requestId) {
                    this.emit({
                        type: "set_voice_mode_response",
                        payload: {
                            requestId,
                            enabled: true,
                            agentId: this.voiceModeAgentId,
                            accepted: true,
                            error: null,
                        },
                    });
                }
                return;
            }
            this.sessionLogger.info({ agentId: this.voiceModeAgentId, elapsedMs: Date.now() - startedAt }, "set_voice_mode disabling active voice mode");
            await this.disableVoiceModeForActiveAgent(true);
            this.isVoiceMode = false;
            this.sessionLogger.info({ elapsedMs: Date.now() - startedAt }, "Voice mode disabled");
            if (requestId) {
                this.emit({
                    type: "set_voice_mode_response",
                    payload: {
                        requestId,
                        enabled: false,
                        agentId: null,
                        accepted: true,
                        error: null,
                    },
                });
            }
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : "Failed to set voice mode";
            const unavailable = this.getVoiceFeatureUnavailableResponseMetadata(error);
            this.sessionLogger.error({
                err: error,
                enabled,
                requestedAgentId: agentId ?? null,
                elapsedMs: Date.now() - startedAt,
            }, "set_voice_mode failed");
            if (requestId) {
                this.emit({
                    type: "set_voice_mode_response",
                    payload: {
                        requestId,
                        enabled: this.isVoiceMode,
                        agentId: this.voiceModeAgentId,
                        accepted: false,
                        error: errorMessage,
                        ...unavailable,
                    },
                });
                return;
            }
            throw error;
        }
    }
    parseVoiceTargetAgentId(rawId, source) {
        const parsed = AgentIdSchema.safeParse(rawId.trim());
        if (!parsed.success) {
            throw new Error(`${source}: agentId must be a UUID`);
        }
        return parsed.data;
    }
    async enableVoiceModeForAgent(agentId) {
        const startedAt = Date.now();
        this.sessionLogger.info({ agentId }, "enableVoiceModeForAgent.ensureAgentLoaded.start");
        const existing = await this.host.loadAgent(agentId);
        if (this.closed)
            throw new Error("Voice source is closed");
        this.sessionLogger.info({ agentId, elapsedMs: Date.now() - startedAt }, "enableVoiceModeForAgent.ensureAgentLoaded.done");
        this.registerVoiceBridgeForAgent(agentId);
        const baseConfig = {
            systemPrompt: stripVoiceModeSystemPrompt(existing.config.systemPrompt),
        };
        this.voiceModeBaseConfig = baseConfig;
        const refreshOverrides = {
            systemPrompt: buildVoiceModeSystemPrompt(baseConfig.systemPrompt, true),
        };
        try {
            this.sessionLogger.info({ agentId, elapsedMs: Date.now() - startedAt }, "enableVoiceModeForAgent.reloadAgentSession.start");
            const refreshed = await this.host.reloadAgentSession(agentId, refreshOverrides);
            this.sessionLogger.info({ agentId, refreshedAgentId: refreshed.id, elapsedMs: Date.now() - startedAt }, "enableVoiceModeForAgent.reloadAgentSession.done");
            return refreshed.id;
        }
        catch (error) {
            this.unregisterVoiceSpeakHandler?.(agentId);
            this.unregisterVoiceCallerContext?.(agentId);
            this.voiceModeBaseConfig = null;
            throw error;
        }
    }
    async disableVoiceModeForActiveAgent(restoreAgentConfig) {
        await this.stopVoiceTurnController();
        const agentId = this.voiceModeAgentId;
        if (!agentId) {
            this.voiceModeBaseConfig = null;
            return;
        }
        if (restoreAgentConfig && this.voiceModeBaseConfig) {
            const baseConfig = this.voiceModeBaseConfig;
            try {
                await this.host.reloadAgentSession(agentId, {
                    systemPrompt: buildVoiceModeSystemPrompt(baseConfig.systemPrompt, false),
                });
            }
            catch (error) {
                this.sessionLogger.warn({ err: error, agentId }, "Failed to restore agent config while disabling voice mode");
            }
        }
        this.unregisterVoiceSpeakHandler?.(agentId);
        this.unregisterVoiceCallerContext?.(agentId);
        this.voiceModeBaseConfig = null;
        this.voiceModeAgentId = null;
    }
    handleDictationManagerMessage(msg) {
        this.emit(msg);
    }
    async startVoiceTurnController() {
        if (this.voiceTurnController) {
            this.sessionLogger.info("startVoiceTurnController skipped: already running");
            return;
        }
        const turnDetection = this.resolveVoiceTurnDetection();
        if (!turnDetection) {
            throw new Error("Voice turn detection is not configured");
        }
        const stt = this.sttManager.getProvider();
        if (!stt) {
            throw new Error("Voice speech-to-text is not configured");
        }
        this.sessionLogger.info({ providerId: turnDetection.id }, "startVoiceTurnController creating controller");
        const controller = createVoiceTurnController({
            logger: this.sessionLogger.child({ component: "voice-turn-controller" }),
            turnDetection,
            stt,
            sttLanguage: this.sttLanguage,
            callbacks: {
                onSpeechStarted: async () => {
                    // Voice STT providers return final transcripts only. Use the detector's
                    // confirmed speech event so interruption does not wait for transcription.
                    this.sessionLogger.debug("Voice VAD speech_started");
                    this.emit({
                        type: "voice_input_state",
                        payload: {
                            isSpeaking: true,
                        },
                    });
                    await this.handleVoiceSpeechStart();
                },
                onPartialTranscript: async ({ segmentId, transcript }) => {
                    this.sessionLogger.debug({ segmentId, transcriptLength: transcript.trim().length }, "Voice partial transcript");
                },
                onSpeechStopped: async () => {
                    this.handleVoiceSpeechStopped();
                    this.setPhase("transcribing");
                    this.emit({
                        type: "activity_log",
                        payload: {
                            id: uuidv4(),
                            timestamp: new Date(),
                            type: "system",
                            content: "Transcribing audio...",
                        },
                    });
                },
                onFinalTranscript: async ({ transcript, language, durationMs, avgLogprob, isLowConfidence, }) => {
                    const requestId = uuidv4();
                    const transcriptText = isLowConfidence ? "" : transcript.trim();
                    if (isLowConfidence) {
                        this.sessionLogger.debug({ text: transcript, avgLogprob }, "Filtered low-confidence transcription (likely non-speech)");
                    }
                    this.sessionLogger.info({
                        requestId,
                        isVoiceMode: this.isVoiceMode,
                        transcriptLength: transcriptText.length,
                        transcript: transcriptText,
                    }, "Transcription result");
                    await this.handleTranscriptionResultPayload({
                        text: transcriptText,
                        requestId,
                        ...(language ? { language } : {}),
                        duration: durationMs,
                        ...(avgLogprob !== undefined ? { avgLogprob } : {}),
                        ...(isLowConfidence !== undefined ? { isLowConfidence } : {}),
                    });
                },
                onError: (error) => {
                    this.sessionLogger.error({ err: error }, "Voice turn controller failed");
                },
            },
        });
        this.sessionLogger.info("startVoiceTurnController connecting controller");
        this.voiceTurnController = controller;
        await controller.start();
        if (this.closed)
            await controller.stop();
        this.sessionLogger.info("startVoiceTurnController connected");
    }
    async stopVoiceTurnController() {
        if (!this.voiceTurnController) {
            return;
        }
        const controller = this.voiceTurnController;
        this.voiceTurnController = null;
        await controller.stop();
    }
    handleVoiceSpeechStopped() {
        this.sessionLogger.info("voice_input_state emitting isSpeaking=false");
        this.emit({
            type: "voice_input_state",
            payload: {
                isSpeaking: false,
            },
        });
    }
    async ensureAudioBufferForFormat(chunkFormat, isPCMChunk) {
        if (!this.audioBuffer) {
            this.audioBuffer = {
                chunks: [],
                format: chunkFormat,
                isPCM: isPCMChunk,
                totalPCMBytes: 0,
            };
            return this.audioBuffer;
        }
        if (this.audioBuffer.isPCM !== isPCMChunk) {
            this.sessionLogger.debug({
                oldFormat: this.audioBuffer.isPCM ? "pcm" : this.audioBuffer.format,
                newFormat: chunkFormat,
            }, `Audio format changed mid-stream, flushing current buffer`);
            const finalized = this.finalizeBufferedAudio();
            if (finalized) {
                await this.processCompletedAudio(finalized.audio, finalized.format);
            }
            this.audioBuffer = {
                chunks: [],
                format: chunkFormat,
                isPCM: isPCMChunk,
                totalPCMBytes: 0,
            };
            return this.audioBuffer;
        }
        if (!this.audioBuffer.isPCM) {
            this.audioBuffer.format = chunkFormat;
        }
        return this.audioBuffer;
    }
    async forwardAudioChunkToVoiceTurn(msg, chunkFormat) {
        if (!this.voiceTurnController) {
            throw new Error("Voice mode is enabled but the voice turn controller is not running");
        }
        const chunkBytes = Buffer.byteLength(msg.audio, "base64");
        this.voiceInputChunkCount += 1;
        this.voiceInputBytes += chunkBytes;
        const now = Date.now();
        if (this.voiceInputChunkCount % 50 === 0 || now - this.voiceInputWindowStartedAt >= 1000) {
            this.sessionLogger.info({
                chunkCount: this.voiceInputChunkCount,
                audioBytes: this.voiceInputBytes,
                windowMs: now - this.voiceInputWindowStartedAt,
                format: chunkFormat,
            }, "Voice input chunk summary");
            this.voiceInputWindowStartedAt = now;
            this.voiceInputChunkCount = 0;
            this.voiceInputBytes = 0;
        }
        await this.voiceTurnController.appendClientChunk({
            audioBase64: msg.audio,
            format: chunkFormat,
        });
    }
    async handleAudioChunk(msg) {
        if (!this.isVoiceMode) {
            this.sessionLogger.warn("Received voice_audio_chunk while voice mode is disabled; transcript will be emitted but voice assistant turn is skipped");
        }
        const chunkFormat = msg.format || "audio/wav";
        if (this.isVoiceMode) {
            await this.forwardAudioChunkToVoiceTurn(msg, chunkFormat);
            return;
        }
        const chunkBuffer = Buffer.from(msg.audio, "base64");
        const isPCMChunk = chunkFormat.toLowerCase().includes("pcm");
        const buffer = await this.ensureAudioBufferForFormat(chunkFormat, isPCMChunk);
        buffer.chunks.push(chunkBuffer);
        if (buffer.isPCM) {
            buffer.totalPCMBytes += chunkBuffer.length;
        }
        // In non-voice mode, use streaming threshold to process chunks
        const reachedStreamingThreshold = !this.isVoiceMode && buffer.isPCM && buffer.totalPCMBytes >= MIN_STREAMING_SEGMENT_BYTES;
        if (!msg.isLast && reachedStreamingThreshold) {
            return;
        }
        const bufferedState = this.audioBuffer;
        const finalized = this.finalizeBufferedAudio();
        if (!finalized) {
            return;
        }
        if (!msg.isLast && reachedStreamingThreshold) {
            this.sessionLogger.debug({
                minDuration: MIN_STREAMING_SEGMENT_DURATION_MS,
                pcmBytes: bufferedState?.totalPCMBytes ?? 0,
            }, `Minimum chunk duration reached (~${MIN_STREAMING_SEGMENT_DURATION_MS}ms, ${bufferedState?.totalPCMBytes ?? 0} PCM bytes) – triggering STT`);
        }
        else {
            this.sessionLogger.debug({ audioBytes: finalized.audio.length, chunks: bufferedState?.chunks.length ?? 0 }, `Complete audio segment (${finalized.audio.length} bytes, ${bufferedState?.chunks.length ?? 0} chunk(s))`);
        }
        await this.processCompletedAudio(finalized.audio, finalized.format);
    }
    finalizeBufferedAudio() {
        if (!this.audioBuffer) {
            return null;
        }
        const bufferState = this.audioBuffer;
        this.audioBuffer = null;
        if (bufferState.isPCM) {
            const pcmBuffer = Buffer.concat(bufferState.chunks);
            const wavBuffer = convertPCMToWavBuffer(pcmBuffer, PCM_SAMPLE_RATE, PCM_CHANNELS, PCM_BITS_PER_SAMPLE);
            return {
                audio: wavBuffer,
                format: "audio/wav",
            };
        }
        return {
            audio: Buffer.concat(bufferState.chunks),
            format: bufferState.format,
        };
    }
    async processCompletedAudio(audio, format) {
        if (this.processingPhase === "transcribing") {
            this.sessionLogger.debug({ phase: this.processingPhase, segmentCount: this.pendingAudioSegments.length + 1 }, `Buffering audio segment (phase: ${this.processingPhase})`);
            this.pendingAudioSegments.push({
                audio,
                format,
            });
            this.setBufferTimeout();
            return;
        }
        if (this.pendingAudioSegments.length > 0) {
            this.pendingAudioSegments.push({
                audio,
                format,
            });
            this.sessionLogger.debug({ segmentCount: this.pendingAudioSegments.length }, `Processing ${this.pendingAudioSegments.length} buffered segments together`);
            const pendingSegments = [...this.pendingAudioSegments];
            this.pendingAudioSegments = [];
            this.clearBufferTimeout();
            const combinedAudio = Buffer.concat(pendingSegments.map((segment) => segment.audio));
            const combinedFormat = pendingSegments[pendingSegments.length - 1].format;
            await this.processAudio(combinedAudio, combinedFormat);
            return;
        }
        await this.processAudio(audio, format);
    }
    async flushPendingAudioSegments(reason) {
        if (this.processingPhase === "transcribing" || this.pendingAudioSegments.length === 0) {
            return;
        }
        const pendingSegments = [...this.pendingAudioSegments];
        this.pendingAudioSegments = [];
        this.clearBufferTimeout();
        this.sessionLogger.debug({ reason, segmentCount: pendingSegments.length }, `Flushing ${pendingSegments.length} buffered audio segment(s)`);
        const combinedAudio = Buffer.concat(pendingSegments.map((segment) => segment.audio));
        const combinedFormat = pendingSegments[pendingSegments.length - 1].format;
        await this.processAudio(combinedAudio, combinedFormat);
    }
    /**
     * Process audio through STT and then LLM
     */
    async processAudio(audio, format) {
        this.setPhase("transcribing");
        this.emit({
            type: "activity_log",
            payload: {
                id: uuidv4(),
                timestamp: new Date(),
                type: "system",
                content: "Transcribing audio...",
            },
        });
        try {
            const requestId = uuidv4();
            const result = await this.sttManager.transcribe(audio, format, {
                requestId,
                label: this.isVoiceMode ? "voice" : "buffered",
            });
            const transcriptText = result.text.trim();
            this.sessionLogger.info({
                requestId,
                isVoiceMode: this.isVoiceMode,
                transcriptLength: transcriptText.length,
                transcript: transcriptText,
            }, "Transcription result");
            await this.handleTranscriptionResultPayload({
                text: result.text,
                language: result.language,
                duration: result.duration,
                requestId,
                avgLogprob: result.avgLogprob,
                isLowConfidence: result.isLowConfidence,
                byteLength: result.byteLength,
                format: result.format,
                debugRecordingPath: result.debugRecordingPath,
            });
        }
        catch (error) {
            this.setPhase("idle");
            this.clearSpeechInProgress("transcription error");
            await this.flushPendingAudioSegments("transcription error");
            this.emit({
                type: "activity_log",
                payload: {
                    id: uuidv4(),
                    timestamp: new Date(),
                    type: "error",
                    content: `Transcription error: ${getErrorMessage(error)}`,
                },
            });
            throw error;
        }
    }
    async handleTranscriptionResultPayload(result) {
        const transcriptText = result.text.trim();
        this.emit({
            type: "transcription_result",
            payload: {
                text: result.text,
                ...(result.language ? { language: result.language } : {}),
                ...(result.duration !== undefined ? { duration: result.duration } : {}),
                requestId: result.requestId,
                ...(result.avgLogprob !== undefined ? { avgLogprob: result.avgLogprob } : {}),
                ...(result.isLowConfidence !== undefined
                    ? { isLowConfidence: result.isLowConfidence }
                    : {}),
                ...(result.byteLength !== undefined ? { byteLength: result.byteLength } : {}),
                ...(result.format ? { format: result.format } : {}),
                ...(result.debugRecordingPath ? { debugRecordingPath: result.debugRecordingPath } : {}),
            },
        });
        if (!transcriptText) {
            this.sessionLogger.debug("Empty transcription (false positive), not aborting");
            this.setPhase("idle");
            this.clearSpeechInProgress("empty transcription");
            await this.flushPendingAudioSegments("empty transcription");
            return;
        }
        // Has content - abort any in-progress stream now
        this.createAbortController();
        if (result.debugRecordingPath) {
            this.emit({
                type: "activity_log",
                payload: {
                    id: uuidv4(),
                    timestamp: new Date(),
                    type: "system",
                    content: `Saved input audio: ${result.debugRecordingPath}`,
                    metadata: {
                        recordingPath: result.debugRecordingPath,
                        ...(result.format ? { format: result.format } : {}),
                        requestId: result.requestId,
                    },
                },
            });
        }
        this.emit({
            type: "activity_log",
            payload: {
                id: uuidv4(),
                timestamp: new Date(),
                type: "transcript",
                content: result.text,
                metadata: {
                    ...(result.language ? { language: result.language } : {}),
                    ...(result.duration !== undefined ? { duration: result.duration } : {}),
                },
            },
        });
        this.clearSpeechInProgress("transcription complete");
        this.setPhase("idle");
        if (!this.isVoiceMode) {
            this.sessionLogger.debug({ requestId: result.requestId }, "Skipping voice agent processing because voice mode is disabled");
            await this.flushPendingAudioSegments("voice mode disabled");
            return;
        }
        const agentId = this.voiceModeAgentId;
        if (!agentId) {
            this.sessionLogger.warn({ requestId: result.requestId }, "Skipping voice agent processing because no agent is currently voice-enabled");
            await this.flushPendingAudioSegments("no active voice agent");
            return;
        }
        await this.host.sendSpokenInput(agentId, result.text);
        await this.flushPendingAudioSegments("transcription complete");
    }
    registerVoiceBridgeForAgent(agentId) {
        this.registerVoiceSpeakHandler?.(agentId, async ({ text, signal }) => {
            this.sessionLogger.info({
                agentId,
                textLength: text.length,
                preview: text.slice(0, 160),
            }, "Voice speak tool call received by session handler");
            const abortSignal = signal
                ? AbortSignal.any([signal, this.abortController.signal])
                : this.abortController.signal;
            await this.ttsManager.generateAndWaitForPlayback(text, (msg) => this.emit(msg), abortSignal, true);
            this.sessionLogger.info({ agentId, textLength: text.length }, "Voice speak tool call finished playback");
            this.emit({
                type: "activity_log",
                payload: {
                    id: uuidv4(),
                    timestamp: new Date(),
                    type: "assistant",
                    content: text,
                },
            });
        });
        this.registerVoiceCallerContext?.(agentId, {
            childAgentDefaultLabels: {},
            allowCustomCwd: false,
            enableVoiceTools: true,
        });
    }
    /**
     * Handle abort request from client
     */
    async handleAbort() {
        this.sessionLogger.info({ phase: this.processingPhase }, `Abort request, phase: ${this.processingPhase}`);
        this.abortController.abort();
        this.ttsManager.cancelPendingPlaybacks("abort request");
        // Voice abort should always interrupt active agent output immediately.
        if (this.isVoiceMode && this.voiceModeAgentId) {
            try {
                await this.host.interruptAgentIfRunning(this.voiceModeAgentId);
            }
            catch (error) {
                const message = `Voice interruption failed: ${getErrorMessage(error)}`;
                this.emit({
                    type: "activity_log",
                    payload: {
                        id: uuidv4(),
                        timestamp: new Date(),
                        type: "error",
                        content: message,
                        metadata: { voiceAbortFailed: true },
                    },
                });
                throw error;
            }
        }
        if (this.processingPhase === "transcribing") {
            // Still in STT phase - we'll buffer the next audio
            this.sessionLogger.debug("Will buffer next audio (currently transcribing)");
            // Phase stays as 'transcribing', handleAudioChunk will handle buffering
            return;
        }
        // Reset phase to idle and clear pending non-voice buffers.
        this.setPhase("idle");
        this.pendingAudioSegments = [];
        this.clearBufferTimeout();
    }
    /**
     * Handle audio playback confirmation from client
     */
    handleAudioPlayed(id) {
        this.ttsManager.confirmAudioPlayed(id);
    }
    /**
     * Mark speech detection start and abort any active playback/agent run.
     */
    async handleVoiceSpeechStart() {
        if (this.speechInProgress) {
            return;
        }
        const chunkReceivedAt = Date.now();
        const phaseBeforeAbort = this.processingPhase;
        const hadActiveStream = this.host.hasActiveAgentRun(this.voiceModeAgentId);
        this.speechInProgress = true;
        this.sessionLogger.debug("Voice speech detected – aborting playback and active agent run");
        if (this.pendingAudioSegments.length > 0) {
            this.sessionLogger.debug({ segmentCount: this.pendingAudioSegments.length }, `Dropping ${this.pendingAudioSegments.length} buffered audio segment(s) due to voice speech`);
            this.pendingAudioSegments = [];
        }
        if (this.audioBuffer) {
            this.sessionLogger.debug({ chunks: this.audioBuffer.chunks.length, pcmBytes: this.audioBuffer.totalPCMBytes }, `Clearing partial audio buffer (${this.audioBuffer.chunks.length} chunk(s)${this.audioBuffer.isPCM ? `, ${this.audioBuffer.totalPCMBytes} PCM bytes` : ""})`);
            this.audioBuffer = null;
        }
        this.clearBufferTimeout();
        this.abortController.abort();
        await this.handleAbort();
        const latencyMs = Date.now() - chunkReceivedAt;
        this.sessionLogger.debug({ latencyMs, phaseBeforeAbort, hadActiveStream }, "[Telemetry] barge_in.llm_abort_latency");
    }
    /**
     * Clear speech-in-progress flag once the user turn has completed
     */
    clearSpeechInProgress(reason) {
        if (!this.speechInProgress) {
            return;
        }
        this.speechInProgress = false;
        this.sessionLogger.debug({ reason }, `Speech turn complete (${reason}) – resuming TTS`);
    }
    /**
     * Create new AbortController, aborting the previous one
     */
    createAbortController() {
        this.abortController.abort();
        this.abortController = new AbortController();
        this.ttsDebugStreams.clear();
        return this.abortController;
    }
    /**
     * Set the processing phase
     */
    setPhase(phase) {
        this.processingPhase = phase;
        if (phase === "idle")
            this.onIdle?.();
        this.sessionLogger.debug({ phase }, `Phase: ${phase}`);
    }
    /**
     * Set timeout to process buffered audio segments
     */
    setBufferTimeout() {
        this.clearBufferTimeout();
        this.bufferTimeout = setTimeout(async () => {
            this.sessionLogger.debug("Buffer timeout reached, processing pending segments");
            if (this.processingPhase === "transcribing") {
                this.sessionLogger.debug({ segmentCount: this.pendingAudioSegments.length }, "Buffer timeout deferred because transcription is still in progress");
                this.setBufferTimeout();
                return;
            }
            if (this.pendingAudioSegments.length > 0) {
                const segments = [...this.pendingAudioSegments];
                this.pendingAudioSegments = [];
                this.bufferTimeout = null;
                const combined = Buffer.concat(segments.map((s) => s.audio));
                await this.processAudio(combined, segments[0].format);
            }
        }, 10000); // 10 second timeout
    }
    /**
     * Clear buffer timeout
     */
    clearBufferTimeout() {
        if (this.bufferTimeout) {
            clearTimeout(this.bufferTimeout);
            this.bufferTimeout = null;
        }
    }
    /**
     * Emit a message to the client. Captures TTS audio_output frames for optional
     * debug persistence before forwarding to the session emitter.
     */
    emit(msg) {
        if (this.closed)
            return;
        if (msg.type === "audio_output" &&
            (process.env.TTS_DEBUG_AUDIO_DIR || isPaseoDictationDebugEnabled()) &&
            msg.payload.groupId &&
            typeof msg.payload.audio === "string") {
            const groupId = msg.payload.groupId;
            const existing = this.ttsDebugStreams.get(groupId) ??
                { format: msg.payload.format, chunks: [] };
            try {
                existing.chunks.push(Buffer.from(msg.payload.audio, "base64"));
                existing.format = msg.payload.format;
                this.ttsDebugStreams.set(groupId, existing);
            }
            catch {
                // ignore malformed base64
            }
            if (msg.payload.isLastChunk) {
                const final = this.ttsDebugStreams.get(groupId);
                this.ttsDebugStreams.delete(groupId);
                if (final && final.chunks.length > 0) {
                    void (async () => {
                        const recordingPath = await maybePersistTtsDebugAudio(Buffer.concat(final.chunks), { sessionId: this.sessionId, groupId, format: final.format }, this.sessionLogger);
                        if (recordingPath) {
                            this.host.emit({
                                type: "activity_log",
                                payload: {
                                    id: uuidv4(),
                                    timestamp: new Date(),
                                    type: "system",
                                    content: `Saved TTS audio: ${recordingPath}`,
                                    metadata: { recordingPath, format: final.format, groupId },
                                },
                            });
                        }
                    })();
                }
            }
        }
        this.host.emit(msg);
    }
    /** Stop input synchronously, including a source disconnected during bootstrap. */
    cancel() {
        if (this.closed)
            return;
        this.closed = true;
        this.abortController.abort();
        this.clearBufferTimeout();
        this.pendingAudioSegments = [];
        this.audioBuffer = null;
        const failures = [];
        for (const cleanup of [
            () => this.ttsManager.cleanup(),
            () => this.sttManager.cleanup(),
            () => this.dictationStreamManager.cleanupAll(),
        ]) {
            try {
                cleanup();
            }
            catch (error) {
                failures.push(error);
            }
        }
        if (failures.length)
            throw new AggregateError(failures, "Voice input cleanup failed");
    }
    /** Restore the agent only after the caller has drained its in-flight requests. */
    async cleanup() {
        try {
            this.cancel();
        }
        finally {
            try {
                await this.stopVoiceTurnController();
            }
            finally {
                await this.disableVoiceModeForActiveAgent(true);
                this.isVoiceMode = false;
            }
        }
    }
}
//# sourceMappingURL=voice-session.js.map