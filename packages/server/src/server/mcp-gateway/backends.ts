export const MCP_GATEWAY_ROUTE = "/mcp/backends";

/** Backend names are a single URL path segment the agent addresses. */
export const MCP_GATEWAY_BACKEND_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

const DEC_OCTET = "(?:25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])";
const IPV4 = `(?:${DEC_OCTET}\\.){3}${DEC_OCTET}`;
const H16 = "[0-9A-Fa-f]{1,4}";
const LS32 = `(?:${H16}:${H16}|${IPV4})`;
const IPV6 = [
  `(?:${H16}:){6}${LS32}`,
  `::(?:${H16}:){5}${LS32}`,
  `(?:${H16})?::(?:${H16}:){4}${LS32}`,
  `(?:(?:${H16}:){0,1}${H16})?::(?:${H16}:){3}${LS32}`,
  `(?:(?:${H16}:){0,2}${H16})?::(?:${H16}:){2}${LS32}`,
  `(?:(?:${H16}:){0,3}${H16})?::${H16}:${LS32}`,
  `(?:(?:${H16}:){0,4}${H16})?::${LS32}`,
  `(?:(?:${H16}:){0,5}${H16})?::${H16}`,
  `(?:(?:${H16}:){0,6}${H16})?::`,
].join("|");
const LABEL = "[A-Za-z0-9](?:-?[A-Za-z0-9])*";
const TOP_LABEL = "[A-Za-z](?:-?[A-Za-z0-9])*";
const HOST = `(?:\\[(?:${IPV6})\\]|${IPV4}|(?:${LABEL}\\.)*${TOP_LABEL})`;
const PORT =
  "(?::(?:6553[0-5]|655[0-2][0-9]|65[0-4][0-9]{2}|6[0-4][0-9]{3}|[1-5][0-9]{4}|[1-9][0-9]{0,3}|0))?";
const PCHAR = "(?:[A-Za-z0-9._~!$&'()*+,;=:@-]|%[0-9A-Fa-f]{2})";
const PATH = `(?:/${PCHAR}*)*`;
const QUERY = `(?:\\?(?:${PCHAR}|[/?])*)?`;

/**
 * The one rule for MCP gateway backend URLs: a complete absolute `http:` or
 * `https:` URL with a valid host (DNS name, IPv4, or bracketed IPv6), an
 * optional port, path and query, and no credentials or fragment. Startup
 * validation, the persisted config schema, plugin hook results and the
 * published JSON schema all use this pattern.
 */
export const MCP_GATEWAY_BACKEND_URL_PATTERN_SOURCE = `^[Hh][Tt][Tt][Pp][Ss]?://${HOST}${PORT}${PATH}${QUERY}$`;
export const MCP_GATEWAY_BACKEND_URL_PATTERN = new RegExp(MCP_GATEWAY_BACKEND_URL_PATTERN_SOURCE);

export function isMcpGatewayBackendUrl(value: string): boolean {
  return MCP_GATEWAY_BACKEND_URL_PATTERN.test(value);
}

/** Bounds of a backend's `responseTimeoutMs`: model backends may wait minutes for a first byte. */
export const MCP_GATEWAY_RESPONSE_TIMEOUT_MIN_MS = 1;
export const MCP_GATEWAY_RESPONSE_TIMEOUT_MAX_MS = 3_600_000;

/**
 * Provider ids a model backend is named for: the same rule as configured
 * provider ids (`agents.providers`), so custom providers can be named too.
 */
export const MCP_GATEWAY_MODEL_PROVIDER_PATTERN = /^[a-z][a-z0-9-]*$/;

/** A configured backend: its URL and, optionally, how long to wait for its response headers. */
export interface McpGatewayBackend {
  url: string;
  responseTimeoutMs?: number;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isResponseTimeoutMs(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= MCP_GATEWAY_RESPONSE_TIMEOUT_MIN_MS &&
    value <= MCP_GATEWAY_RESPONSE_TIMEOUT_MAX_MS
  );
}

