import type pino from "pino";
import type { SpeechToTextProvider, StreamingTranscriptionSession, TranscriptionResult } from "../../../speech-provider.js";
import { SherpaOfflineRecognizerEngine } from "./sherpa-offline-recognizer.js";
export interface SherpaParakeetSttConfig {
    engine: SherpaOfflineRecognizerEngine;
    silencePeakThreshold?: number;
}
export declare class SherpaOnnxParakeetSTT implements SpeechToTextProvider {
    private readonly engine;
    private readonly silencePeakThreshold;
    private readonly logger;
    readonly id: "local";
    constructor(config: SherpaParakeetSttConfig, logger: pino.Logger);
    createSession(params: {
        logger: pino.Logger;
        language?: string;
        prompt?: string;
    }): StreamingTranscriptionSession;
    transcribeAudio(audioBuffer: Buffer, format: string): Promise<TranscriptionResult>;
}
//# sourceMappingURL=sherpa-parakeet-stt.d.ts.map