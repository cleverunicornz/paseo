/** One tool call a plugin makes to a gateway backend for an agent. */
export interface PluginMcpToolCall {
  /** A backend name from `daemon.mcp.gateway.backends`. */
  backend: string;
  tool: string;
  arguments?: Record<string, unknown>;
  /**
   * The agent the call is made for. It goes through the gateway exactly as
   * that agent's own call would: the `mcp_gateway.upstream` hook and the
   * `X-Paseo-*` identity headers are that agent's. The agent must exist.
   */
  onBehalfOf: string;
  /** How long to wait for the result, 1 to 600000 ms; 60000 by default. */
  timeoutMs?: number;
}

/** The backend's `tools/call` result. */
export interface PluginMcpToolResult {
  content: unknown[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

export interface PluginMcpApi {
  callTool(call: PluginMcpToolCall): Promise<PluginMcpToolResult>;
}
