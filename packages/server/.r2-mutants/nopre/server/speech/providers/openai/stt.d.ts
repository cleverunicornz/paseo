import type pino from "pino";
import type { LogprobToken, SpeechToTextProvider, StreamingTranscriptionSession, TranscriptionResult } from "../../speech-provider.js";
export type { LogprobToken, TranscriptionResult };
export interface STTConfig {
    apiKey: string;
    baseUrl?: string;
    model?: "whisper-1" | "gpt-4o-transcribe" | "gpt-4o-mini-transcribe" | (string & {});
    confidenceThreshold?: number;
}
export declare class OpenAISTT implements SpeechToTextProvider {
    private readonly openaiClient;
    private readonly config;
    private readonly logger;
    readonly id: "openai";
    constructor(sttConfig: STTConfig, parentLogger: pino.Logger);
    createSession(params: {
        logger: pino.Logger;
        language?: string;
        prompt?: string;
    }): StreamingTranscriptionSession;
    private transcribeAudioInternal;
}
//# sourceMappingURL=stt.d.ts.map