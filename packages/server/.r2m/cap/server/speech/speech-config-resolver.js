import { z } from "zod";
import { resolveLocalSpeechConfig } from "./providers/local/config.js";
import { resolveOpenAiSpeechConfig } from "./providers/openai/config.js";
import { SpeechProviderIdSchema, } from "./speech-types.js";
const OptionalSpeechProviderSchema = z
    .string()
    .trim()
    .toLowerCase()
    .pipe(SpeechProviderIdSchema)
    .optional();
const OptionalBooleanFlagSchema = z
    .union([z.boolean(), z.string().trim().toLowerCase()])
    .optional()
    .transform((value) => {
    if (typeof value === "boolean") {
        return value;
    }
    if (value === undefined) {
        return undefined;
    }
    if (["1", "true", "yes", "y", "on"].includes(value)) {
        return true;
    }
    if (["0", "false", "no", "n", "off"].includes(value)) {
        return false;
    }
    return undefined;
});
const RequestedSpeechProvidersSchema = z.object({
    dictationStt: OptionalSpeechProviderSchema.default("local"),
    voiceTurnDetection: OptionalSpeechProviderSchema.default("local"),
    voiceStt: OptionalSpeechProviderSchema.default("local"),
    voiceTts: OptionalSpeechProviderSchema.default("local"),
});
function resolveOptionalBooleanFlag(value) {
    return OptionalBooleanFlagSchema.parse(value) ?? true;
}
function firstSpeechDefinedValue(values) {
    for (const value of values) {
        if (value !== undefined && value !== null) {
            return value;
        }
    }
    return undefined;
}
function buildFeatureProviderInputs(params) {
    const voiceModeEnabled = resolveOptionalBooleanFlag(firstSpeechDefinedValue([
        params.env.PASEO_VOICE_MODE_ENABLED,
        params.persisted.features?.voiceMode?.enabled,
    ]));
    return {
        dictationStt: {
            configuredValue: firstSpeechDefinedValue([
                params.env.PASEO_DICTATION_STT_PROVIDER,
                params.persisted.features?.dictation?.stt?.provider,
            ]),
            enabled: resolveOptionalBooleanFlag(firstSpeechDefinedValue([
                params.env.PASEO_DICTATION_ENABLED,
                params.persisted.features?.dictation?.enabled,
            ])),
        },
        voiceTurnDetection: {
            configuredValue: firstSpeechDefinedValue([
                params.env.PASEO_VOICE_TURN_DETECTION_PROVIDER,
                params.persisted.features?.voiceMode?.turnDetection?.provider,
            ]),
            enabled: voiceModeEnabled,
        },
        voiceStt: {
            configuredValue: firstSpeechDefinedValue([
                params.env.PASEO_VOICE_STT_PROVIDER,
                params.persisted.features?.voiceMode?.stt?.provider,
            ]),
            enabled: voiceModeEnabled,
        },
        voiceTts: {
            configuredValue: firstSpeechDefinedValue([
                params.env.PASEO_VOICE_TTS_PROVIDER,
                params.persisted.features?.voiceMode?.tts?.provider,
            ]),
            enabled: voiceModeEnabled,
        },
    };
}
function buildRequestedFeatureProvider(inputs, parsedValue) {
    return {
        provider: parsedValue,
        explicit: inputs.configuredValue !== undefined,
        enabled: inputs.enabled,
    };
}
function resolveRequestedSpeechProviders(params) {
    const featureProviders = buildFeatureProviderInputs(params);
    const parsed = RequestedSpeechProvidersSchema.parse({
        dictationStt: featureProviders.dictationStt.configuredValue ?? "local",
        voiceTurnDetection: featureProviders.voiceTurnDetection.configuredValue ?? "local",
        voiceStt: featureProviders.voiceStt.configuredValue ?? "local",
        voiceTts: featureProviders.voiceTts.configuredValue ?? "local",
    });
    return {
        dictationStt: buildRequestedFeatureProvider(featureProviders.dictationStt, parsed.dictationStt),
        voiceTurnDetection: buildRequestedFeatureProvider(featureProviders.voiceTurnDetection, parsed.voiceTurnDetection),
        voiceStt: buildRequestedFeatureProvider(featureProviders.voiceStt, parsed.voiceStt),
        voiceTts: buildRequestedFeatureProvider(featureProviders.voiceTts, parsed.voiceTts),
    };
}
export function resolveSpeechConfig(params) {
    const providers = resolveRequestedSpeechProviders({
        env: params.env,
        persisted: params.persisted,
    });
    const local = resolveLocalSpeechConfig({
        paseoHome: params.paseoHome,
        env: params.env,
        persisted: params.persisted,
        providers,
    });
    const openai = resolveOpenAiSpeechConfig({
        env: params.env,
        persisted: params.persisted,
        providers,
    });
    return {
        openai,
        speech: {
            providers,
            sttLanguages: local.sttLanguages,
            ...(local.local ? { local: local.local } : {}),
        },
    };
}
//# sourceMappingURL=speech-config-resolver.js.map