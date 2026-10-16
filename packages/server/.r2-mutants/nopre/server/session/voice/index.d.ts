import type { SessionInboundMessage } from "../../messages.js";
import type { SessionDelivery } from "../owned-subscriptions/index.js";
import { type VoiceSessionOptions } from "./voice-session.js";
type VoiceMessage = Extract<SessionInboundMessage, {
    type: "voice_audio_chunk" | "abort_request" | "audio_played" | "set_voice_mode" | "dictation_stream_start" | "dictation_stream_chunk" | "dictation_stream_finish" | "dictation_stream_cancel";
}>;
/** Audio conversations belong to their requesting socket, including bootstrap and finalization. */
export declare class VoiceSessions {
    private readonly options;
    private readonly delivery;
    private readonly demandChanged;
    private readonly sources;
    constructor(options: VoiceSessionOptions, delivery: SessionDelivery, demandChanged: () => void);
    get hasDemand(): boolean;
    isActiveForAgent(agentId: string): boolean;
    handleMessage(message: VoiceMessage): Promise<void>;
    private startSource;
    private releaseIdle;
    private dispatch;
}
export {};
//# sourceMappingURL=index.d.ts.map