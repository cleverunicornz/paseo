import { isClaudePlaceholderModelId } from "./models.js";

const ONE_MILLION_CONTEXT_SUFFIX = "[1m]";

/**
 * Models Claude Code always runs with the 1M context window, so `<id>[1m]` and
 * `<id>` name the same model. The suffix only selects the context window, and
 * Claude Code strips it before the model ID reaches the provider. Source:
 * https://code.claude.com/docs/en/model-config, "Extended context": "On the
 * Anthropic API, Fable 5, Sonnet 5, and Opus 4.7 and later always run with the
 * 1M window" and "Claude Code strips the suffix before sending the model ID to
 * your provider"; the `sonnet[1m]` alias has "No effect when `sonnet` already
 * resolves to Sonnet 5.5 or Sonnet 5 with their native 1M window". The same
 * page names `claude-fable-5[1m]` as a saved spelling of Fable 5, which the
 * manifest keeps as an alias.
 *
 * A model with its own `[1m]` manifest entry, such as `claude-opus-4-6` and
 * `claude-sonnet-5`, has two windows, so its suffix names another model and is
 * not listed. Add a model only with a source like the one above.
 */
const ALWAYS_ONE_MILLION_CONTEXT_MODELS: readonly string[] = [
  "claude-fable-5",
  "claude-opus-5-5",
  "claude-opus-5",
  "claude-sonnet-5-5",
];

function isListedSpelling(pin: string, model: string): boolean {
  return ALWAYS_ONE_MILLION_CONTEXT_MODELS.some(
    (id) =>
      (pin === id && model === `${id}${ONE_MILLION_CONTEXT_SUFFIX}`) ||
      (pin === `${id}${ONE_MILLION_CONTEXT_SUFFIX}` && model === id),
  );
}

/**
 * The model a pinned session's runtime reports: the pin when `reported` is
 * exactly the pin or a listed spelling of it, otherwise `reported` as given, so
 * that the daemon stops the agent. A frame without a model or with a
 * placeholder such as `<synthetic>` reports nothing.
 */
export function pinnedRuntimeModel(pin: string, reported: unknown): string | null {
  if (typeof reported !== "string") return null;
  const model = reported.trim();
  if (!model || isClaudePlaceholderModelId(model)) return null;
  return model === pin || isListedSpelling(pin, model) ? pin : model;
}
