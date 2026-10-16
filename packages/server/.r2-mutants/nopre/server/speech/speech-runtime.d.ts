import type { Logger } from "pino";
import type { PaseoOpenAIConfig, PaseoSpeechConfig } from "../bootstrap.js";
import type { LocalSpeechModelId } from "./providers/local/config.js";
import type { SpeechToTextProvider, TextToSpeechProvider } from "./speech-provider.js";
import type { TurnDetectionProvider } from "./turn-detection-provider.js";
export type SpeechReadinessReasonCode = "ready" | "disabled" | "model_download_in_progress" | "models_missing" | "model_download_failed" | "turn_detection_unavailable" | "stt_unavailable" | "tts_unavailable";
export interface SpeechReadinessState {
    enabled: boolean;
    available: boolean;
    reasonCode: SpeechReadinessReasonCode;
    message: string;
    retryable: boolean;
    missingModelIds: LocalSpeechModelId[];
}
export interface SpeechReadinessSnapshot {
    generatedAt: string;
    requiredLocalModelIds: LocalSpeechModelId[];
    missingLocalModelIds: LocalSpeechModelId[];
    download: {
        inProgress: boolean;
        error: string | null;
    };
    realtimeVoice: SpeechReadinessState;
    dictation: SpeechReadinessState;
    voiceFeature: SpeechReadinessState;
}
export interface SpeechService {
    resolveStt: () => SpeechToTextProvider | null;
    resolveSttLanguage: () => string;
    resolveTts: () => TextToSpeechProvider | null;
    resolveTurnDetection: () => TurnDetectionProvider | null;
    resolveDictationStt: () => SpeechToTextProvider | null;
    resolveDictationSttLanguage: () => string;
    getReadiness: () => SpeechReadinessSnapshot;
    onReadinessChange: (listener: (snapshot: SpeechReadinessSnapshot) => void) => () => void;
    start: () => void;
    stop: () => Promise<void>;
    ready: Promise<void>;
}
export declare function createSpeechService(params: {
    logger: Logger;
    openaiConfig?: PaseoOpenAIConfig;
    speechConfig?: PaseoSpeechConfig;
}): SpeechService;
//# sourceMappingURL=speech-runtime.d.ts.map