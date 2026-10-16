import type { AgentCreateConfigParent, AgentCreateConfigUnattendedInput, AgentProvider, ResolveAgentCreateConfigInput, ResolveAgentCreateConfigResult } from "./agent-sdk-types.js";
export interface ResolveCreateAgentModeInput {
    requestedMode: string | undefined;
    targetProvider: AgentProvider;
    parent: AgentCreateConfigParent | null;
    unattended: boolean;
    availableModes: string[] | undefined;
    targetUnattendedMode: string | undefined;
}
export declare function resolveAndValidateCreateAgentMode(input: ResolveCreateAgentModeInput): string | undefined;
export declare function resolveDefaultAgentCreateConfig(input: ResolveAgentCreateConfigInput): ResolveAgentCreateConfigResult;
export declare function isDefaultAgentCreateConfigUnattended(input: AgentCreateConfigUnattendedInput): boolean;
//# sourceMappingURL=create-agent-mode.d.ts.map