import type { Logger } from "pino";
import type { PaseoSpeechConfig } from "../../../bootstrap.js";
import type { SpeechToTextProvider, TextToSpeechProvider } from "../../speech-provider.js";
import type { RequestedSpeechProviders } from "../../speech-types.js";
import type { TurnDetectionProvider } from "../../turn-detection-provider.js";
import { type LocalSpeechModelId } from "./models.js";
interface LocalSpeechAvailability {
    configured: boolean;
    modelsDir: string | null;
}
export interface InitializedLocalSpeech {
    turnDetectionService: TurnDetectionProvider | null;
    sttService: SpeechToTextProvider | null;
    ttsService: TextToSpeechProvider | null;
    dictationSttService: SpeechToTextProvider | null;
    localVoiceTtsProvider: TextToSpeechProvider | null;
    localModelConfig: {
        modelsDir: string;
        defaultModelIds: LocalSpeechModelId[];
    } | null;
    availability: LocalSpeechAvailability;
    cleanup: () => void;
}
export declare function getLocalSpeechAvailability(speechConfig: PaseoSpeechConfig | null): LocalSpeechAvailability;
export declare function initializeLocalSpeechServices(params: {
    providers: RequestedSpeechProviders;
    speechConfig: PaseoSpeechConfig | null;
    logger: Logger;
}): Promise<InitializedLocalSpeech>;
export {};
//# sourceMappingURL=runtime.d.ts.map