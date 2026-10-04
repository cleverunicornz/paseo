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
   * Capability token authenticating the injected connection to the daemon's
   * Agent MCP endpoint. The daemon password is gated off this route, so without
   * this header the agent's MCP requests are rejected when a password is set.
   */
  mcpAuthToken: string | null;
}): AgentSessionConfig {
  const storedConfig = stripInternalPaseoMcpServer(params.config);
  const mcpServers = { ...storedConfig.mcpServers };
  if (params.mcpBaseUrl && !mcpServers[PASEO_MCP_SERVER_NAME]) {
    mcpServers[PASEO_MCP_SERVER_NAME] = {
      type: "http",
      url: `${params.mcpBaseUrl}?callerAgentId={agentId}`,
      ...(params.mcpAuthToken
        ? { headers: { Authorization: `Bearer ${params.mcpAuthToken}` } }
        : {}),
    };
  }
  if (Object.keys(mcpServers).length === 0) {
    return storedConfig;
  }
  return {
    ...storedConfig,
    mcpServers: substituteMcpServerValues(mcpServers, {
      ...params.values,
      agentId: params.agentId,
    }),
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
