import { EventEmitter } from "node:events";
export interface EncryptedRelayChannel {
    setState: (state: "open") => void;
    send: (data: string | ArrayBuffer) => Promise<void>;
    outboundWireByteLength: (data: string | ArrayBuffer) => number;
    close: (code?: number, reason?: string) => void;
}
export interface EncryptedRelaySocket {
    readonly readyState: number;
    readonly bufferedAmount: number;
    send: (data: string | Uint8Array | ArrayBuffer) => void | Promise<void>;
    close: (code?: number, reason?: string) => void;
    terminate: () => void;
    on: (event: "message" | "close" | "error", listener: (...args: unknown[]) => void) => void;
    once: (event: "close" | "error", listener: (...args: unknown[]) => void) => void;
}
export declare function createEncryptedRelaySocket(params: {
    channel: EncryptedRelayChannel;
    emitter: EventEmitter;
    getTransportBufferedAmount: () => number | undefined;
    terminateTransport: () => void;
}): EncryptedRelaySocket;
//# sourceMappingURL=encrypted-relay-socket.d.ts.map