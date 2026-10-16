import { type ChildProcessWithoutNullStreams } from "node:child_process";
import type { Logger } from "pino";
export { supportsJsonlRpcProtocolV2 } from "./jsonl-frame-decoder.js";
/** Default wall-clock timeout for control-plane / short RPC calls. */
export declare const JSONL_RPC_DEFAULT_TIMEOUT_MS = 30000;
/**
 * Pass as `timeoutMs` to wait only for a response, process death, or `close()`.
 * Use for long-running blocking RPCs (e.g. LLM-backed compact).
 */
export declare const JSONL_RPC_NO_TIMEOUT: null;
export interface JsonlRpcLaunch {
    command: string;
    args: string[];
    cwd: string;
    env?: Record<string, string>;
}
export interface JsonlRpcExit {
    code: number | null;
    signal: NodeJS.Signals | null;
    error: Error;
}
export interface JsonlRpcProcessOptions {
    launch: JsonlRpcLaunch;
    logger: Logger;
    diagnosticName?: string;
    defaultRequestTimeoutMs?: number;
    spawn?: (launch: JsonlRpcLaunch) => ChildProcessWithoutNullStreams;
}
export declare class JsonlRpcProcess {
    private readonly options;
    private readonly child;
    private readonly diagnosticName;
    private readonly pending;
    private readonly messageSubscribers;
    private readonly exitSubscribers;
    private stderrBuffer;
    private nextRequestId;
    private disposed;
    private exited;
    private closing;
    private readonly frameDecoder;
    constructor(options: JsonlRpcProcessOptions);
    onMessage(callback: (message: Record<string, unknown>) => void): () => void;
    onExit(callback: (exit: JsonlRpcExit) => void): () => void;
    startRequest(command: {
        type: string;
        [key: string]: unknown;
    }, timeoutMs?: number | null): {
        id: string;
        promise: Promise<unknown>;
    };
    request(command: {
        type: string;
        [key: string]: unknown;
    }, timeoutMs?: number | null): Promise<unknown>;
    /**
     * Send a command whose goal an exited process has already met — stopping a turn,
     * clearing a queue. Resolves once the child has exited instead of rejecting,
     * because nothing is queued and nothing is running, which is what the caller
     * asked for. Use `request` when the caller needs an answer from a live process.
     *
     * Keyed on an observed exit rather than on `disposed`: `close()` disposes the
     * transport before termination completes, and a child that outlives SIGKILL can
     * still be working, so a disposed transport is not proof the work stopped.
     */
    requestStopWork(command: {
        type: string;
        [key: string]: unknown;
    }, timeoutMs?: number | null): Promise<void>;
    send(message: Record<string, unknown>): void;
    close(error?: Error): Promise<void>;
    private terminate;
    private handleStdoutChunk;
    /** Route a complete logical frame to its consumer (pending request or subscriber). */
    private dispatchFrame;
    private settleRequest;
    private handleStdinError;
    private failAll;
}
//# sourceMappingURL=jsonl-rpc-process.d.ts.map