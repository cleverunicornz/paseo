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
        mcpAuthToken: null,
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

  test("injects the paseo MCP server with a bearer header when a token is provided", () => {
    const result = withRuntimePaseoMcpServer({
      config: BASE_CONFIG,
      agentId: "agent-1",
      mcpBaseUrl: "http://127.0.0.1:6767/mcp/agents",
      mcpAuthToken: "cap-token",
    });

    expect(result.mcpServers?.paseo).toEqual({
      type: "http",
      url: "http://127.0.0.1:6767/mcp/agents?callerAgentId=agent-1",
      headers: { Authorization: "Bearer cap-token" },
    });
  });

  test("omits the header when no token is available", () => {
    const result = withRuntimePaseoMcpServer({
      config: BASE_CONFIG,
      agentId: "agent-1",
      mcpBaseUrl: "http://127.0.0.1:6767/mcp/agents",
      mcpAuthToken: null,
    });

    expect(result.mcpServers?.paseo).toEqual({
      type: "http",
      url: "http://127.0.0.1:6767/mcp/agents?callerAgentId=agent-1",
    });
  });

  test("does not inject when no MCP base URL is configured", () => {
    const result = withRuntimePaseoMcpServer({
      config: BASE_CONFIG,
      agentId: "agent-1",
      mcpBaseUrl: null,
      mcpAuthToken: "cap-token",
    });

    expect(result.mcpServers).toBeUndefined();
  });
});
