import type { AgentModelDefinition, AgentSelectOption } from "../../agent-sdk-types.js";
export declare const CLAUDE_DEFAULT_THINKING_OPTION_ID = "high";
export declare const CLAUDE_DISABLED_THINKING_OPTION_ID = "off";
export declare const CLAUDE_ULTRACODE_THINKING_OPTION_ID = "ultracode";
export declare const CLAUDE_MODEL_MANIFEST: readonly [{
    readonly id: "claude-opus-5-5";
    readonly label: "Opus 5.5";
    readonly description: "Opus 5.5 · Latest release";
    readonly defaultPriority: 3;
    readonly minimumClaudeCodeVersion: "2.1.280";
    readonly defaultThinkingOptionId: "medium";
    readonly contextWindowMaxTokens: 1000000;
    readonly effortLevels: readonly ["low", "medium", "high", "xhigh", "max"];
    readonly supportsFastMode: true;
}, {
    readonly id: "claude-opus-5";
    readonly label: "Opus 5";
    readonly description: "Opus 5 · Previous release";
    readonly defaultPriority: 2;
    readonly minimumClaudeCodeVersion: "2.1.219";
    readonly contextWindowMaxTokens: 1000000;
    readonly effortLevels: readonly ["low", "medium", "high", "xhigh", "max"];
    readonly supportsThinkingDisabled: true;
    readonly supportsFastMode: true;
}, {
    readonly id: "claude-fable-5-1";
    readonly label: "Fable 5.1";
    readonly description: "Fable 5.1 · Most powerful model";
    readonly contextWindowMaxTokens: 1000000;
    readonly effortLevels: readonly ["low", "medium", "high", "xhigh", "max"];
}, {
    readonly id: "claude-fable-5";
    readonly aliases: readonly ["claude-fable-5[1m]"];
    readonly label: "Fable 5";
    readonly description: "Fable 5 · Previous release";
    readonly minimumClaudeCodeVersion: "2.1.169";
    readonly contextWindowMaxTokens: 1000000;
    readonly effortLevels: readonly ["low", "medium", "high", "xhigh", "max"];
}, {
    readonly id: "claude-opus-4-8[1m]";
    readonly label: "Opus 4.8 1M";
    readonly description: "Opus 4.8 with 1M context window";
    readonly contextWindowMaxTokens: 1000000;
    readonly effortLevels: readonly ["low", "medium", "high", "xhigh", "max"];
    readonly supportsThinkingDisabled: true;
    readonly supportsFastMode: true;
}, {
    readonly id: "claude-opus-4-8";
    readonly label: "Opus 4.8";
    readonly description: "Opus 4.8 · Previous release";
    readonly defaultPriority: 1;
    readonly contextWindowMaxTokens: 200000;
    readonly effortLevels: readonly ["low", "medium", "high", "xhigh", "max"];
    readonly supportsThinkingDisabled: true;
    readonly supportsFastMode: true;
}, {
    readonly id: "claude-sonnet-5-5";
    readonly label: "Sonnet 5.5";
    readonly description: "Sonnet 5.5 · Best for everyday tasks";
    readonly minimumClaudeCodeVersion: "2.1.284";
    readonly defaultThinkingOptionId: "medium";
    readonly contextWindowMaxTokens: 1000000;
    readonly effortLevels: readonly ["low", "medium", "high", "xhigh", "max"];
}, {
    readonly id: "claude-sonnet-5";
    readonly label: "Sonnet 5";
    readonly description: "Sonnet 5 · Previous release";
    readonly contextWindowMaxTokens: 200000;
    readonly effortLevels: readonly ["low", "medium", "high", "xhigh", "max"];
    readonly supportsThinkingDisabled: true;
}, {
    readonly id: "claude-sonnet-5[1m]";
    readonly label: "Sonnet 5 1M";
    readonly description: "Sonnet 5 with 1M context window";
    readonly contextWindowMaxTokens: 1000000;
    readonly effortLevels: readonly ["low", "medium", "high", "xhigh", "max"];
    readonly supportsThinkingDisabled: true;
}, {
    readonly id: "claude-opus-4-7[1m]";
    readonly label: "Opus 4.7 1M";
    readonly description: "Opus 4.7 with 1M context window";
    readonly contextWindowMaxTokens: 1000000;
    readonly effortLevels: readonly ["low", "medium", "high", "xhigh", "max"];
    readonly supportsThinkingDisabled: true;
    readonly supportsFastMode: true;
}, {
    readonly id: "claude-opus-4-7";
    readonly label: "Opus 4.7";
    readonly description: "Opus 4.7 · Previous release";
    readonly contextWindowMaxTokens: 200000;
    readonly effortLevels: readonly ["low", "medium", "high", "xhigh", "max"];
    readonly supportsThinkingDisabled: true;
    readonly supportsFastMode: true;
}, {
    readonly id: "claude-opus-4-6[1m]";
    readonly label: "Opus 4.6 1M";
    readonly description: "Opus 4.6 with 1M context window";
    readonly contextWindowMaxTokens: 1000000;
    readonly effortLevels: readonly ["low", "medium", "high", "max"];
    readonly supportsThinkingDisabled: true;
    readonly supportsFastMode: true;
}, {
    readonly id: "claude-opus-4-6";
    readonly label: "Opus 4.6";
    readonly description: "Opus 4.6 · Most capable for complex work";
    readonly contextWindowMaxTokens: 200000;
    readonly effortLevels: readonly ["low", "medium", "high", "max"];
    readonly supportsThinkingDisabled: true;
    readonly supportsFastMode: true;
}, {
    readonly id: "claude-sonnet-4-6[1m]";
    readonly label: "Sonnet 4.6 1M";
    readonly description: "Sonnet 4.6 with 1M context window";
    readonly contextWindowMaxTokens: 1000000;
    readonly effortLevels: readonly ["low", "medium", "high", "max"];
    readonly supportsThinkingDisabled: true;
}, {
    readonly id: "claude-sonnet-4-6";
    readonly label: "Sonnet 4.6";
    readonly description: "Sonnet 4.6 · Best for everyday tasks";
    readonly contextWindowMaxTokens: 200000;
    readonly effortLevels: readonly ["low", "medium", "high", "max"];
    readonly supportsThinkingDisabled: true;
}, {
    readonly id: "claude-haiku-5-5";
    readonly label: "Haiku 5.5";
    readonly description: "Haiku 5.5 · Fastest for quick answers";
    readonly minimumClaudeCodeVersion: "2.1.293";
    readonly defaultThinkingOptionId: "medium";
    readonly contextWindowMaxTokens: 1000000;
    readonly effortLevels: readonly ["low", "medium", "high", "xhigh", "max"];
    readonly supportsThinkingDisabled: true;
}, {
    readonly id: "claude-haiku-4-5";
    readonly label: "Haiku 4.5";
    readonly description: "Haiku 4.5 · Previous release";
    readonly contextWindowMaxTokens: 200000;
}];
export declare function getClaudeManifestModels(claudeCodeVersion?: string): AgentModelDefinition[];
export declare function parseClaudeCodeVersion(value: string): [number, number, number] | null;
export interface ClaudeDisabledThinkingResolution {
    supported: boolean;
    fallbackThinkingOptionId: string | undefined;
}
/**
 * Resolve the disabled-thinking capability from the curated manifest only. Runtime/provider
 * model aliases intentionally do not inherit this capability.
 */
export declare function resolveClaudeDisabledThinkingForModel(modelId: string | null | undefined): ClaudeDisabledThinkingResolution;
export declare function isClaudeManifestModelId(modelId: string): boolean;
export declare function claudeManifestModelSupportsFastMode(modelId: string | null | undefined): boolean;
/**
 * Normalize first-party Claude model IDs for manifest capability checks. Provider-prefixed
 * runtime IDs intentionally use normalizeClaudeRuntimeModelId instead.
 */
export declare function normalizeClaudeManifestModelId(value: string | null | undefined): string | null;
/**
 * Normalize a Claude Code runtime/config model string to a known manifest ID.
 * Runtime metadata may include provider prefixes such as Bedrock model IDs; feature
 * gates should use normalizeClaudeManifestModelId instead. The prefixed matches are
 * unanchored, so major-minor runs first: "claude-opus-5-5" would otherwise stop at the
 * "claude-opus-5" entry.
 */
export declare function normalizeClaudeRuntimeModelId(value: string | null | undefined): string | null;
export declare function getClaudeCustomModelThinkingOptions(): AgentSelectOption[];
//# sourceMappingURL=model-manifest.d.ts.map