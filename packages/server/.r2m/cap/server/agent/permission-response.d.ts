import type { Logger } from "pino";
import type { AgentPermissionResponse, AgentPermissionResult } from "./agent-sdk-types.js";
import { type AgentRunController } from "./agent-prompt.js";
export interface PermissionResponseAgentManager extends AgentRunController {
    respondToPermission(agentId: string, requestId: string, response: AgentPermissionResponse): Promise<AgentPermissionResult | void>;
}
export interface RespondToAgentPermissionParams {
    agentManager: PermissionResponseAgentManager;
    agentId: string;
    requestId: string;
    response: AgentPermissionResponse;
    logger: Logger;
}
export declare function respondToAgentPermission(params: RespondToAgentPermissionParams): Promise<void>;
//# sourceMappingURL=permission-response.d.ts.map