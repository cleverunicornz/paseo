import type { Logger } from "pino";
import { type JsonlRpcExit } from "../jsonl-rpc-process.js";
export interface OmpProtocolTransport {
    onMessage(callback: (message: Record<string, unknown>) => void): () => void;
    onExit(callback: (exit: JsonlRpcExit) => void): () => void;
    request(command: Record<string, unknown>, timeoutMs: number | null): Promise<unknown>;
}
export interface OmpProtocolTimeouts {
    readyTimeoutMs?: number;
    requestTimeoutMs?: number;
}
export declare function establishOmpProtocol(transport: OmpProtocolTransport, logger: Logger, timeouts?: OmpProtocolTimeouts): Promise<void>;
//# sourceMappingURL=protocol-session.d.ts.map