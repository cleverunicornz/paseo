import { OpenAI } from "openai";
export class OpenAITTS {
    constructor(ttsConfig, parentLogger) {
        this.config = {
            model: "tts-1",
            voice: "alloy",
            responseFormat: "pcm",
            ...ttsConfig,
        };
        this.logger = parentLogger.child({ module: "agent", provider: "openai", component: "tts" });
        this.openaiClient = new OpenAI({
            apiKey: ttsConfig.apiKey,
            ...(ttsConfig.baseUrl ? { baseURL: ttsConfig.baseUrl } : {}),
        });
        this.logger.info({ voice: this.config.voice, model: this.config.model, format: this.config.responseFormat }, "TTS (OpenAI) initialized");
    }
    getConfig() {
        return this.config;
    }
    async synthesizeSpeech(text) {
        if (!text || text.trim().length === 0) {
            throw new Error("Cannot synthesize empty text");
        }
        const startTime = Date.now();
        try {
            this.logger.debug({ textLength: text.length, preview: text.substring(0, 50) }, "Synthesizing speech");
            const response = await this.openaiClient.audio.speech.create({
                model: this.config.model,
                voice: this.config.voice,
                input: text,
                response_format: this.config.responseFormat,
            });
            const audioStream = response.body;
            const duration = Date.now() - startTime;
            this.logger.debug({ duration }, "Speech synthesis stream ready");
            return {
                stream: audioStream,
                format: this.config.responseFormat || "mp3",
            };
        }
        catch (error) {
            this.logger.error({ err: error }, "Speech synthesis error");
            const message = error instanceof Error ? error.message : String(error);
            throw new Error(`TTS synthesis failed: ${message}`, { cause: error });
        }
    }
}
//# sourceMappingURL=tts.js.map