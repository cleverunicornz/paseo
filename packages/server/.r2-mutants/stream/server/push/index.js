import { PushService } from "./push-service.js";
import { PushTokenStore } from "./token-store.js";
const PUSH_TOKEN_LEASE_MS = 48 * 60 * 60 * 1000;
export function createPushNotifications(options) {
    const now = options.now ?? Date.now;
    const store = new PushTokenStore(options.logger, options.filePath, now, PUSH_TOKEN_LEASE_MS);
    const service = new PushService(options.logger, (token) => store.revokeToken(token));
    const deliver = options.deliver ??
        ((tokens, payload) => service.sendPush(tokens, payload));
    return {
        renew(token) {
            store.renewToken(token);
        },
        revoke(token) {
            store.revokeToken(token);
        },
        async send(payload) {
            const tokens = store.getActiveTokens();
            options.logger.info({ tokenCount: tokens.length }, "Sending push notification");
            if (tokens.length === 0)
                return;
            await deliver(tokens, payload);
        },
    };
}
//# sourceMappingURL=index.js.map