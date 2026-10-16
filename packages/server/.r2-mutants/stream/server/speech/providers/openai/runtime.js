import { DEFAULT_OPENAI_TTS_MODEL } from "./config.js";
import { OpenAISTT } from "./stt.js";
import { OpenAITTS } from "./tts.js";
function resolveOpenAiCredentials(openaiConfig) {
    const sttApiKey = openaiConfig?.stt?.apiKey;
    return {
        openaiSttApiKey: sttApiKey,
        openaiTtsApiKey: openaiConfig?.tts?.apiKey,
        openaiDictationApiKey: sttApiKey,
    };
}
export function getOpenAiSpeechAvailability(openaiConfig) {
    const credentials = resolveOpenAiCredentials(openaiConfig);
    return {
        stt: Boolean(credentials.openaiSttApiKey),
        tts: Boolean(credentials.openaiTtsApiKey),
        dictationStt: Boolean(credentials.openaiDictationApiKey),
    };
}
export function validateOpenAiCredentialRequirements(params) {
    const { providers, logger, openaiConfig } = params;
    const openAiCredentials = resolveOpenAiCredentials(openaiConfig);
    const missingOpenAiCredentialsFor = [];
    if (providers.voiceStt.enabled !== false &&
        providers.voiceStt.provider === "openai" &&
        !openAiCredentials.openaiSttApiKey) {
        missingOpenAiCredentialsFor.push("voice.stt");
    }
    if (providers.voiceTts.enabled !== false &&
        providers.voiceTts.provider === "openai" &&
        !openAiCredentials.openaiTtsApiKey) {
        missingOpenAiCredentialsFor.push("voice.tts");
    }
    if (providers.dictationStt.enabled !== false &&
        providers.dictationStt.provider === "openai" &&
        !openAiCredentials.openaiDictationApiKey) {
        missingOpenAiCredentialsFor.push("dictation.stt");
    }
    if (missingOpenAiCredentialsFor.length > 0) {
        logger.warn({
            requestedProviders: {
                dictationStt: providers.dictationStt.provider,
                voiceStt: providers.voiceStt.provider,
                voiceTts: providers.voiceTts.provider,
            },
            missingOpenAiCredentialsFor,
        }, "Invalid speech configuration: OpenAI provider selected but credentials are missing — speech features will be unavailable");
    }
}
function createOpenAiStt(apiKey, openaiConfig, logger) {
    const { apiKey: _sttApiKey, ...sttConfig } = openaiConfig?.stt ?? {};
    return new OpenAISTT({ apiKey, ...sttConfig }, logger);
}
function createOpenAiTts(apiKey, openaiConfig, logger) {
    const { apiKey: _ttsApiKey, ...ttsConfig } = openaiConfig?.tts ?? {};
    return new OpenAITTS({
        apiKey,
        voice: "alloy",
        model: DEFAULT_OPENAI_TTS_MODEL,
        responseFormat: "pcm",
        ...ttsConfig,
    }, logger);
}
export function initializeOpenAiSpeechServices(params) {
    const { providers, openaiConfig, existing, logger } = params;
    const openAiCredentials = resolveOpenAiCredentials(openaiConfig);
    let sttService = existing.sttService;
    let ttsService = existing.ttsService;
    let dictationSttService = existing.dictationSttService;
    const turnDetectionService = existing.turnDetectionService;
    const needsOpenAiStt = !sttService && providers.voiceStt.enabled !== false && providers.voiceStt.provider === "openai";
    const needsOpenAiTts = !ttsService && providers.voiceTts.enabled !== false && providers.voiceTts.provider === "openai";
    const needsOpenAiDictation = !dictationSttService &&
        providers.dictationStt.enabled !== false &&
        providers.dictationStt.provider === "openai";
    const needsAnyOpenAi = needsOpenAiStt || needsOpenAiTts || needsOpenAiDictation;
    const hasAnyOpenAiCredential = Boolean(openAiCredentials.openaiSttApiKey) ||
        Boolean(openAiCredentials.openaiTtsApiKey) ||
        Boolean(openAiCredentials.openaiDictationApiKey);
    if (needsAnyOpenAi && hasAnyOpenAiCredential) {
        logger.info("OpenAI speech provider initialized");
        if (needsOpenAiStt && openAiCredentials.openaiSttApiKey) {
            sttService = createOpenAiStt(openAiCredentials.openaiSttApiKey, openaiConfig, logger);
        }
        if (needsOpenAiTts && openAiCredentials.openaiTtsApiKey) {
            ttsService = createOpenAiTts(openAiCredentials.openaiTtsApiKey, openaiConfig, logger);
        }
        if (needsOpenAiDictation && openAiCredentials.openaiDictationApiKey) {
            dictationSttService = createOpenAiStt(openAiCredentials.openaiDictationApiKey, openaiConfig, logger);
        }
    }
    else if (needsAnyOpenAi) {
        // validateOpenAiCredentialRequirements already warned about missing credentials
    }
    return {
        turnDetectionService,
        sttService,
        ttsService,
        dictationSttService,
    };
}
//# sourceMappingURL=runtime.js.map