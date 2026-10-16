import type pino from "pino";
import type { SessionInboundMessage, SessionOutboundMessage } from "../../messages.js";
import type { SpeechToTextProvider, TextToSpeechProvider } from "../../speech/speech-provider.js";
import type { TurnDetectionProvider } from "../../speech/turn-detection-provider.js";
import type { VoiceCallerContext, VoiceSpeakHandler } from "../../voice-types.js";
import type { ManagedAgent } from "../../agent/agent-manager.js";
import type { AgentSessionConfig } from "../../agent/agent-sdk-types.js";
import { type Resolvable } from "../../speech/provider-resolver.js";
import type { SpeechReadinessSnapshot } from "../../speech/speech-runtime.js";
/**
 * The agent-facing operations VoiceSession needs from the session that owns it.
 * VoiceSession owns all voice/audio state; it reaches back through this narrow
 * seam only to deliver transcripts to the agent, drive TTS playback, and
 * abort/inspect the active agent run.
 */
export interface VoiceSessionHost {
    emit(msg: SessionOutboundMessage): void;
    loadAgent(agentId: string): Promise<ManagedAgent>;
    reloadAgentSession(agentId: string, overrides: Partial<AgentSessionConfig>): Promise<ManagedAgent>;
    sendSpokenInput(agentId: string, text: string): Promise<void>;
    interruptAgentIfRunning(agentId: string): Promise<void>;
    hasActiveAgentRun(agentId: string | null): boolean;
}
export interface VoiceSessionOptions {
    host: VoiceSessionHost;
    logger: pino.Logger;
    sessionId: string;
    onIdle?: () => void;
    sttLanguage?: string;
    tts: Resolvable<TextToSpeechProvider | null>;
    stt: Resolvable<SpeechToTextProvider | null>;
    voice?: {
        turnDetection?: Resolvable<TurnDetectionProvider | null>;
    };
    voiceBridge?: {
        registerVoiceSpeakHandler?: (agentId: string, handler: VoiceSpeakHandler) => void;
        unregisterVoiceSpeakHandler?: (agentId: string) => void;
        registerVoiceCallerContext?: (agentId: string, context: VoiceCallerContext) => void;
        unregisterVoiceCallerContext?: (agentId: string) => void;
    };
    dictation?: {
        finalTimeoutMs?: number;
        stt?: Resolvable<SpeechToTextProvider | null>;
        sttLanguage?: string;
        getSpeechReadiness?: () => SpeechReadinessSnapshot;
    };
}
/**
 * Owns the voice half of a client session: speech-to-text/text-to-speech
 * managers, dictation streaming, the barge-in audio-buffering state machine,
 * voice-turn detection, and the MCP voice bridge. The session delegates the
 * voice/dictation/abort message types here and otherwise knows nothing about
 * audio buffering or processing phases.
 */
export declare class VoiceSession {
    private readonly host;
    private readonly sessionLogger;
    private readonly sessionId;
    private readonly sttLanguage;
    private abortController;
    private closed;
    private readonly onIdle;
    private processingPhase;
    private isVoiceMode;
    private speechInProgress;
    private readonly dictationStreamManager;
    private readonly resolveVoiceTurnDetection;
    private voiceTurnController;
    private voiceInputChunkCount;
    private voiceInputBytes;
    private voiceInputWindowStartedAt;
    private pendingAudioSegments;
    private bufferTimeout;
    private audioBuffer;
    private readonly ttsDebugStreams;
    private readonly ttsManager;
    private readonly sttManager;
    private readonly registerVoiceSpeakHandler?;
    private readonly unregisterVoiceSpeakHandler?;
    private readonly registerVoiceCallerContext?;
    private readonly unregisterVoiceCallerContext?;
    private readonly getSpeechReadiness?;
    private voiceModeAgentId;
    private voiceModeBaseConfig;
    constructor(options: VoiceSessionOptions);
    get hasDemand(): boolean;
    isActiveForAgent(agentId: string): boolean;
    handleDictationChunk(params: {
        dictationId: string;
        seq: number;
        audioBase64: string;
        format: string;
    }): Promise<void>;
    handleDictationFinish(dictationId: string, finalSeq: number): Promise<void>;
    handleDictationCancel(dictationId: string): void;
    handleDictationStreamStart(msg: Extract<SessionInboundMessage, {
        type: "dictation_stream_start";
    }>): Promise<void>;
    private toVoiceFeatureUnavailableContext;
    private resolveModeReadinessState;
    private getVoiceFeatureUnavailableResponseMetadata;
    private resolveVoiceFeatureUnavailableContext;
    /**
     * Handle voice mode toggle
     */
    handleSetVoiceMode(enabled: boolean, agentId?: string, requestId?: string): Promise<void>;
    private parseVoiceTargetAgentId;
    private enableVoiceModeForAgent;
    private disableVoiceModeForActiveAgent;
    private handleDictationManagerMessage;
    private startVoiceTurnController;
    private stopVoiceTurnController;
    private handleVoiceSpeechStopped;
    private ensureAudioBufferForFormat;
    private forwardAudioChunkToVoiceTurn;
    handleAudioChunk(msg: Extract<SessionInboundMessage, {
        type: "voice_audio_chunk";
    }>): Promise<void>;
    private finalizeBufferedAudio;
    private processCompletedAudio;
    private flushPendingAudioSegments;
    /**
     * Process audio through STT and then LLM
     */
    private processAudio;
    private handleTranscriptionResultPayload;
    private registerVoiceBridgeForAgent;
    /**
     * Handle abort request from client
     */
    handleAbort(): Promise<void>;
    /**
     * Handle audio playback confirmation from client
     */
    handleAudioPlayed(id: string): void;
    /**
     * Mark speech detection start and abort any active playback/agent run.
     */
    private handleVoiceSpeechStart;
    /**
     * Clear speech-in-progress flag once the user turn has completed
     */
    private clearSpeechInProgress;
    /**
     * Create new AbortController, aborting the previous one
     */
    private createAbortController;
    /**
     * Set the processing phase
     */
    private setPhase;
    /**
     * Set timeout to process buffered audio segments
     */
    private setBufferTimeout;
    /**
     * Clear buffer timeout
     */
    private clearBufferTimeout;
    /**
     * Emit a message to the client. Captures TTS audio_output frames for optional
     * debug persistence before forwarding to the session emitter.
     */
    private emit;
    /** Stop input synchronously, including a source disconnected during bootstrap. */
    cancel(): void;
    /** Restore the agent only after the caller has drained its in-flight requests. */
    cleanup(): Promise<void>;
}
//# sourceMappingURL=voice-session.d.ts.map