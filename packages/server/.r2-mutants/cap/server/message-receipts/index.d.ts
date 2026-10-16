interface SendMessageInput {
    agentId: string;
    messageId: string;
    request: unknown;
    send: () => Promise<void>;
    prepare?: () => Promise<void>;
}
/** Owns message delivery receipts; creation is owned by CreationService. */
export declare class MessageReceipts {
    private readonly directory;
    private readonly pending;
    constructor(directory: string);
    send(input: SendMessageInput): Promise<void>;
    private sendOnce;
}
export {};
//# sourceMappingURL=index.d.ts.map