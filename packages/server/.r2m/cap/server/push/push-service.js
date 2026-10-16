const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const MAX_BATCH_SIZE = 100;
/**
 * Service for sending Expo push notifications.
 * Handles batching and invalid token removal.
 */
export class PushService {
    constructor(logger, revokeToken) {
        this.logger = logger.child({ component: "push-service" });
        this.revokeToken = revokeToken;
    }
    async sendPush(tokens, payload) {
        if (tokens.length === 0) {
            return;
        }
        const messages = tokens.map((token) => ({
            to: token,
            title: payload.title,
            body: payload.body,
            data: payload.data,
            sound: "default",
        }));
        // Batch tokens (max 100 per request per Expo limits)
        const batches = [];
        for (let i = 0; i < messages.length; i += MAX_BATCH_SIZE) {
            batches.push(messages.slice(i, i + MAX_BATCH_SIZE));
        }
        await Promise.all(batches.map((batch) => this.sendBatch(batch)));
    }
    async sendBatch(messages) {
        try {
            const response = await fetch(EXPO_PUSH_URL, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Accept: "application/json",
                },
                body: JSON.stringify(messages),
            });
            if (!response.ok) {
                this.logger.error({ status: response.status, statusText: response.statusText }, "Expo push API error");
                return;
            }
            const result = (await response.json());
            this.handleTickets(messages, result.data);
        }
        catch (error) {
            this.logger.error({ err: error }, "Failed to send push notifications");
        }
    }
    handleTickets(messages, tickets) {
        for (let i = 0; i < tickets.length; i++) {
            const ticket = tickets[i];
            const message = messages[i];
            if (ticket.status === "error") {
                this.logger.error({ token: message.to, message: ticket.message, details: ticket.details }, "Push failed for token");
                // Remove invalid tokens
                if (ticket.details?.error === "DeviceNotRegistered" ||
                    ticket.details?.error === "InvalidCredentials") {
                    this.revokeToken(message.to);
                }
            }
        }
    }
}
//# sourceMappingURL=push-service.js.map