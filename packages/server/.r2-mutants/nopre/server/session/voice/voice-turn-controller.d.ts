import type { Logger } from "pino";
import type { SpeechToTextProvider } from "../../speech/speech-provider.js";
import type { TurnDetectionProvider } from "../../speech/turn-detection-provider.js";
export interface VoiceTurnControllerCallbacks {
    onSpeechStarted(): Promise<void>;
    onSpeechStopped(): Promise<void>;
    onPartialTranscript(input: {
        segmentId: string;
        transcript: string;
    }): Promise<void>;
    onFinalTranscript(input: VoiceFinalTranscript): Promise<void>;
    onError(error: Error): void;
}
export interface VoiceTurnController {
    start(): Promise<void>;
    stop(): Promise<void>;
    appendClientChunk(input: {
        audioBase64: string;
        format: string;
    }): Promise<void>;
}
interface VoiceFinalTranscript {
    segmentId: string;
    transcript: string;
    language?: string;
    avgLogprob?: number;
    isLowConfidence?: boolean;
    durationMs: number;
}
export declare function createVoiceTurnController(params: {
    logger: Logger;
    turnDetection: TurnDetectionProvider;
    stt: SpeechToTextProvider;
    sttLanguage?: string;
    callbacks: VoiceTurnControllerCallbacks;
}): VoiceTurnController;
export {};
//# sourceMappingURL=voice-turn-controller.d.ts.map