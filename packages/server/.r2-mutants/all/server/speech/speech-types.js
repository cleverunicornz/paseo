import { z } from "zod";
export const SpeechProviderIdSchema = z.enum(["openai", "local"]);
export const RequestedSpeechProviderSchema = z.object({
    provider: SpeechProviderIdSchema,
    explicit: z.boolean(),
    enabled: z.boolean().optional(),
});
//# sourceMappingURL=speech-types.js.map