import type { BrowserToolsBroker } from "./broker.js";
import type { PaseoToolConfig, PaseoToolExecutionContext, PaseoToolResult } from "../agent/tools/types.js";
interface CallerAgentContext {
    id: string;
    cwd: string;
    workspaceId?: string;
}
export interface RegisterBrowserToolsOptions {
    registerTool: (name: string, config: PaseoToolConfig, handler: (input: any, context: PaseoToolExecutionContext) => Promise<PaseoToolResult>) => void;
    broker: Pick<BrowserToolsBroker, "execute">;
    callerAgentId?: string;
    resolveCallerAgent: () => CallerAgentContext | null;
}
export declare function registerBrowserTools(options: RegisterBrowserToolsOptions): void;
export {};
//# sourceMappingURL=tools.d.ts.map