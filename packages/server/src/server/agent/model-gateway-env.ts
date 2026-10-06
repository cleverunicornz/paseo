import type { ProcessEnvRecord } from "../paseo-env.js";

/**
 * Every model-provider credential and endpoint variable a harness could
 * inherit, whichever provider it runs. A harness whose model traffic goes
 * through the daemon's gateway gets none of them from the daemon process,
 * runtime settings or launch values; it gets only its own gateway values.
 */
export const MODEL_PROVIDER_ENV_KEYS = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_BASE_URL",
  "CLAUDE_CODE_OAUTH_TOKEN",
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "CODEX_API_KEY",
] as const;

/**
 * A gateway harness's launch environment: the launch values with every
 * model-provider variable removed, then the harness's own gateway values.
 * Applied as the last overlay, so it holds over every inherited source.
 */
export function withModelGatewayEnv(
  launchEnv: Record<string, string> | undefined,
  gatewayValues: Record<string, string>,
): ProcessEnvRecord {
  const env: ProcessEnvRecord = { ...launchEnv };
  for (const key of MODEL_PROVIDER_ENV_KEYS) {
    env[key] = undefined;
  }
  return Object.assign(env, gatewayValues);
}
