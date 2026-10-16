export interface SherpaOnnxNodeModule {
    OfflineRecognizer: new (config: unknown) => unknown;
    OnlineRecognizer?: new (config: unknown) => unknown;
    OfflineTts?: new (config: unknown) => unknown;
    Vad?: new (config: unknown, bufferSizeInSeconds: number) => unknown;
    CircularBuffer?: new (capacity: number) => unknown;
}
export declare function loadSherpaOnnxNode(): SherpaOnnxNodeModule;
//# sourceMappingURL=sherpa-onnx-node-loader.d.ts.map