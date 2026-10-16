import type { AgentModelDefinition, AgentProvider } from "../../agent-sdk-types.js";
import type { OmpModel, OmpThinkingLevel } from "./rpc-types.js";
export declare const DEFAULT_OMP_THINKING_LEVEL: OmpThinkingLevel;
export declare const OMP_THINKING_OPTIONS: ReadonlyArray<{
    id: OmpThinkingLevel;
    label: string;
    description: string;
    isDefault?: boolean;
}>;
export declare function mapOmpModel(model: OmpModel, provider: AgentProvider): AgentModelDefinition;
//# sourceMappingURL=map-omp-model.d.ts.map