function parseBackend(name: string, value: unknown, source: string): McpGatewayBackend {
  const urlError = new Error(
    `Invalid ${source}: backend "${name}" must be a complete http or https URL with a valid host and no credentials`,
  );
  if (typeof value === "string") {
    if (!isMcpGatewayBackendUrl(value)) throw urlError;
    return { url: value };
  }
  if (!isPlainObject(value)) {
    throw new Error(
      `Invalid ${source}: backend "${name}" must be a URL or an object with url and responseTimeoutMs`,
    );
  }
  const unknownKeys = Object.keys(value).filter(
    (key) => key !== "url" && key !== "responseTimeoutMs",
  );
  if (unknownKeys.length > 0) {
    throw new Error(
      `Invalid ${source}: backend "${name}" has unknown keys: ${unknownKeys.join(", ")}`,
    );
  }
  if (typeof value.url !== "string" || !isMcpGatewayBackendUrl(value.url)) throw urlError;
  if (value.responseTimeoutMs === undefined) {
    return { url: value.url };
  }
  if (!isResponseTimeoutMs(value.responseTimeoutMs)) {
    throw new Error(
      `Invalid ${source}: backend "${name}" responseTimeoutMs must be an integer from ${MCP_GATEWAY_RESPONSE_TIMEOUT_MIN_MS} to ${MCP_GATEWAY_RESPONSE_TIMEOUT_MAX_MS}`,
    );
  }
  return { url: value.url, responseTimeoutMs: value.responseTimeoutMs };
}

/**
 * Validates a map of MCP gateway backends. Each value is a URL, or
 * `{ url, responseTimeoutMs? }`. `source` names the config key or environment
 * variable in the error so a bad value is easy to find at startup.
 */
export function parseMcpGatewayBackends(
  value: unknown,
  source: string,
): Record<string, McpGatewayBackend> {
  if (!isPlainObject(value)) {
    throw new Error(`Invalid ${source}: expected an object mapping backend names to URLs`);
  }
  const backends: Record<string, McpGatewayBackend> = {};
  for (const [name, backend] of Object.entries(value)) {
    if (!MCP_GATEWAY_BACKEND_NAME_PATTERN.test(name)) {
      throw new Error(
        `Invalid ${source}: backend name "${name}" must match ${MCP_GATEWAY_BACKEND_NAME_PATTERN}`,
      );
    }
    backends[name] = parseBackend(name, backend, source);
  }
  return backends;
}

function parseJsonEnv(value: string, source: string, expected: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    throw new Error(`Invalid ${source}: expected a JSON object mapping ${expected}`);
  }
}

export function parseMcpGatewayBackendsEnv(
  value: string,
  source: string,
): Record<string, McpGatewayBackend> {
  return parseMcpGatewayBackends(parseJsonEnv(value, source, "backend names to URLs"), source);
}

/**
 * Validates the `{ providerId: backendName }` map naming the gateway backend
 * each provider's model traffic goes to.
 */
export function parseMcpGatewayModelBackends(
  value: unknown,
  source: string,
): Record<string, string> {
  if (!isPlainObject(value)) {
    throw new Error(`Invalid ${source}: expected an object mapping provider ids to backend names`);
  }
  const modelBackends: Record<string, string> = {};
  for (const [provider, backend] of Object.entries(value)) {
    if (!MCP_GATEWAY_MODEL_PROVIDER_PATTERN.test(provider)) {
      throw new Error(
        `Invalid ${source}: provider id "${provider}" must match ${MCP_GATEWAY_MODEL_PROVIDER_PATTERN}`,
      );
    }
    if (typeof backend !== "string" || !MCP_GATEWAY_BACKEND_NAME_PATTERN.test(backend)) {
      throw new Error(
        `Invalid ${source}: backend for provider "${provider}" must be a backend name matching ${MCP_GATEWAY_BACKEND_NAME_PATTERN}`,
      );
    }
    modelBackends[provider] = backend;
  }
  return modelBackends;
}

export function parseMcpGatewayModelBackendsEnv(
  value: string,
  source: string,
): Record<string, string> {
  return parseMcpGatewayModelBackends(
    parseJsonEnv(value, source, "provider ids to backend names"),
    source,
  );
}
