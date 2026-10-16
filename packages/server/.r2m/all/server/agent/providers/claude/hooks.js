/**
 * Combine Paseo's observation hooks with any the user configured, per event.
 *
 * Neither side wins: Claude Code runs every matcher registered for an event, so appending keeps
 * a user's hooks working while Paseo keeps observing. Assigning either one would silently drop
 * the other, and the failure would be invisible — effort would simply stop appearing.
 */
export function mergeClaudeHooks(own, extra) {
    if (!extra || typeof extra !== "object")
        return own;
    const merged = { ...own };
    for (const [event, matchers] of Object.entries(extra)) {
        if (!Array.isArray(matchers))
            continue;
        const key = event;
        merged[key] = [...(merged[key] ?? []), ...matchers];
    }
    return merged;
}
//# sourceMappingURL=hooks.js.map