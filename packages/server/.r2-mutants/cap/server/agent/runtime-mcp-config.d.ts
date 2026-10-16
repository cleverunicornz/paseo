import type { AgentSessionConfig } from "./agent-sdk-types.js";
export declare function stripInternalPaseoMcpServer(config: AgentSessionConfig): AgentSessionConfig;
export declare function withRuntimePaseoMcpServer(params: {
    config: AgentSessionConfig;
    agentId: string;
    mcpBaseUrl: string | null;
    /**
     * Capability token authenticating the injected connection to the daemon's
     * Agent MCP endpoint. The daemon password is gated off this route, so without
     * this header the agent's MCP requests are rejected when a password is set.
     */
    mcpAuthToken: string | null;
}): AgentSessionConfig;
//# sourceMappingURL=runtime-mcp-config.d.ts.map