/** Preserve extension context as an expandable tool row instead of assistant speech. */
export function mapCustomMessageToToolCall(message, text, callId) {
    const customType = typeof message.customType === "string" && message.customType.trim()
        ? message.customType
        : "custom-message";
    return {
        type: "tool_call",
        callId,
        name: customType,
        status: "completed",
        detail: { type: "plain_text", text },
        metadata: {
            synthetic: true,
            customType,
            ...(message.details === undefined ? {} : { details: message.details }),
        },
        error: null,
    };
}
//# sourceMappingURL=custom-message.js.map