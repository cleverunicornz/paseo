import { z } from "zod";
export declare const SpeechProviderIdSchema: z.ZodEnum<{
    local: "local";
    openai: "openai";
}>;
export type SpeechProviderId = z.infer<typeof SpeechProviderIdSchema>;
export declare const RequestedSpeechProviderSchema: z.ZodObject<{
    provider: z.ZodEnum<{
        local: "local";
        openai: "openai";
    }>;
    explicit: z.ZodBoolean;
    enabled: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strip>;
export type RequestedSpeechProvider = z.infer<typeof RequestedSpeechProviderSchema>;
export interface RequestedSpeechProviders {
    dictationStt: RequestedSpeechProvider;
    voiceTurnDetection: RequestedSpeechProvider;
    voiceStt: RequestedSpeechProvider;
    voiceTts: RequestedSpeechProvider;
}
//# sourceMappingURL=speech-types.d.ts.map