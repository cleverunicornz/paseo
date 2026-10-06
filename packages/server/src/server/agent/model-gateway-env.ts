import type { ProcessEnvRecord } from "../paseo-env.js";

/**
 * The environment of a harness whose model traffic goes through the daemon's
 * gateway is built, not inherited. From the daemon's environment and provider
 * runtime settings it keeps only these base variables and the configured
 * pass-through; Paseo's own launch values are kept as for any agent; then come
 * `NO_PROXY`/`no_proxy` and the harness's gateway values. A refused name (model
 * credentials, provider selectors, credential files, proxies) never passes,
 * whatever its source.
 */
const BASE_ENV_NAMES = new Set([
  // Executable lookup: the harness and the tools it runs.
  "PATH",
  // Home directory: where Claude Code and Codex keep their sessions and settings.
  "HOME",
  // The OS user, for tools that read it instead of querying the user database.
  "USER",
  "LOGNAME",
  // The shell the harness runs commands with.
  "SHELL",
  // Locale, terminal type and time zone of command output.
  "LANG",
  "TERM",
  "TZ",
  // Location for temporary files.
  "TMPDIR",
  // Windows process startup and per-user directories; no POSIX name above covers them.
  "SYSTEMROOT",
  "WINDIR",
  "COMSPEC",
  "PATHEXT",
  "USERPROFILE",
  "APPDATA",
  "LOCALAPPDATA",
  "TEMP",
  "TMP",
]);
/** Locale categories (`LC_ALL`, `LC_CTYPE`, ...). */
const BASE_ENV_PREFIXES = ["LC_"];

/**
 * Prefixes of every model-provider credential, provider selector, cloud
 * credential or credential-file selector, and proxy variable, compared without
 * regard to case. Names ending in `_PROXY` are refused as well.
 */
const REFUSED_ENV_PREFIXES = [
  "ANTHROPIC_",
  "CLAUDE_CODE_USE_",
  "CLAUDE_CODE_SKIP_",
  "CLAUDE_CODE_OAUTH_",
  "CLAUDE_CODE_API_KEY",
  "CLAUDE_CODE_CLIENT_",
  "OPENAI_",
  "CODEX_API_KEY",
  "AWS_",
  "AZURE_",
  "GOOGLE_",
  "GCLOUD_",
  "CLOUDSDK_",
  "CLOUD_ML_",
  "VERTEX_",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "NO_PROXY",
  "FTP_PROXY",
];
const PROXY_SUFFIX = "_PROXY";

/** Hosts that always bypass any proxy a harness might still be told about. */
const LOOPBACK_HOSTS = ["127.0.0.1", "localhost", "::1"];

export function isRefusedHarnessEnvName(name: string): boolean {
  const upper = name.toUpperCase();
  return (
    upper.endsWith(PROXY_SUFFIX) || REFUSED_ENV_PREFIXES.some((prefix) => upper.startsWith(prefix))
  );
}

function isBaseEnvName(name: string): boolean {
  // Windows variable names are case-insensitive.
  const candidate = process.platform === "win32" ? name.toUpperCase() : name;
  return (
    BASE_ENV_NAMES.has(candidate) ||
    BASE_ENV_PREFIXES.some((prefix) => candidate.startsWith(prefix))
  );
}

function anyCase(text: string): string {
  return [...text]
    .map((char) => (/[A-Za-z]/.test(char) ? `[${char.toUpperCase()}${char.toLowerCase()}]` : char))
    .join("");
}

/** Matches every non-empty leading part of `text`, e.g. `A(?:W(?:S)?)?` for `AWS`. */
function leadingParts(text: string): string {
  return [...text].reduceRight<string>(
    (inner, char) => (inner ? `${anyCase(char)}(?:${inner})?` : anyCase(char)),
    "",
  );
}

/** A pass-through entry: a variable name, or a name prefix followed by `*`. */
export const MCP_GATEWAY_ENV_PASSTHROUGH_ENTRY_PATTERN_SOURCE = "^[A-Za-z_][A-Za-z0-9_]*\\*?$";

