import type { Logger } from "pino";
import type { SpeechToTextProvider, TextToSpeechProvider } from "../../speech-provider.js";
import type { RequestedSpeechProviders } from "../../speech-types.js";
import type { TurnDetectionProvider } from "../../turn-detection-provider.js";
import { type OpenAiSpeechProviderConfig } from "./config.js";
export interface OpenAiSpeechAvailability {
    stt: boolean;
    tts: boolean;
    dictationStt: boolean;
}
export interface SpeechServices {
    turnDetectionService: TurnDetectionProvider | null;
    sttService: SpeechToTextProvider | null;
    ttsService: TextToSpeechProvider | null;
    dictationSttService: SpeechToTextProvider | null;
}
export declare function getOpenAiSpeechAvailability(openaiConfig: OpenAiSpeechProviderConfig | undefined): OpenAiSpeechAvailability;
export declare function validateOpenAiCredentialRequirements(params: {
    providers: RequestedSpeechProviders;
    openaiConfig: OpenAiSpeechProviderConfig | undefined;
    logger: Logger;
}): void;
export declare function initializeOpenAiSpeechServices(params: {
    providers: RequestedSpeechProviders;
    openaiConfig: OpenAiSpeechProviderConfig | undefined;
    existing: SpeechServices;
    logger: Logger;
}): SpeechServices;
//# sourceMappingURL=runtime.d.ts.map