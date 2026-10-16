import { v4 as uuidv4 } from "uuid";
export function normalizeClientMessageId(clientMessageId) {
    if (typeof clientMessageId !== "string") {
        return undefined;
    }
    const trimmed = clientMessageId.trim();
    return trimmed.length > 0 ? trimmed : undefined;
}
export function resolveClientMessageId(clientMessageId, generateId = uuidv4) {
    return normalizeClientMessageId(clientMessageId) ?? generateId();
}
//# sourceMappingURL=client-message-id.js.map