import type { PersistedConfig } from "../../../persisted-config.js";
import type { RequestedSpeechProviders } from "../../speech-types.js";
import { type LocalSpeechModelId, type LocalSttModelId, type LocalTtsModelId } from "./models.js";
export interface LocalSpeechModelConfig {
    dictationStt: LocalSttModelId;
    voiceStt: LocalSttModelId;
    voiceTts: LocalTtsModelId;
    voiceTtsSpeakerId?: number;
    voiceTtsSpeed?: number;
}
export interface LocalSpeechProviderConfig {
    modelsDir: string;
    models: LocalSpeechModelConfig;
}
export interface ResolvedLocalSpeechConfig {
    local: LocalSpeechProviderConfig | undefined;
    sttLanguages: LocalSpeechSttLanguageConfig;
}
export type { LocalSpeechModelId, LocalSttModelId, LocalTtsModelId };
export interface LocalSpeechSttLanguageConfig {
    dictation: string;
    voice: string;
}
export declare function resolveLocalSpeechConfig(params: {
    paseoHome: string;
    env: NodeJS.ProcessEnv;
    persisted: PersistedConfig;
    providers: RequestedSpeechProviders;
}): ResolvedLocalSpeechConfig;
//# sourceMappingURL=config.d.ts.map