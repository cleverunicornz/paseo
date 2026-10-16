export type JsonlFrameProblem = "invalid-json" | "invalid-chunk" | "invalid-base64" | "out-of-order-chunk" | "chunk-length-mismatch" | "invalid-chunk-payload";
export declare function supportsJsonlRpcProtocolV2(message: Record<string, unknown>): boolean;
export declare class JsonlFrameDecoder {
    private readonly receiver;
    private lineBuffer;
    private assembly;
    constructor(receiver: {
        frame(message: Record<string, unknown>): void;
        problem(problem: JsonlFrameProblem, detail?: unknown): void;
    });
    write(text: string): void;
    private consumeLine;
    private consumeChunk;
    private finishAssembly;
    private drop;
}
//# sourceMappingURL=jsonl-frame-decoder.d.ts.map