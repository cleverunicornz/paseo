import type { AgentFeature, AgentFeatureToggle } from "../../agent-sdk-types.js";
export declare const CLAUDE_FAST_MODE_FEATURE: Omit<AgentFeatureToggle, "value">;
export declare function claudeModelSupportsFastMode(modelId: string | null | undefined): boolean;
export declare function buildClaudeFeatures(input: {
    modelId: string | null | undefined;
    fastModeEnabled: boolean;
}): AgentFeature[];
//# sourceMappingURL=feature-definitions.d.ts.map