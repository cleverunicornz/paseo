import path from "node:path";
import { z } from "zod";
import { DEFAULT_LOCAL_STT_MODEL, DEFAULT_LOCAL_TTS_MODEL, LocalSttModelIdSchema, LocalTtsModelIdSchema, } from "./models.js";
const DEFAULT_LOCAL_MODELS_SUBDIR = path.join("models", "local-speech");
const DEFAULT_STT_LANGUAGE = "en";
const NumberLikeSchema = z.union([z.number(), z.string().trim().min(1)]);
const LanguageSchema = z.string().trim().min(1).default(DEFAULT_STT_LANGUAGE);
const OptionalFiniteNumberSchema = NumberLikeSchema.pipe(z.coerce.number().finite()).optional();
const OptionalIntegerSchema = NumberLikeSchema.pipe(z.coerce.number().int()).optional();
const LocalSpeechResolutionSchema = z.object({
    includeProviderConfig: z.boolean(),
    modelsDir: z.string().trim().min(1),
    dictationLocalSttModel: LocalSttModelIdSchema.default(DEFAULT_LOCAL_STT_MODEL),
    voiceLocalSttModel: LocalSttModelIdSchema.default(DEFAULT_LOCAL_STT_MODEL),
    voiceLocalTtsModel: LocalTtsModelIdSchema.default(DEFAULT_LOCAL_TTS_MODEL),
    dictationLanguage: LanguageSchema,
    voiceLanguage: LanguageSchema,
    voiceLocalTtsSpeakerId: OptionalIntegerSchema,
    voiceLocalTtsSpeed: OptionalFiniteNumberSchema,
});
function persistedLocalFeatureModel(provider, enabled, model) {
    if (provider !== "local" || enabled === false) {
        return undefined;
    }
    return model;
}
function shouldIncludeLocalProviderConfig(params) {
    const localRequestedByFeature = (params.providers.dictationStt.enabled !== false &&
        params.providers.dictationStt.provider === "local") ||
        (params.providers.voiceStt.enabled !== false &&
            params.providers.voiceStt.provider === "local") ||
        (params.providers.voiceTts.enabled !== false && params.providers.voiceTts.provider === "local");
    return (localRequestedByFeature ||
        params.env.PASEO_LOCAL_MODELS_DIR !== undefined ||
        params.persisted.providers?.local?.modelsDir !== undefined);
}
function firstDefinedValue(values) {
    for (const value of values) {
        if (value !== undefined && value !== null) {
            return value;
        }
    }
    return undefined;
}
function firstNonEmptyString(values) {
    for (const value of values) {
        const trimmed = value?.trim();
        if (trimmed) {
            return trimmed;
        }
    }
    return undefined;
}
function buildLocalSpeechLanguageResolutionInput(params) {
    const { env, persisted } = params;
    return {
        dictationLanguage: firstNonEmptyString([
            env.PASEO_DICTATION_LANGUAGE,
            persisted.features?.dictation?.stt?.language,
            DEFAULT_STT_LANGUAGE,
        ]),
        voiceLanguage: firstNonEmptyString([
            env.PASEO_VOICE_LANGUAGE,
            env.PASEO_DICTATION_LANGUAGE,
            persisted.features?.voiceMode?.stt?.language,
            persisted.features?.dictation?.stt?.language,
            DEFAULT_STT_LANGUAGE,
        ]),
    };
}
function buildLocalSpeechResolutionInput(params) {
    const { paseoHome, env, persisted, providers, includeProviderConfig } = params;
    return {
        includeProviderConfig,
        modelsDir: firstDefinedValue([
            env.PASEO_LOCAL_MODELS_DIR,
            persisted.providers?.local?.modelsDir,
            path.join(paseoHome, DEFAULT_LOCAL_MODELS_SUBDIR),
        ]),
        dictationLocalSttModel: firstDefinedValue([
            env.PASEO_DICTATION_LOCAL_STT_MODEL,
            persistedLocalFeatureModel(providers.dictationStt.provider, providers.dictationStt.enabled, persisted.features?.dictation?.stt?.model),
            DEFAULT_LOCAL_STT_MODEL,
        ]),
        voiceLocalSttModel: firstDefinedValue([
            env.PASEO_VOICE_LOCAL_STT_MODEL,
            persistedLocalFeatureModel(providers.voiceStt.provider, providers.voiceStt.enabled, persisted.features?.voiceMode?.stt?.model),
            DEFAULT_LOCAL_STT_MODEL,
        ]),
        voiceLocalTtsModel: firstDefinedValue([
            env.PASEO_VOICE_LOCAL_TTS_MODEL,
            persistedLocalFeatureModel(providers.voiceTts.provider, providers.voiceTts.enabled, persisted.features?.voiceMode?.tts?.model),
            DEFAULT_LOCAL_TTS_MODEL,
        ]),
        ...buildLocalSpeechLanguageResolutionInput({ env, persisted }),
        voiceLocalTtsSpeakerId: firstDefinedValue([
            env.PASEO_VOICE_LOCAL_TTS_SPEAKER_ID,
            persisted.features?.voiceMode?.tts?.speakerId,
        ]),
        voiceLocalTtsSpeed: firstDefinedValue([
            env.PASEO_VOICE_LOCAL_TTS_SPEED,
            persisted.features?.voiceMode?.tts?.speed,
        ]),
    };
}
export function resolveLocalSpeechConfig(params) {
    const includeProviderConfig = shouldIncludeLocalProviderConfig(params);
    const parsed = LocalSpeechResolutionSchema.parse(buildLocalSpeechResolutionInput({ ...params, includeProviderConfig }));
    const resolvedVoiceTtsSpeakerId = parsed.voiceLocalTtsSpeakerId ??
        (parsed.voiceLocalTtsModel === "kokoro-en-v0_19" ? 0 : undefined);
    return {
        sttLanguages: {
            dictation: parsed.dictationLanguage,
            voice: parsed.voiceLanguage,
        },
        local: parsed.includeProviderConfig
            ? {
                modelsDir: parsed.modelsDir,
                models: {
                    dictationStt: parsed.dictationLocalSttModel,
                    voiceStt: parsed.voiceLocalSttModel,
                    voiceTts: parsed.voiceLocalTtsModel,
                    ...(resolvedVoiceTtsSpeakerId !== undefined
                        ? { voiceTtsSpeakerId: resolvedVoiceTtsSpeakerId }
                        : {}),
                    ...(parsed.voiceLocalTtsSpeed !== undefined
                        ? { voiceTtsSpeed: parsed.voiceLocalTtsSpeed }
                        : {}),
                },
            }
            : undefined,
    };
}
//# sourceMappingURL=config.js.map