import { DEFAULT_LOCAL_STT_MODEL, DEFAULT_LOCAL_TTS_MODEL, LocalSttModelIdSchema, LocalTtsModelIdSchema, } from "./models.js";
import { LocalSpeechWorkerClient, WorkerBackedSpeechToTextProvider, WorkerBackedTextToSpeechProvider, WorkerBackedTurnDetectionProvider, } from "./worker-client.js";
function resolveConfiguredLocalModels(speechConfig) {
    return {
        dictationLocalSttModel: LocalSttModelIdSchema.parse(speechConfig?.local?.models.dictationStt ?? DEFAULT_LOCAL_STT_MODEL),
        voiceLocalSttModel: LocalSttModelIdSchema.parse(speechConfig?.local?.models.voiceStt ?? DEFAULT_LOCAL_STT_MODEL),
        voiceLocalTtsModel: LocalTtsModelIdSchema.parse(speechConfig?.local?.models.voiceTts ?? DEFAULT_LOCAL_TTS_MODEL),
    };
}
export function getLocalSpeechAvailability(speechConfig) {
    const localConfig = speechConfig?.local ?? null;
    return {
        configured: Boolean(localConfig),
        modelsDir: localConfig?.modelsDir ?? null,
    };
}
function computeRequiredLocalModelIds(params) {
    const ids = new Set();
    if (params.providers.dictationStt.enabled !== false &&
        params.providers.dictationStt.provider === "local") {
        ids.add(params.models.dictationLocalSttModel);
    }
    if (params.providers.voiceStt.enabled !== false &&
        params.providers.voiceStt.provider === "local") {
        ids.add(params.models.voiceLocalSttModel);
    }
    if (params.providers.voiceTts.enabled !== false &&
        params.providers.voiceTts.provider === "local") {
        ids.add(params.models.voiceLocalTtsModel);
    }
    return Array.from(ids);
}
function isLocalProviderEnabled(provider) {
    return provider.enabled !== false && provider.provider === "local";
}
function warnLocalConfigMissing(logger, feature) {
    logger.warn({ configured: false }, `Local ${feature} selected but local provider config is missing; ${feature} will be unavailable`);
}
function initializeLocalTurnDetection(params) {
    const { client } = params;
    return new WorkerBackedTurnDetectionProvider(client);
}
function initializeLocalVoiceStt(params) {
    const { client } = params;
    return new WorkerBackedSpeechToTextProvider(client, "voiceStt");
}
function initializeLocalDictationStt(params) {
    const { client } = params;
    return new WorkerBackedSpeechToTextProvider(client, "dictationStt");
}
function initializeLocalVoiceTts(params) {
    const { client } = params;
    return new WorkerBackedTextToSpeechProvider(client);
}
export async function initializeLocalSpeechServices(params) {
    const { providers, logger, speechConfig } = params;
    const localConfig = speechConfig?.local ?? null;
    const localModels = resolveConfiguredLocalModels(speechConfig);
    let sttService = null;
    let ttsService = null;
    let dictationSttService = null;
    let turnDetectionService = null;
    let localVoiceTtsProvider = null;
    const requiredLocalModelIds = computeRequiredLocalModelIds({
        providers,
        models: localModels,
    });
    const workerClient = localConfig
        ? new LocalSpeechWorkerClient({
            logger,
            config: {
                modelsDir: localConfig.modelsDir,
                voiceSttModel: localModels.voiceLocalSttModel,
                dictationSttModel: localModels.dictationLocalSttModel,
                voiceTtsModel: localModels.voiceLocalTtsModel,
                voiceTtsSpeakerId: speechConfig?.local?.models.voiceTtsSpeakerId,
                voiceTtsSpeed: speechConfig?.local?.models.voiceTtsSpeed,
            },
        })
        : null;
    if (isLocalProviderEnabled(providers.voiceTurnDetection)) {
        if (workerClient) {
            turnDetectionService = initializeLocalTurnDetection({ client: workerClient });
        }
        else {
            warnLocalConfigMissing(logger, "turn detection");
        }
    }
    if (isLocalProviderEnabled(providers.voiceStt)) {
        if (workerClient) {
            sttService = initializeLocalVoiceStt({ client: workerClient });
        }
        else {
            warnLocalConfigMissing(logger, "voice STT");
        }
    }
    if (isLocalProviderEnabled(providers.dictationStt)) {
        if (workerClient) {
            dictationSttService = initializeLocalDictationStt({ client: workerClient });
        }
        else {
            warnLocalConfigMissing(logger, "dictation STT");
        }
    }
    if (isLocalProviderEnabled(providers.voiceTts)) {
        if (workerClient) {
            localVoiceTtsProvider = initializeLocalVoiceTts({ client: workerClient });
        }
        else {
            warnLocalConfigMissing(logger, "voice TTS");
        }
        if (localVoiceTtsProvider) {
            ttsService = localVoiceTtsProvider;
        }
    }
    const cleanup = () => {
        workerClient?.shutdown();
    };
    return {
        turnDetectionService,
        sttService,
        ttsService,
        dictationSttService,
        localVoiceTtsProvider,
        localModelConfig: localConfig
            ? {
                modelsDir: localConfig.modelsDir,
                defaultModelIds: requiredLocalModelIds,
            }
            : null,
        availability: getLocalSpeechAvailability(speechConfig),
        cleanup,
    };
}
//# sourceMappingURL=runtime.js.map