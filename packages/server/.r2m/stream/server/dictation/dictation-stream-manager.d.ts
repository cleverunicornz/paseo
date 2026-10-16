import type pino from "pino";
import type { SpeechToTextProvider } from "../speech/speech-provider.js";
import { type Resolvable } from "../speech/provider-resolver.js";
export type DictationStreamOutboundMessage = {
    type: "dictation_stream_ack";
    payload: {
        dictationId: string;
        ackSeq: number;
    };
} | {
    type: "dictation_stream_finish_accepted";
    payload: {
        dictationId: string;
        timeoutMs: number;
    };
} | {
    type: "dictation_stream_partial";
    payload: {
        dictationId: string;
        text: string;
    };
} | {
    type: "dictation_stream_final";
    payload: {
        dictationId: string;
        text: string;
        debugRecordingPath?: string;
    };
} | {
    type: "dictation_stream_error";
    payload: {
        dictationId: string;
        error: string;
        retryable: boolean;
        debugRecordingPath?: string;
    };
} | {
    type: "activity_log";
    payload: {
        id: string;
        timestamp: Date;
        type: "system";
        content: string;
        metadata: Record<string, unknown>;
    };
};
export declare class DictationStreamManager {
    private readonly logger;
    private readonly emit;
    private readonly sessionId;
    private readonly resolveStt;
    private readonly language;
    private readonly finalTimeoutMs;
    private readonly autoCommitSeconds;
    private readonly onIdle;
    private readonly streams;
    constructor(params: {
        logger: pino.Logger;
        emit: (msg: DictationStreamOutboundMessage) => void;
        sessionId: string;
        stt: Resolvable<SpeechToTextProvider | null>;
        language?: string;
        finalTimeoutMs?: number;
        autoCommitSeconds?: number;
        onIdle?: () => void;
    });
    get hasDemand(): boolean;
    cleanupAll(): void;
    handleStart(dictationId: string, format: string): Promise<void>;
    handleChunk(params: {
        dictationId: string;
        seq: number;
        audioBase64: string;
        format: string;
    }): Promise<void>;
    handleFinish(dictationId: string, finalSeq: number): Promise<void>;
    handleCancel(dictationId: string): void;
    private emitDictationAck;
    private emitDictationPartial;
    private maybePersistDictationStreamAudio;
    private failDictationStream;
    private failAndCleanupDictationStream;
    private cleanupDictationStream;
    private estimateFinalizationTimeout;
    private maybeAutoCommitDictationSegment;
    private requestDictationCommit;
    private maybeSealDictationStreamFinish;
    private dropUncommittedNonFinalTranscripts;
    private maybeFinalizeDictationStream;
}
//# sourceMappingURL=dictation-stream-manager.d.ts.map