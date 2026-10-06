import { describe, expect, test } from "vitest";

import type { AgentSessionConfig } from "./agent-sdk-types.js";
import { withRuntimePaseoMcpServer } from "./runtime-mcp-config.js";

const BASE_CONFIG: AgentSessionConfig = {
  provider: "claude",
  cwd: "/tmp/agent",
};

describe("withRuntimePaseoMcpServer", () => {
  test.each(["claude", "codex", "acp"])(
    "substitutes HTTP and SSE URLs and headers for %s without changing stored templates",
    (provider) => {
      const config: AgentSessionConfig = {
        ...BASE_CONFIG,
        provider,
        mcpServers: {
          http: {
            type: "http",
            url: "https://tools.example/{tenant}/mcp?agent={agentId}&again={agentId}",
            headers: { "X-Agent": "{agentId}", "X-Tenant": "{tenant}" },
          },
          sse: { type: "sse", url: "https://tools.example/{agentId}/{unknown}" },
          stdio: { type: "stdio", command: "mcp", args: ["{agentId}"] },
        },
      };
      const before = structuredClone(config);
      const result = withRuntimePaseoMcpServer({
        config,
        agentId: "agent-1",
        values: { tenant: "team-$&-{agentId}", agentId: "wrong-agent" },
        mcpBaseUrl: null,
        agentToken: "agent-1-token",
        mcpGatewayBaseUrl: null,
      });

      expect(result.mcpServers).toEqual({
        http: {
          type: "http",
          url: "https://tools.example/team-$&-{agentId}/mcp?agent=agent-1&again=agent-1",
          headers: { "X-Agent": "agent-1", "X-Tenant": "team-$&-{agentId}" },
        },
        sse: { type: "sse", url: "https://tools.example/agent-1/{unknown}" },
        stdio: { type: "stdio", command: "mcp", args: ["{agentId}"] },
      });
      expect(config).toEqual(before);
    },
  );

  test("injects the paseo MCP server authenticated by the agent's own token", () => {
    const result = withRuntimePaseoMcpServer({
      config: BASE_CONFIG,
      agentId: "agent-1",
      mcpBaseUrl: "http://127.0.0.1:6767/mcp/agents",
      agentToken: "agent-1-token",
      mcpGatewayBaseUrl: null,
    });

    // Identity comes from the token alone; the URL carries no caller claim.
    expect(result.mcpServers?.paseo).toEqual({
      type: "http",
      url: "http://127.0.0.1:6767/mcp/agents",
      headers: { Authorization: "Bearer agent-1-token" },
    });
  });

  test("does not inject when no MCP base URL is configured", () => {
    const result = withRuntimePaseoMcpServer({
      config: BASE_CONFIG,
      agentId: "agent-1",
      mcpBaseUrl: null,
      agentToken: "agent-1-token",
      mcpGatewayBaseUrl: null,
    });

    expect(result.mcpServers).toBeUndefined();
  });

  test("resolves gateway placeholders to the daemon gateway and the agent's own token", () => {
    const config: AgentSessionConfig = {
      ...BASE_CONFIG,
      mcpServers: {
        cluster: {
          type: "http",
          url: "{paseoMcpGatewayUrl}/cluster",
          headers: { Authorization: "Bearer {paseoAgentToken}" },
        },
      },
    };
    const before = structuredClone(config);

    const result = withRuntimePaseoMcpServer({
      config,
      agentId: "agent-1",
      values: { paseoAgentToken: "forged", paseoMcpGatewayUrl: "https://evil.example" },
      mcpBaseUrl: null,
      agentToken: "agent-1-token",
      mcpGatewayBaseUrl: "http://127.0.0.1:6767/mcp/backends",
    });

    expect(result.mcpServers?.cluster).toEqual({
      type: "http",
      url: "http://127.0.0.1:6767/mcp/backends/cluster",
      headers: { Authorization: "Bearer agent-1-token" },
    });
    expect(config).toEqual(before);
  });

  test("leaves the gateway URL placeholder unresolved when the daemon has no TCP listener", () => {
    const result = withRuntimePaseoMcpServer({
      config: {
        ...BASE_CONFIG,
        mcpServers: { cluster: { type: "http", url: "{paseoMcpGatewayUrl}/cluster" } },
      },
      agentId: "agent-1",
      values: { paseoMcpGatewayUrl: "https://evil.example" },
      mcpBaseUrl: null,
      agentToken: "agent-1-token",
      mcpGatewayBaseUrl: null,
    });

    expect(result.mcpServers?.cluster).toEqual({
      type: "http",
      url: "{paseoMcpGatewayUrl}/cluster",
    });
  });
});
