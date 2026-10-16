import type { V2Api } from "./api.js";
interface ReadinessInput {
    client: Pick<V2Api, "plugin">;
    location: {
        directory: string;
    };
    signal?: AbortSignal;
    timeoutMs?: number;
}
export declare class OpenCodeLocationReadyTimeoutError extends Error {
    readonly directory: string;
    readonly waitedMs: number;
    constructor(directory: string, waitedMs: number);
}
export declare function waitForLocationReady(input: ReadinessInput): Promise<void>;
export declare function awaitPaseoPlugin(input: ReadinessInput): Promise<void>;
export {};
//# sourceMappingURL=readiness.d.ts.map