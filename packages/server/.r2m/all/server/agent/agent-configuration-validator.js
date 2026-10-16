import { filterSelectableAgentModels } from "./agent-sdk-types.js";
export function validateAgentConfigurationAgainstProvider({ input, provider, }) {
    const issues = [];
    const models = filterSelectableAgentModels(provider.models);
    const requestedModel = input.model;
    const selectedModel = requestedModel
        ? models.find((model) => model.id === requestedModel || model.aliases?.includes(requestedModel))
        : (models.find((model) => model.isDefault) ?? models[0]);
    if (requestedModel && !selectedModel) {
        issues.push({
            path: ["model"],
            message: `Model '${requestedModel}' is not available for provider '${input.provider}'`,
        });
    }
    if (input.modeId && !provider.modes?.some((mode) => mode.id === input.modeId)) {
        issues.push({
            path: ["modeId"],
            message: `Mode '${input.modeId}' is not available for provider '${input.provider}'`,
        });
    }
    if (input.thinkingOptionId &&
        !selectedModel?.thinkingOptions?.some((option) => option.id === input.thinkingOptionId)) {
        issues.push({
            path: ["thinkingOptionId"],
            message: `Thinking option '${input.thinkingOptionId}' is not available for provider '${input.provider}'`,
        });
    }
    return issues;
}
//# sourceMappingURL=agent-configuration-validator.js.map