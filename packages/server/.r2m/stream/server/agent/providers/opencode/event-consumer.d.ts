import { type GlobalEvent, type OpencodeClient } from "@opencode-ai/sdk/v2/client";
import type { Logger } from "pino";
export type OpenCodeEventSourceInput = GlobalEvent | {
    type: "server-exited";
    error: Error;
};
export interface OpenCodeEventSource {
    ready(): Promise<void>;
    subscribe(listener: (input: OpenCodeEventSourceInput) => void): () => void;
    diagnostics?(): OpenCodeEventStreamDiagnostics;
}
export interface OpenCodeEventStreamDiagnostics {
    attempt: number;
    phase: "first-record" | "stream";
    elapsedMs: number;
    lastOutcome?: "ended" | "error" | "watchdog";
    lastError?: string;
}
export interface OpenCodeEventConsumerTiming {
    arm(delayMs: number, callback: () => void): () => void;
    wait(delayMs: number, signal: AbortSignal): Promise<void>;
}
export interface OpenCodeEventConsumerOptions {
    serverUrl: string;
    processExit: Promise<Error>;
    listening?: Promise<void>;
    logger: Pick<Logger, "debug" | "warn">;
    createClient?: (baseUrl: string) => OpencodeClient;
    timing?: OpenCodeEventConsumerTiming;
}
export declare class OpenCodeEventConsumer implements OpenCodeEventSource {
    private readonly listeners;
    private readonly client;
    private readonly logger;
    private readonly timing;
    private readonly startedAt;
    private readonly readyPromise;
    private resolveReady;
    private rejectReady;
    private connectionAbort;
    private connectionTask;
    private attempt;
    private phase;
    private lastOutcome?;
    private lastError?;
    private connected;
    private closed;
    constructor(options: OpenCodeEventConsumerOptions);
    ready(): Promise<void>;
    subscribe(listener: (input: OpenCodeEventSourceInput) => void): () => void;
    diagnostics(): OpenCodeEventStreamDiagnostics;
    close(): Promise<void>;
    private consume;
    private consumeConnection;
    private logPluginFailure;
    private logConnectionFailure;
    private exit;
    private publish;
}
export type OpenCodeEventConsumerFactory = (options: Pick<OpenCodeEventConsumerOptions, "serverUrl" | "processExit" | "logger" | "listening">) => OpenCodeEventConsumer;
//# sourceMappingURL=event-consumer.d.ts.map