export declare function parsePcm16MonoWav(buffer: Buffer): {
    sampleRate: number;
    pcm16: Buffer;
};
export declare function parsePcmRateFromFormat(format: string, fallback?: number | null): number | null;
export declare function pcm16lePeakAbs(pcm16le: Buffer): number;
export declare function pcm16leToFloat32(pcm16le: Buffer, gain?: number): Float32Array;
export declare function float32ToPcm16le(samples: Float32Array): Buffer;
export declare function chunkBuffer(buffer: Buffer, chunkBytes: number): Buffer[];
//# sourceMappingURL=audio.d.ts.map