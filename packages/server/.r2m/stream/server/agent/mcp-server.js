import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { addModelVisibleStructuredContent } from "./tools/paseo-tool-serialization.js";
import { createPaseoToolCatalog } from "./tools/paseo-tools.js";
function toMcpToolResult(result) {
    const modelVisibleResult = addModelVisibleStructuredContent(result);
    return {
        content: modelVisibleResult.content,
        ...(modelVisibleResult.structuredContent !== undefined
            ? {
                structuredContent: modelVisibleResult.structuredContent,
            }
            : {}),
        ...(modelVisibleResult.isError !== undefined ? { isError: modelVisibleResult.isError } : {}),
    };
}
export async function createAgentMcpServer(options) {
    const catalog = await createPaseoToolCatalog(options);
    const server = new McpServer({
        name: "agent-mcp",
        version: "2.0.0",
    });
    for (const tool of catalog.tools.values()) {
        server.registerTool(tool.name, {
            title: tool.title,
            description: tool.description,
            inputSchema: tool.inputSchema,
        }, async (args, context) => toMcpToolResult(await catalog.executeTool(tool.name, args, { signal: context?.signal })));
    }
    return server;
}
//# sourceMappingURL=mcp-server.js.map