const PROMPT_PREVIEW_MAX_LENGTH = 120;
function promptPreview(text) {
    const collapsed = text.replace(/\s+/g, " ").trim();
    if (collapsed.length <= PROMPT_PREVIEW_MAX_LENGTH) {
        return collapsed;
    }
    return `${collapsed.slice(0, PROMPT_PREVIEW_MAX_LENGTH - 1)}…`;
}
export function buildTimelinePromptIndex(epoch, rows) {
    return {
        epoch,
        prompts: rows.flatMap((row) => row.item.type === "user_message"
            ? [
                {
                    seq: row.seq,
                    timestamp: row.timestamp,
                    preview: promptPreview(row.item.text),
                },
            ]
            : []),
    };
}
//# sourceMappingURL=timeline-prompt-index.js.map