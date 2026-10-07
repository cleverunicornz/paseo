import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { PluginMcpToolResult } from "@getpaseo/plugin/server";
import type { PluginGatewayToolCall } from "../plugins/runtime.js";
import { MCP_GATEWAY_BACKEND_NAME_PATTERN } from "./backends.js";

export interface PluginGatewayToolCallerDeps {
  /** The daemon's own loopback `/mcp/backends` URL, or null without a TCP listener. */
  getGatewayBaseUrl: () => string | null;
  /** Only an agent the daemon holds now may be named. */
  isLiveAgent: (agentId: string) => boolean;
  issueAgentToken: (agentId: string) => string;
}

/**
 * Makes a plugin's tool call as the named agent's own MCP request to the
 * gateway: the same route, `mcp_gateway.upstream` hook and identity headers.
 * The agent's token is used inside the daemon only; the plugin gets the
 * backend's result, and error text never carries the token.
 */
export function createPluginGatewayToolCaller(deps: PluginGatewayToolCallerDeps) {
  return async function callGatewayTool(call: PluginGatewayToolCall): Promise<PluginMcpToolResult> {
    if (!MCP_GATEWAY_BACKEND_NAME_PATTERN.test(call.backend)) {
      throw new Error(`Invalid gateway backend name: ${call.backend}`);
    }
    if (!deps.isLiveAgent(call.onBehalfOf)) {
      throw new Error(`No live agent ${call.onBehalfOf}; a plugin can call only for a live agent`);
    }
    const baseUrl = deps.getGatewayBaseUrl();
    if (!baseUrl) throw new Error("Gateway tool calls need the daemon to listen on TCP");
    const token = deps.issueAgentToken(call.onBehalfOf);
    const transport = new StreamableHTTPClientTransport(
      new URL(`${baseUrl.replace(/\/$/, "")}/${call.backend}`),
      { requestInit: { headers: { Authorization: `Bearer ${token}` } } },
    );
    const client = new Client({ name: `paseo-plugin-${call.pluginId}`, version: "1" });
    try {
      await client.connect(transport, { timeout: call.timeoutMs });
      const result = await client.callTool(
        { name: call.tool, arguments: call.arguments },
        undefined,
        { timeout: call.timeoutMs },
      );
      return JSON.parse(
        JSON.stringify({
          content: Array.isArray(result.content) ? result.content : [],
          ...(result.structuredContent ? { structuredContent: result.structuredContent } : {}),
          ...(result.isError === true ? { isError: true } : {}),
        }),
      ) as PluginMcpToolResult;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Gateway tool call ${call.backend}/${call.tool} failed: ${message.replaceAll(token, "[redacted]")}`,
        // The cause stays in the daemon; the plugin gets the message only.
        { cause: error },
      );
    } finally {
      await client.close().catch(() => undefined);
    }
  };
}
