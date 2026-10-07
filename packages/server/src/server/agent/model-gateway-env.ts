import type { ProcessEnvRecord } from "../paseo-env.js";
import type { SpawnEnvOptions } from "../../utils/spawn.js";

/**
 * The environment of every process the daemon starts from the harness binary
 * of a provider whose model traffic goes through the daemon's gateway is
 * built, not inherited: probes, diagnostics, catalogue and listing
 * app-servers, draft sessions and agent sessions alike. From the daemon's
 * environment and provider runtime settings it keeps only these base
 * variables and the configured pass-through; Paseo's own launch values are
 * kept as for any agent; an agent session then adds `NO_PROXY`/`no_proxy` and
 * its gateway values. A refused name (model credentials, provider selectors,
 * credential files, proxies) never passes, whatever its source.
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

/**
 * Prefixes of dynamic-loader, Node runtime, TLS trust and harness
 * configuration-location variables. The pass-through list cannot name them;
 * they reach a harness only as launch values, which are trusted configuration.
 */
const PASSTHROUGH_REFUSED_PREFIXES = [
  "LD_",
  "DYLD_",
  "NODE_OPTIONS",
  "NODE_EXTRA_CA_CERTS",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "CLAUDE_CONFIG_DIR",
  "CODEX_HOME",
];

/** Hosts that always bypass any proxy a harness might still be told about. */
const LOOPBACK_HOSTS = ["127.0.0.1", "localhost", "::1"];

export function isRefusedHarnessEnvName(name: string): boolean {
  const upper = name.toUpperCase();
  return (
    upper.endsWith(PROXY_SUFFIX) || REFUSED_ENV_PREFIXES.some((prefix) => upper.startsWith(prefix))
  );
}

