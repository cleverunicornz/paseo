import { MAX_EXPLICIT_AGENT_TITLE_CHARS } from "@getpaseo/protocol/agent-title-limits";
const MAX_INITIAL_AGENT_TITLE_CHARS = Math.min(60, MAX_EXPLICIT_AGENT_TITLE_CHARS);
function deriveInitialAgentTitle(prompt) {
    const firstContentLine = prompt
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find((line) => line.length > 0);
    if (!firstContentLine) {
        return null;
    }
    const normalized = firstContentLine.replace(/\s+/g, " ").trim();
    if (!normalized) {
        return null;
    }
    const clamped = normalized.slice(0, MAX_INITIAL_AGENT_TITLE_CHARS).trim();
    return clamped.length > 0 ? clamped : null;
}
export function resolveCreateAgentTitles(options) {
    const explicitTitle = typeof options.configTitle === "string" && options.configTitle.trim().length > 0
        ? options.configTitle.trim()
        : null;
    const trimmedPrompt = options.initialPrompt?.trim();
    const provisionalTitle = explicitTitle ?? (trimmedPrompt ? deriveInitialAgentTitle(trimmedPrompt) : null);
    return {
        explicitTitle,
        provisionalTitle,
    };
}
export function resolveFirstAgentPromptTitle(firstAgentContext) {
    return (resolveCreateAgentTitles({
        initialPrompt: firstAgentContext?.prompt,
    }).provisionalTitle ?? null);
}
//# sourceMappingURL=create-agent-title.js.map