import type { SessionInboundMessage, SessionOutboundMessage } from "../../messages.js";
export interface OwnedOperation {
    readonly source: object;
    readonly signal: AbortSignal;
    emit(message: SessionOutboundMessage): void;
    release(): Promise<void>;
}
export interface OwnedSubscription {
    readonly id: string;
    readonly responseId: string;
    readonly source: object;
    readonly signal: AbortSignal;
    emit(message: SessionOutboundMessage): void;
    emitBinary(frame: Uint8Array): void;
    release(): Promise<void>;
}
/** Source provenance and lifetimes. Domain producers own snapshots, filters and buffering. */
export declare class SessionDelivery {
    private readonly send;
    private readonly sendBinary;
    private readonly project;
    private readonly unexpectedReply;
    private readonly sources;
    private readonly proofs;
    private readonly defaultSource;
    private readonly scope;
    private closing?;
    constructor(send: (source: object, message: SessionOutboundMessage) => void, sendBinary?: (source: object, frame: Uint8Array) => void, project?: (source: object, message: SessionOutboundMessage) => SessionOutboundMessage, unexpectedReply?: (request: SessionInboundMessage, message: SessionOutboundMessage) => void);
    attach(socket: object, modern: boolean): void;
    get currentSource(): object | undefined;
    private get currentRequest();
    get requestSignal(): AbortSignal;
    forSource<T>(source: object, project: () => T): T;
    hasLegacySources(): boolean;
    hasDemand(family: string): boolean;
    subscriptionIds(source: object, family: string): string[];
    get registrationCount(): number;
    sourceRegistrationCount(socket?: object | undefined): number;
    releaseFamily(family: string): Promise<void>;
    isModern(socket: object | undefined): boolean;
    detach(socket: object): Promise<void>;
    close(): Promise<void>;
    private dispose;
    request(socket: object | undefined, request: SessionInboundMessage, run: () => Promise<void>): Promise<void>;
    protocolFailure(socket: object, failure: {
        requestId?: string;
        requestType?: string;
        error: string;
        code: "invalid_message" | "unknown_schema";
    }): void;
    authorizeReply(message: SessionOutboundMessage, socket: object): SessionOutboundMessage;
    reply(message: SessionOutboundMessage): boolean;
    begin(family: string, requestedId: string | undefined, stop: (id: string) => void | Promise<void>, legacySlot?: string): OwnedSubscription;
    /** A domain extends the originating request until its asynchronous operation ends. */
    operation(accepts: (message: SessionOutboundMessage) => boolean, stop: () => void | Promise<void>): OwnedOperation;
    release(id: string): Promise<void>;
    releaseLegacySlot(slot: string): Promise<void>;
    authorizeFileReply(frame: Uint8Array, socket: object): void;
    permitsBinary(socket: object, frame: Uint8Array): boolean;
    permits(socket: object, message: SessionOutboundMessage): boolean;
    private sendOwned;
    private releaseOwner;
}
//# sourceMappingURL=index.d.ts.map