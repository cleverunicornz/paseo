import type { Logger } from "pino";
import type { McpServerConfig } from "../../agent-sdk-types.js";
import type { PaseoToolResult } from "../../tools/types.js";
import type { OmpRpcHostToolDefinition } from "./rpc-types.js";
export interface OmpBridgedToolIdentity {
    server: string;
    tool: string;
}
export declare class OmpMcpBridge {
    readonly definitions: OmpRpcHostToolDefinition[];
    private readonly tools;
    private readonly clients;
    private closed;
    static connect(servers: Record<string, McpServerConfig> | undefined, cwd: string, logger: Logger, env: NodeJS.ProcessEnv): Promise<OmpMcpBridge>;
    tool(name: string): OmpBridgedToolIdentity | undefined;
    toolIdentities(): Map<string, OmpBridgedToolIdentity>;
    execute(name: string, args: Record<string, unknown>, signal: AbortSignal): Promise<PaseoToolResult>;
    close(): Promise<void>;
}
//# sourceMappingURL=mcp-bridge.d.ts.map