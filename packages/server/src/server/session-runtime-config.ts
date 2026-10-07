import type { PersistedConfig } from "./persisted-config.js";

/** How long shutdown waits for plugins to acknowledge timeline items still in flight. */
export const DEFAULT_TIMELINE_DRAIN_MS = 300_000;
export const MAX_TIMELINE_DRAIN_MS = 86_400_000;
/**
 * The worker's exit status when shutdown finished but some timeline items were
 * never acknowledged. It differs from a clean stop (0) and a crash (1).
 */
export const TIMELINE_DRAIN_FAILED_EXIT_CODE = 75;
/** Shutdown work besides the drain: closing agents, plugins and sockets. */
export const SHUTDOWN_GRACE_MS = 10_000;

/** `/` or `/segment/.../`: unreserved URL characters only, so it is safe in HTML, JS and regexes. */
export const WEB_BASE_PATH_PATTERN = /^\/(?:[A-Za-z0-9._~-]+\/)*$/;

export interface SessionRuntimeConfig {
  timelineDrainMs: number;
  singleAgent: boolean;
  /** `/` when the daemon serves at the origin root. */
  webBasePath: string;
}

export const DEFAULT_SESSION_RUNTIME_CONFIG: SessionRuntimeConfig = {
  timelineDrainMs: DEFAULT_TIMELINE_DRAIN_MS,
  singleAgent: false,
  webBasePath: "/",
};

export function parseTimelineDrainMs(value: unknown, source: string): number {
  const parsed = typeof value === "string" ? Number(value.trim()) : value;
  if (
    typeof parsed !== "number" ||
    !Number.isInteger(parsed) ||
    parsed < 0 ||
    parsed > MAX_TIMELINE_DRAIN_MS
  ) {
    throw new Error(`${source} must be an integer from 0 to ${MAX_TIMELINE_DRAIN_MS}`);
  }
  return parsed;
}

/** Accepts `/s/abc/` and `/s/abc`; always returns the form with both slashes. */
export function parseWebBasePath(value: string, source: string): string {
  const trimmed = value.trim();
  const withSlash = trimmed.endsWith("/") ? trimmed : `${trimmed}/`;
  if (!WEB_BASE_PATH_PATTERN.test(withSlash) || withSlash.includes("/../")) {
    throw new Error(
      `${source} must be a path such as /s/abc/ made of letters, digits and . _ ~ - segments`,
    );
  }
  return withSlash;
}

function parseBooleanSetting(value: string, source: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  throw new Error(`${source} must be true or false`);
}

/** Environment variables override the config file so a container can set them. */
export function resolveSessionRuntimeConfig(
  env: NodeJS.ProcessEnv,
  persisted: Pick<PersistedConfig, "daemon">,
): SessionRuntimeConfig {
  const daemon = persisted.daemon;
  const drainEnv = env.PASEO_TIMELINE_DRAIN_MS;
  const singleAgentEnv = env.PASEO_SINGLE_AGENT;
  const basePathEnv = env.PASEO_WEB_BASE_PATH;
  return {
    timelineDrainMs:
      drainEnv !== undefined && drainEnv.trim() !== ""
        ? parseTimelineDrainMs(drainEnv, "PASEO_TIMELINE_DRAIN_MS")
        : (daemon?.shutdown?.timelineDrainMs ?? DEFAULT_TIMELINE_DRAIN_MS),
    singleAgent:
      singleAgentEnv !== undefined && singleAgentEnv.trim() !== ""
        ? parseBooleanSetting(singleAgentEnv, "PASEO_SINGLE_AGENT")
        : (daemon?.singleAgent ?? false),
    webBasePath:
      basePathEnv !== undefined && basePathEnv.trim() !== ""
        ? parseWebBasePath(basePathEnv, "PASEO_WEB_BASE_PATH")
        : parseWebBasePath(daemon?.web?.basePath ?? "/", "daemon.web.basePath"),
  };
}
