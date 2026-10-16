import { EventEmitter } from "node:events";
import type { TurnDetectionSession } from "../../../turn-detection-provider.js";
export declare function resolveBundledSileroVadModelPath(): string;
export interface SherpaSileroVadSessionConfig {
    modelPath?: string;
    sampleRate?: number;
    threshold?: number;
    windowSize?: number;
    bufferSizeInSeconds?: number;
    confirmMs?: number;
    silenceMs?: number;
}
export declare class SherpaSileroVadSession extends EventEmitter implements TurnDetectionSession {
    readonly requiredSampleRate: number;
    private readonly vad;
    private readonly inputBuffer;
    private readonly windowSize;
    private readonly msPerWindow;
    private readonly confirmMs;
    private readonly silenceMs;
    private connected;
    private phase;
    private windowTimestamp;
    private readonly logger;
    constructor(params: {
        logger: {
            debug: (...args: unknown[]) => void;
        };
        config?: SherpaSileroVadSessionConfig;
    });
    connect(): Promise<void>;
    appendPcm16(pcm16le: Buffer): void;
    flush(): void;
    reset(): void;
    close(): void;
    private stepStateMachine;
}
//# sourceMappingURL=silero-vad-session.d.ts.map