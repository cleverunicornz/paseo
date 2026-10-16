import { claudeManifestModelSupportsFastMode } from "./model-manifest.js";
export const CLAUDE_FAST_MODE_FEATURE = {
    type: "toggle",
    id: "fast_mode",
    label: "Fast",
    description: "Lower latency Opus responses at higher token cost",
    tooltip: "Toggle fast mode",
    icon: "zap",
};
export function claudeModelSupportsFastMode(modelId) {
    return claudeManifestModelSupportsFastMode(modelId);
}
export function buildClaudeFeatures(input) {
    if (!claudeModelSupportsFastMode(input.modelId)) {
        return [];
    }
    return [
        {
            ...CLAUDE_FAST_MODE_FEATURE,
            value: input.fastModeEnabled,
        },
    ];
}
//# sourceMappingURL=feature-definitions.js.map