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

/**
 * Validates a `{ name: url }` map of MCP gateway backends. `source` names the
 * config key or environment variable in the error so a bad value is easy to
 * find at startup.
 */
export function parseMcpGatewayBackends(value: unknown, source: string): Record<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Invalid ${source}: expected an object mapping backend names to URLs`);
  }
  const backends: Record<string, string> = {};
  for (const [name, url] of Object.entries(value)) {
    if (!MCP_GATEWAY_BACKEND_NAME_PATTERN.test(name)) {
      throw new Error(
        `Invalid ${source}: backend name "${name}" must match ${MCP_GATEWAY_BACKEND_NAME_PATTERN}`,
      );
    }
    if (typeof url !== "string" || !isMcpGatewayBackendUrl(url)) {
      throw new Error(
        `Invalid ${source}: backend "${name}" must be a complete http or https URL with a valid host and no credentials`,
      );
    }
    backends[name] = url;
  }
  return backends;
}

export function parseMcpGatewayBackendsEnv(value: string, source: string): Record<string, string> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(`Invalid ${source}: expected a JSON object mapping backend names to URLs`);
  }
  return parseMcpGatewayBackends(parsed, source);
}
