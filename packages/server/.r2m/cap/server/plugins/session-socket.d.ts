import type { PluginProcessRequest } from "./plugin-process-protocol.js";
interface PluginProcessSender {
    send(message: PluginProcessRequest, callback?: (error: Error | null) => void): boolean;
}
type SocketEvent = "message" | "close" | "error";
type SocketListener = (...args: unknown[]) => void;
export declare class PluginSessionSocket {
    private readonly child;
    readyState: number;
    bufferedAmount: number;
    private readonly listeners;
    private readonly onceListeners;
    constructor(child: PluginProcessSender);
    send(data: string | Uint8Array | ArrayBuffer, callback?: (error?: Error) => void): void;
    receive(data: string | Uint8Array, isBinary: boolean): void;
    close(code?: number, reason?: string): void;
    peerClosed(): void;
    on(event: SocketEvent, listener: SocketListener): void;
    once(event: "close" | "error", listener: SocketListener): void;
    private emit;
}
export {};
//# sourceMappingURL=session-socket.d.ts.map