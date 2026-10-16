import type { Logger } from "pino";
import type { AgentModelDefinition } from "../../agent-sdk-types.js";
export declare function getClaudeModels(claudeCodeVersion?: string): AgentModelDefinition[];
export declare function resolveConfiguredClaudeModel(model: AgentModelDefinition): AgentModelDefinition;
export declare function findClaudeModel(modelId: string | null | undefined): AgentModelDefinition | undefined;
export declare function getClaudeModelsWithSettings(logger: Logger, configDir: string, claudeCodeVersion?: string): Promise<AgentModelDefinition[]>;
/**
 * Normalize a runtime model string (from SDK init message) to a known model ID.
 * Handles the `[1m]` suffix that the SDK appends for 1M context sessions.
 */
export declare function normalizeClaudeRuntimeModelId(value: string | null | undefined): string | null;
/**
 * Resolve a model id observed on a Claude assistant frame, for display.
 *
 * Prefers the manifest-normalized id so equivalent spellings collapse (a dated alias and a
 * gateway prefix are the same model), but falls back to the raw string when the manifest does
 * not know it. The fallback matters: Claude Code is an Anthropic-compatible client, so subagents
 * routinely report models that are not Anthropic's — Z.AI GLM ids via `ANTHROPIC_BASE_URL`
 * (docs/custom-providers.md) among them. Manifest-only resolution would blank the model for
 * exactly those users.
 *
 * A `[1m]` suffix is preserved where it names its own manifest entry. Models such as Fable 5
 * that only have a 1M entry normalize the retired suffixed spelling to the canonical ID.
 *
 * Returns null for placeholders and empty values, meaning "not observed".
 */
export declare function resolveObservedClaudeModelId(value: string | null | undefined): string | null;
//# sourceMappingURL=models.d.ts.map