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

/** `<provider>/<model>` in lowercase, at most `SESSION_MEMBER_MAX_LENGTH` characters. */
export const SESSION_MEMBER_PATTERN = /^([a-z0-9-]+\/)?[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/;
export const SESSION_MEMBER_MAX_LENGTH = 128;

/** The roles a session pod runs under. `infra` runs only on the console, never in a session pod. */
export const SESSION_ROLES = [
  "orchestrator",
  "scout",
  "implementer",
  "validator",
  "advisor",
] as const;
export type SessionRole = (typeof SESSION_ROLES)[number];

/**
 * Who a session pod runs as: the member (provider and model) and the role its
 * creator wrote on the pod. Fixed for the daemon's lifetime.
 */
export interface SessionIdentity {
  member: string;
  role: SessionRole;
}

export interface SessionRuntimeConfig {
  timelineDrainMs: number;
  singleAgent: boolean;
  /** `/` when the daemon serves at the origin root. */
  webBasePath: string;
  /** Set in session mode only; null runs the daemon as before. */
  identity: SessionIdentity | null;
}

export const DEFAULT_SESSION_RUNTIME_CONFIG: SessionRuntimeConfig = {
  timelineDrainMs: DEFAULT_TIMELINE_DRAIN_MS,
  singleAgent: false,
  webBasePath: "/",
  identity: null,
};

function isSessionRole(value: string): value is SessionRole {
  return (SESSION_ROLES as readonly string[]).includes(value);
}

/**
 * Session mode starts when `CVU_MEMBER` is set, even to an empty value: the
 * session pod's creator writes the member and role as pod annotations and the
 * pod passes them in, so an empty value is a pod without its annotation and
 * the daemon refuses to start rather than run without its member.
 */
export function parseSessionIdentity(env: NodeJS.ProcessEnv): SessionIdentity | null {
  const member = env.CVU_MEMBER;
  if (member === undefined) return null;
  if (member.length > SESSION_MEMBER_MAX_LENGTH || !SESSION_MEMBER_PATTERN.test(member)) {
    throw new Error(
      `CVU_MEMBER must be a member such as codex/gpt-6-astra: lowercase <provider>/<model> matching ${SESSION_MEMBER_PATTERN.source}, at most ${SESSION_MEMBER_MAX_LENGTH} characters`,
    );
  }
  const role = env.CVU_ROLE ?? "";
  if (!isSessionRole(role)) {
    throw new Error(`CVU_ROLE must be one of ${SESSION_ROLES.join(", ")} when CVU_MEMBER is set`);
  }
  return { member, role };
}

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
  if (!WEB_BASE_PATH_PATTERN.test(withSlash) || /\/\.{1,2}\//.test(withSlash)) {
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
    identity: parseSessionIdentity(env),
  };
}
