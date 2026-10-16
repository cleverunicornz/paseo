import type { ProviderOptions } from "@getpaseo/protocol/agent-types";
import type { HubExecutionAgentValidationIssue } from "@getpaseo/protocol/messages";
import type { ProviderSnapshotEntry } from "./agent-sdk-types.js";
export interface AgentConfigurationValidationInput {
    provider: string;
    model?: string;
    modeId?: string;
    thinkingOptionId?: string;
    providerOptions?: ProviderOptions;
}
interface AgentConfigurationValidationContext {
    input: AgentConfigurationValidationInput;
    provider: ProviderSnapshotEntry;
}
export declare function validateAgentConfigurationAgainstProvider({ input, provider, }: AgentConfigurationValidationContext): HubExecutionAgentValidationIssue[];
export {};
//# sourceMappingURL=agent-configuration-validator.d.ts.map