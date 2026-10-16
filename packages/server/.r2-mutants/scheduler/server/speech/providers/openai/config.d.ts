import type { PersistedConfig } from "../../../persisted-config.js";
import type { RequestedSpeechProviders } from "../../speech-types.js";
import type { STTConfig } from "./stt.js";
import type { TTSConfig } from "./tts.js";
export declare const DEFAULT_OPENAI_TTS_MODEL = "tts-1";
export interface OpenAiSpeechProviderConfig {
    stt?: Partial<STTConfig> & {
        apiKey?: string;
    };
    tts?: Partial<TTSConfig> & {
        apiKey?: string;
    };
}
export declare function resolveOpenAiSpeechConfig(params: {
    env: NodeJS.ProcessEnv;
    persisted: PersistedConfig;
    providers: RequestedSpeechProviders;
}): OpenAiSpeechProviderConfig | undefined;
//# sourceMappingURL=config.d.ts.map