/**
 * The one rule for refused pass-through entries, shared by startup
 * validation, the persisted config schema and the published JSON schema: an
 * entry is refused when it names, or as a prefix could match, a refused
 * variable, or names a `*_PROXY` variable.
 */
export const MCP_GATEWAY_REFUSED_ENV_PASSTHROUGH_PATTERN_SOURCE = [
  `^(?:${REFUSED_ENV_PREFIXES.map(anyCase).join("|")})[A-Za-z0-9_]*\\*?$`,
  `^(?:${REFUSED_ENV_PREFIXES.map(leadingParts).join("|")})\\*$`,
  `^[A-Za-z0-9_]*${anyCase(PROXY_SUFFIX)}$`,
].join("|");

const ENTRY_PATTERN = new RegExp(MCP_GATEWAY_ENV_PASSTHROUGH_ENTRY_PATTERN_SOURCE);
const REFUSED_PATTERN = new RegExp(MCP_GATEWAY_REFUSED_ENV_PASSTHROUGH_PATTERN_SOURCE);

export function isAcceptedEnvPassthroughEntry(entry: string): boolean {
  return ENTRY_PATTERN.test(entry) && !REFUSED_PATTERN.test(entry);
}

/** Validates `daemon.mcp.gateway.envPassthrough`; `source` names the key in errors. */
export function parseMcpGatewayEnvPassthrough(value: unknown, source: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`Invalid ${source}: expected an array of variable names or NAME_* prefixes`);
  }
  for (const entry of value) {
    if (typeof entry !== "string" || !ENTRY_PATTERN.test(entry)) {
      throw new Error(
        `Invalid ${source}: entry ${JSON.stringify(entry)} must be a variable name or a name prefix ending in *`,
      );
    }
    if (REFUSED_PATTERN.test(entry)) {
      throw new Error(
        `Invalid ${source}: entry "${entry}" names model credentials or proxy variables, which never reach a gateway harness`,
      );
    }
  }
  return [...value];
}

export function parseMcpGatewayEnvPassthroughEnv(value: string, source: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(`Invalid ${source}: expected a JSON array of variable names`);
  }
  return parseMcpGatewayEnvPassthrough(parsed, source);
}

function matchesPassthrough(name: string, passthrough: readonly string[]): boolean {
  return passthrough.some((entry) =>
    entry.endsWith("*") ? name.startsWith(entry.slice(0, -1)) : name === entry,
  );
}

function gatewayHost(baseUrl: string): string {
  return new URL(baseUrl).hostname.replace(/^\[(.*)\]$/, "$1");
}

export interface ModelGatewayEnvInput {
  /** The daemon's environment and provider runtime settings, in increasing precedence. */
  inherited: ReadonlyArray<ProcessEnvRecord | undefined>;
  /** Paseo's launch values for this agent (per-agent and plugin-supplied values). */
  launchEnv: Record<string, string> | undefined;
  baseUrl: string;
  envPassthrough: readonly string[];
  /** The harness's own gateway values. */
  gatewayValues: Record<string, string>;
}

/**
 * The complete environment of a gateway harness. The caller launches with it
 * as-is: nothing else is inherited or overlaid.
 */
export function buildModelGatewayEnv(input: ModelGatewayEnvInput): Record<string, string> {
  const env: Record<string, string> = {};
  for (const source of input.inherited) {
    for (const [name, value] of Object.entries(source ?? {})) {
      if (
        value !== undefined &&
        (isBaseEnvName(name) || matchesPassthrough(name, input.envPassthrough)) &&
        !isRefusedHarnessEnvName(name)
      ) {
        env[name] = value;
      }
    }
  }
  for (const [name, value] of Object.entries(input.launchEnv ?? {})) {
    if (!isRefusedHarnessEnvName(name)) {
      env[name] = value;
    }
  }
  const noProxy = [...new Set([...LOOPBACK_HOSTS, gatewayHost(input.baseUrl)])].join(",");
  env.NO_PROXY = noProxy;
  env.no_proxy = noProxy;
  return Object.assign(env, input.gatewayValues);
}
