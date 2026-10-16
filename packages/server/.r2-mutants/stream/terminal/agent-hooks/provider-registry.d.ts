import { type AgentHookActivityInput, type AgentHookActivityState, type AgentHookInstallLogger, type AgentHookInstallOptions, type AgentHookInstallResult, type AgentHookProvider } from "./agent-hook-installer.js";
import { claudeAgentHookProvider } from "./claude/claude.js";
import { codexAgentHookProvider } from "./codex/codex.js";
import { opencodeAgentHookProvider } from "./opencode/opencode.js";
export type { AgentHookActivityInput, AgentHookActivityState, AgentHookProvider, } from "./agent-hook-installer.js";
export declare const AGENT_HOOK_PROVIDERS: {
    [claudeAgentHookProvider.id]: AgentHookProvider<import("./claude/claude-settings.js").ClaudeSettings>;
    [codexAgentHookProvider.id]: AgentHookProvider<import("./codex/codex-settings.js").CodexHooksFile>;
    [opencodeAgentHookProvider.id]: AgentHookProvider<unknown>;
};
export type AgentHookProviderId = keyof typeof AGENT_HOOK_PROVIDERS;
export interface AgentHookActivityRequest {
    provider: string;
    event: string;
    input: AgentHookActivityInput;
}
export interface RegisteredAgentHookInstallOptions extends AgentHookInstallOptions {
    logger?: AgentHookInstallLogger;
}
export declare function installRegisteredAgentHooks(options?: RegisteredAgentHookInstallOptions): AgentHookInstallResult[];
export declare function uninstallRegisteredAgentHooks(options?: AgentHookInstallOptions): void;
export declare function registeredAgentHooksAreInstalled(options?: AgentHookInstallOptions): boolean;
export declare function resolveHookActivity(request: AgentHookActivityRequest): Promise<AgentHookActivityState | null>;
//# sourceMappingURL=provider-registry.d.ts.map