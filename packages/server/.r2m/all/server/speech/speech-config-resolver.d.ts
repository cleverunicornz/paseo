import type { PersistedConfig } from "../persisted-config.js";
import type { PaseoOpenAIConfig, PaseoSpeechConfig } from "../bootstrap.js";
export declare function resolveSpeechConfig(params: {
    paseoHome: string;
    env: NodeJS.ProcessEnv;
    persisted: PersistedConfig;
}): {
    openai: PaseoOpenAIConfig | undefined;
    speech: PaseoSpeechConfig;
};
//# sourceMappingURL=speech-config-resolver.d.ts.map