import type pino from "pino";
export interface DictationDebugAudioMetadata {
    sessionId: string;
    dictationId: string;
    format: string;
}
export interface DictationDebugChunkWriter {
    folder: string;
    writeChunk: (seq: number, pcm16: Buffer) => Promise<void>;
}
export declare function createDictationDebugChunkWriter(metadata: Pick<DictationDebugAudioMetadata, "sessionId" | "dictationId">, logger: pino.Logger): DictationDebugChunkWriter | null;
export declare function maybePersistDictationDebugAudio(audio: Buffer, metadata: DictationDebugAudioMetadata, logger: pino.Logger, chunkWriterFolder?: string | null): Promise<string | null>;
//# sourceMappingURL=dictation-debug.d.ts.map