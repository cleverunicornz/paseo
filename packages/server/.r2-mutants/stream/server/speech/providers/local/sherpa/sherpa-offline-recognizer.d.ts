import type pino from "pino";
export interface SherpaOfflineRecognizerModel {
    kind: "nemo_transducer";
    encoder: string;
    decoder: string;
    joiner: string;
    tokens: string;
}
export interface SherpaOfflineRecognizerConfig {
    model: SherpaOfflineRecognizerModel;
    numThreads?: number;
    provider?: "cpu";
    debug?: 0 | 1;
    sampleRate?: number;
    featureDim?: number;
    decodingMethod?: "greedy_search";
    maxActivePaths?: number;
}
interface SherpaOfflineRecognizerNative {
    config?: {
        featConfig?: {
            sampleRate?: number;
        };
    };
    createStream: () => unknown;
    decode: (stream: unknown) => void;
    getResult: (stream: unknown) => {
        text?: string;
    } | string | undefined;
    free?: () => void;
}
interface SherpaOfflineStreamNative {
    acceptWaveform: ((arg: {
        samples: Float32Array;
        sampleRate: number;
    }) => void) & ((sampleRate: number, samples: Float32Array) => void);
    free?: () => void;
}
export declare class SherpaOfflineRecognizerEngine {
    readonly recognizer: SherpaOfflineRecognizerNative;
    readonly sampleRate: number;
    private readonly logger;
    constructor(config: SherpaOfflineRecognizerConfig, logger: pino.Logger);
    createStream(): SherpaOfflineStreamNative;
    acceptWaveform(stream: SherpaOfflineStreamNative, sampleRate: number, samples: Float32Array): void;
    free(): void;
}
export {};
//# sourceMappingURL=sherpa-offline-recognizer.d.ts.map