export declare class Pcm16MonoResampler {
    private readonly inputRate;
    private readonly outputRate;
    private readonly step;
    private pos;
    private carrySample;
    constructor(params: {
        inputRate: number;
        outputRate: number;
    });
    reset(): void;
    processChunk(pcm16le: Buffer): Buffer;
}
//# sourceMappingURL=pcm16-resampler.d.ts.map