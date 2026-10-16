import { EventEmitter } from "node:events";
import type { StreamingTranscriptionSession } from "../../../speech-provider.js";
import { SherpaOfflineRecognizerEngine } from "./sherpa-offline-recognizer.js";
export declare class SherpaParakeetRealtimeTranscriptionSession extends EventEmitter implements StreamingTranscriptionSession {
    private readonly engine;
    private connected;
    readonly requiredSampleRate: number;
    private currentSegmentId;
    private previousSegmentId;
    private lastPartialText;
    private pcm16;
    private lastDecodeAt;
    private decoding;
    private pendingDecode;
    private readonly minDecodeIntervalMs;
    constructor(params: {
        engine: SherpaOfflineRecognizerEngine;
        minDecodeIntervalMs?: number;
    });
    connect(): Promise<void>;
    appendPcm16(chunk: Buffer): void;
    commit(): void;
    clear(): void;
    close(): void;
    private maybeDecode;
    private decodeNow;
}
//# sourceMappingURL=sherpa-parakeet-realtime-session.d.ts.map