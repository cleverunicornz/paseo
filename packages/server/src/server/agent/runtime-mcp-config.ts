import type { AgentSessionConfig, McpServerConfig } from "./agent-sdk-types.js";

const PASEO_MCP_SERVER_NAME = "paseo";
const PASEO_MCP_PATHNAME = "/mcp/agents";

export function substituteMcpServerValues(
  servers: Record<string, McpServerConfig> | undefined,
  values: Record<string, string>,
): Record<string, McpServerConfig> | undefined {
  if (!servers) {
    return servers;
  }

  function substitute(value: string): string {
    return value.replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (placeholder, key: string) =>
      Object.hasOwn(values, key) ? values[key]! : placeholder,
    );
  }

  const result: Record<string, McpServerConfig> = {};
  for (const [name, server] of Object.entries(servers)) {
    if (server.type === "stdio") {
      result[name] = server;
      continue;
    }
    const headers = server.headers
      ? Object.fromEntries(
          Object.entries(server.headers).map(([header, value]) => [header, substitute(value)]),
        )
      : undefined;
    result[name] = {
      ...server,
      url: substitute(server.url),
      ...(headers ? { headers } : {}),
    };
  }
  return result;
}

export function stripInternalPaseoMcpServer(config: AgentSessionConfig): AgentSessionConfig {
  const mcpServers = config.mcpServers;
  if (!mcpServers) {
    return config;
  }

  const paseoServer = mcpServers[PASEO_MCP_SERVER_NAME];
  if (!paseoServer || !isInternalPaseoMcpServer(paseoServer)) {
    return config;
  }

  const nextMcpServers = { ...mcpServers };
  delete nextMcpServers[PASEO_MCP_SERVER_NAME];

  const next = { ...config };
  if (Object.keys(nextMcpServers).length > 0) {
    next.mcpServers = nextMcpServers;
  } else {
    delete next.mcpServers;
  }
  return next;
}

export function withRuntimePaseoMcpServer(params: {
  config: AgentSessionConfig;
  agentId: string;
  values?: Record<string, string>;
  mcpBaseUrl: string | null;
  /**
   * The launching agent's own bearer token. The daemon derives the caller's
   * identity from it on the Agent MCP endpoint and the MCP gateway, so the
   * injected connection carries no caller claim of its own.
   */
  agentToken: string;
  /** Base URL of the daemon's MCP gateway (`/mcp/backends`), when it listens on TCP. */
  mcpGatewayBaseUrl: string | null;
}): AgentSessionConfig {
  const storedConfig = stripInternalPaseoMcpServer(params.config);
  const mcpServers = { ...storedConfig.mcpServers };
  if (params.mcpBaseUrl && !mcpServers[PASEO_MCP_SERVER_NAME]) {
    mcpServers[PASEO_MCP_SERVER_NAME] = {
      type: "http",
      url: params.mcpBaseUrl,
      headers: { Authorization: `Bearer ${params.agentToken}` },
    };
  }
  if (Object.keys(mcpServers).length === 0) {
    return storedConfig;
  }
  // Daemon-owned values take precedence over launch values with the same names.
  const values: Record<string, string> = { ...params.values };
  delete values.paseoMcpGatewayUrl;
  if (params.mcpGatewayBaseUrl) {
    values.paseoMcpGatewayUrl = params.mcpGatewayBaseUrl;
  }
  values.paseoAgentToken = params.agentToken;
  values.agentId = params.agentId;
  return {
    ...storedConfig,
    mcpServers: substituteMcpServerValues(mcpServers, values),
  };
}

function isInternalPaseoMcpServer(config: McpServerConfig): boolean {
  if (config.type !== "http" && config.type !== "sse") {
    return false;
  }

  try {
    return new URL(config.url).pathname === PASEO_MCP_PATHNAME;
  } catch {
    return false;
  }
}
