import type pino from "pino";
import { type PushPayload } from "./push-service.js";
export type { PushPayload };
export interface PushNotifications {
    renew(token: string): void;
    revoke(token: string): void;
    send(payload: PushPayload): Promise<void>;
}
export type PushNotificationSender = Pick<PushNotifications, "send">;
export declare function createPushNotifications(options: {
    logger: pino.Logger;
    filePath: string;
    now?: () => number;
    deliver?: (tokens: string[], payload: PushPayload) => Promise<void>;
}): PushNotifications;
//# sourceMappingURL=index.d.ts.map