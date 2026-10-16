export declare const MAX_PHYSICAL_SOCKET_BUFFERED_BYTES: number;
export declare const APPLICATION_SOCKET_LEASE_MS = 45000;
export declare const APPLICATION_SOCKET_LEASE_CHECK_INTERVAL_MS = 10000;
type Clock = () => number;
export declare class ApplicationSocketLease<TSocket extends object> {
    private readonly clock;
    private readonly deadlines;
    constructor(clock?: Clock);
    claim(socket: TSocket): void;
    renew(socket: TSocket): void;
    release(socket: TSocket): void;
    listExpired(): TSocket[];
    clear(): void;
}
export declare function outboundFrameByteLength(data: string | Uint8Array | ArrayBuffer): number;
interface BoundedPhysicalSocket {
    readyState: number;
    bufferedAmount?: number;
    send: (data: string | Uint8Array | ArrayBuffer, callback?: (error?: Error) => void) => void | Promise<void>;
}
export declare function sendBoundedPhysicalFrameAndWait(params: {
    socket: BoundedPhysicalSocket;
    frame: string | Uint8Array | ArrayBuffer;
    frameBytes?: number;
    onHighWater: () => void;
}): Promise<boolean>;
export declare function physicalSocketHasCapacity(socket: Pick<BoundedPhysicalSocket, "bufferedAmount">, frameBytes: number): boolean;
export declare function sendBoundedPhysicalFrame(params: {
    socket: BoundedPhysicalSocket;
    frame: string | Uint8Array | ArrayBuffer;
    frameBytes?: number;
    onHighWater: () => void;
}): boolean;
export {};
//# sourceMappingURL=physical-socket.d.ts.map