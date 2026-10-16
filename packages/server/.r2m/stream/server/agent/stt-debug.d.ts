import type pino from "pino";
export interface DebugAudioMetadata {
    sessionId: string;
    agentId?: string;
    requestId?: string;
    label?: string;
    format: string;
}
export declare function maybePersistDebugAudio(audio: Buffer, metadata: DebugAudioMetadata, logger: pino.Logger): Promise<string | null>;
//# sourceMappingURL=stt-debug.d.ts.map