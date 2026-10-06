export const MCP_GATEWAY_ROUTE = "/mcp/backends";

/** Backend names are a single URL path segment the agent addresses. */
export const MCP_GATEWAY_BACKEND_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

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
    if (typeof url !== "string" || !isHttpUrl(url)) {
      throw new Error(`Invalid ${source}: backend "${name}" must be an http or https URL`);
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

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
