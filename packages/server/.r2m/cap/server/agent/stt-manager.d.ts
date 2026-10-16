import type pino from "pino";
import type { SpeechToTextProvider, TranscriptionResult } from "../speech/speech-provider.js";
import { type Resolvable } from "../speech/provider-resolver.js";
interface TranscriptionMetadata {
    agentId?: string;
    requestId?: string;
    label?: string;
}
export interface SessionTranscriptionResult extends TranscriptionResult {
    debugRecordingPath?: string;
    byteLength: number;
    format: string;
}
export interface STTManagerOptions {
    language?: string;
}
/**
 * Per-session STT manager
 * Handles speech-to-text transcription
 */
export declare class STTManager {
    private readonly sessionId;
    private readonly logger;
    private readonly resolveStt;
    private readonly language;
    constructor(sessionId: string, logger: pino.Logger, stt: Resolvable<SpeechToTextProvider | null>, options?: STTManagerOptions);
    getProvider(): SpeechToTextProvider | null;
    /**
     * Transcribe audio buffer to text
     */
    transcribe(audio: Buffer, format: string, metadata?: TranscriptionMetadata): Promise<SessionTranscriptionResult>;
    /**
     * Cleanup (currently no-op, but provides extension point)
     */
    cleanup(): void;
}
export {};
//# sourceMappingURL=stt-manager.d.ts.map