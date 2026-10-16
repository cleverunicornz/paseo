export function normalizeAgentModelDefinition(model) {
    const defaultThinkingOptionId = model.defaultThinkingOptionId ?? model.thinkingOptions?.find((option) => option.isDefault)?.id;
    if (!defaultThinkingOptionId || defaultThinkingOptionId === model.defaultThinkingOptionId) {
        return model;
    }
    return { ...model, defaultThinkingOptionId };
}
export function filterSelectableAgentModels(models) {
    return models?.filter((model) => model.isSelectable !== false) ?? [];
}
export const TOOL_CALL_ICON_NAMES = [
    "wrench",
    "square_terminal",
    "eye",
    "pencil",
    "search",
    "bot",
    "sparkles",
    "brain",
    "mic_vocal",
];
export function getAgentStreamEventTurnId(event) {
    return "turnId" in event ? event.turnId : undefined;
}
//# sourceMappingURL=agent-sdk-types.js.map