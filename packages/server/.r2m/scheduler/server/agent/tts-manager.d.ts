import type pino from "pino";
import type { TextToSpeechProvider } from "../speech/speech-provider.js";
import { type Resolvable } from "../speech/provider-resolver.js";
import type { SessionOutboundMessage } from "../messages.js";
/**
 * Per-session TTS manager
 * Handles TTS audio generation and playback confirmation tracking
 */
export declare class TTSManager {
    private pendingPlaybacks;
    private readonly recentlyClosedAudioIds;
    private readonly logger;
    private readonly resolveTts;
    constructor(sessionId: string, logger: pino.Logger, tts: Resolvable<TextToSpeechProvider | null>);
    /**
     * Generate TTS audio, emit to client, and wait for playback confirmation
     * Returns a Promise that resolves when the client confirms playback completed
     */
    generateAndWaitForPlayback(text: string, emitMessage: (msg: SessionOutboundMessage) => void, abortSignal: AbortSignal, isVoiceMode: boolean): Promise<void>;
    private synthesizeSegment;
    private scheduleSegmentSynthesis;
    private cleanupPrefetchedSegments;
    private destroySpeechStream;
    private pruneRecentlyClosedAudioIds;
    private rememberClosedAudioId;
    private emitPreparedSegment;
    /**
     * Called when client confirms audio playback completed
     * Resolves the corresponding promise
     */
    confirmAudioPlayed(chunkId: string): void;
    /**
     * Cancel all pending playbacks (e.g., user interrupted audio)
     */
    cancelPendingPlaybacks(reason: string): void;
    /**
     * Cleanup all pending playbacks
     */
    cleanup(): void;
}
//# sourceMappingURL=tts-manager.d.ts.map