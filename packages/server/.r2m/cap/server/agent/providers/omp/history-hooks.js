import { mapOmpAdvisorMessageToToolCall } from "./advisor-message.js";
import { mapOmpSystemNoticeToNotification } from "./system-notice.js";
import { mapOmpToolDetail } from "./tool-call-mapper.js";
import { resolveOmpEmittedToolCallId } from "./tool-call-id.js";
export const OMP_HISTORY_MAPPER_HOOKS = {
    mapToolDetail: mapOmpToolDetail,
    mapCustomMessage: (message, text, provider) => {
        const item = mapOmpAdvisorMessageToToolCall(message, text) ?? mapOmpSystemNoticeToNotification(text);
        return item ? { type: "timeline", provider, item } : null;
    },
    resolveToolCallId: resolveOmpEmittedToolCallId,
};
//# sourceMappingURL=history-hooks.js.map