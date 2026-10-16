import type pino from "pino";
export interface TtsDebugAudioMetadata {
    sessionId: string;
    groupId: string;
    format: string;
}
export declare function maybePersistTtsDebugAudio(audio: Buffer, metadata: TtsDebugAudioMetadata, logger: pino.Logger): Promise<string | null>;
//# sourceMappingURL=tts-debug.d.ts.map