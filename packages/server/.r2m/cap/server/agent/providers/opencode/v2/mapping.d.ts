import type { AgentInfo, ModelInfo, ModelRef, SessionInfo } from "@opencode/client";
import type { AgentMode, AgentModelDefinition, AgentUsage } from "../../../agent-sdk-types.js";
export declare function modelRef(id: string, variant?: string | null): ModelRef;
export declare function modelsFromV2(models: ModelInfo[]): AgentModelDefinition[];
export declare function modesFromV2(agents: AgentInfo[]): AgentMode[];
export declare function usageFromV2(session: SessionInfo): AgentUsage;
//# sourceMappingURL=mapping.d.ts.map