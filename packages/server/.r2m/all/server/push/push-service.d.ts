import type pino from "pino";
export interface PushPayload {
    title: string;
    body: string;
    data?: Record<string, unknown>;
}
/**
 * Service for sending Expo push notifications.
 * Handles batching and invalid token removal.
 */
export declare class PushService {
    private readonly logger;
    private readonly revokeToken;
    constructor(logger: pino.Logger, revokeToken: (token: string) => void);
    sendPush(tokens: string[], payload: PushPayload): Promise<void>;
    private sendBatch;
    private handleTickets;
}
//# sourceMappingURL=push-service.d.ts.map