function isPassthroughRefusedName(name: string): boolean {
  const upper = name.toUpperCase();
  return PASSTHROUGH_REFUSED_PREFIXES.some((prefix) => upper.startsWith(prefix));
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

const PASSTHROUGH_REFUSED = [...REFUSED_ENV_PREFIXES, ...PASSTHROUGH_REFUSED_PREFIXES];

/**
 * The one rule for refused pass-through entries, shared by startup
 * validation, the persisted config schema and the published JSON schema,
 * compared without regard to case. An entry is refused when:
 * - it starts with a refused prefix (a name, or a prefix entry inside one);
 * - it is a prefix entry that could match a refused prefix (`ANTHROPIC*`, `LD*`);
 * - it names a `*_PROXY` variable, or is a prefix entry holding `_PROXY` (`X_PROXY*`).
 * Names ending in `_PROXY` are also dropped at launch when a broader prefix
 * entry (such as `TOOL_*`) matches them.
 */
export const MCP_GATEWAY_REFUSED_ENV_PASSTHROUGH_PATTERN_SOURCE = [
  `^(?:${PASSTHROUGH_REFUSED.map(anyCase).join("|")})[A-Za-z0-9_]*\\*?$`,
  `^(?:${PASSTHROUGH_REFUSED.map(leadingParts).join("|")})\\*$`,
  `^[A-Za-z0-9_]*${anyCase(PROXY_SUFFIX)}$`,
  `^[A-Za-z0-9_]*${anyCase(PROXY_SUFFIX)}[A-Za-z0-9_]*\\*$`,
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

/**
 * How a provider's harness processes get their environment. A provider whose
 * model traffic goes through the gateway gets `allowlist` for every harness
 * process; every other provider inherits as before.
 */
export type HarnessEnvironment =
  | { kind: "inherited" }
  | {
      kind: "allowlist";
      /** Configured names and `NAME_*` prefixes a harness may inherit beyond the base variables. */
      envPassthrough: readonly string[];
    };

export const INHERITED_HARNESS_ENVIRONMENT: HarnessEnvironment = { kind: "inherited" };

/**
 * The harness environment of each provider under the daemon's model-gateway
 * configuration: `allowlist` for a provider that names a model backend.
 */
export function resolveHarnessEnvironment(
  provider: string,
  config: {
    modelBackends?: Readonly<Record<string, string>>;
    envPassthrough?: readonly string[];
  },
): HarnessEnvironment {
  if (!config.modelBackends || !Object.hasOwn(config.modelBackends, provider)) {
    return INHERITED_HARNESS_ENVIRONMENT;
  }
  return { kind: "allowlist", envPassthrough: [...(config.envPassthrough ?? [])] };
}

/** An agent session's gateway route: the gateway URL and the harness's own gateway values. */
export interface HarnessGatewayValues {
  baseUrl: string;
  values: Record<string, string>;
}

export interface AllowlistedHarnessEnvInput {
  /** The daemon's environment and provider runtime settings, in increasing precedence. */
  inherited: ReadonlyArray<ProcessEnvRecord | undefined>;
  /** Paseo's launch values for this agent (per-agent and plugin-supplied values). */
  launchEnv?: ProcessEnvRecord;
  envPassthrough: readonly string[];
  /** Set for an agent session that sends its model traffic to the gateway. */
  gateway?: HarnessGatewayValues;
}

/**
 * The complete environment of a harness process under the allowlist. The
 * caller launches with it as-is: nothing else is inherited or overlaid. A
 * process without a gateway route (a probe, a listing app-server, a draft
 * session) gets the same variables minus `NO_PROXY` and the gateway values.
 */
export function buildAllowlistedHarnessEnv(
  input: AllowlistedHarnessEnvInput,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const source of input.inherited) {
    for (const [name, value] of Object.entries(source ?? {})) {
      if (
        value !== undefined &&
        (isBaseEnvName(name) || matchesPassthrough(name, input.envPassthrough)) &&
        !isRefusedHarnessEnvName(name) &&
        !isPassthroughRefusedName(name)
      ) {
        env[name] = value;
      }
    }
  }
  for (const [name, value] of Object.entries(input.launchEnv ?? {})) {
    if (value !== undefined && !isRefusedHarnessEnvName(name)) {
      env[name] = value;
    }
  }
  if (!input.gateway) {
    return env;
  }
  const noProxy = [...new Set([...LOOPBACK_HOSTS, gatewayHost(input.gateway.baseUrl)])].join(",");
  env.NO_PROXY = noProxy;
  env.no_proxy = noProxy;
  return Object.assign(env, input.gateway.values);
}

declare const harnessSpawnEnvBrand: unique symbol;

/**
 * Spawn environment options for a harness process. Only
 * `resolveHarnessSpawnEnv` produces one, and the harness spawn helpers in
 * `harness-process.ts` accept nothing else.
 */
export type HarnessSpawnEnv = SpawnEnvOptions & { readonly [harnessSpawnEnvBrand]: true };

export interface HarnessSpawnEnvInput {
  /** The spawn environment this process has always used under `inherited`. */
  inherited: SpawnEnvOptions;
  /** Provider runtime settings environment. */
  settingsEnv?: ProcessEnvRecord;
  /** Paseo's launch values, for an agent session. */
  launchEnv?: ProcessEnvRecord;
  /** The gateway route, for an agent session that has one. */
  gateway?: HarnessGatewayValues;
}

/** The spawn environment of one harness process under its provider's harness environment. */
export function resolveHarnessSpawnEnv(
  environment: HarnessEnvironment,
  input: HarnessSpawnEnvInput,
): HarnessSpawnEnv {
  if (environment.kind === "inherited") {
    return input.inherited as HarnessSpawnEnv;
  }
  const env = buildAllowlistedHarnessEnv({
    inherited: [process.env, input.settingsEnv],
    launchEnv: input.launchEnv,
    envPassthrough: environment.envPassthrough,
    gateway: input.gateway,
  });
  return { env, envMode: "internal" } as HarnessSpawnEnv;
}
