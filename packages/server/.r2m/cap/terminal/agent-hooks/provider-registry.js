import { agentHooksAreInstalled, installAgentHooks, uninstallAgentHooks, } from "./agent-hook-installer.js";
import { claudeAgentHookProvider } from "./claude/claude.js";
import { codexAgentHookProvider } from "./codex/codex.js";
import { opencodeAgentHookProvider } from "./opencode/opencode.js";
export const AGENT_HOOK_PROVIDERS = {
    [claudeAgentHookProvider.id]: claudeAgentHookProvider,
    [codexAgentHookProvider.id]: codexAgentHookProvider,
    [opencodeAgentHookProvider.id]: opencodeAgentHookProvider,
};
export function installRegisteredAgentHooks(options = {}) {
    const results = [];
    for (const provider of Object.values(AGENT_HOOK_PROVIDERS)) {
        try {
            results.push(installAgentHooks(provider, options));
        }
        catch (error) {
            options.logger?.warn({ err: error, provider: provider.id }, "Failed to install terminal activity hook provider");
        }
    }
    return results;
}
export function uninstallRegisteredAgentHooks(options = {}) {
    for (const provider of Object.values(AGENT_HOOK_PROVIDERS)) {
        uninstallAgentHooks(provider, options);
    }
}
export function registeredAgentHooksAreInstalled(options = {}) {
    return Object.values(AGENT_HOOK_PROVIDERS).every((provider) => agentHooksAreInstalled(provider, options));
}
export async function resolveHookActivity(request) {
    const provider = AGENT_HOOK_PROVIDERS[request.provider.toLowerCase()];
    if (!provider)
        return null;
    return provider.resolveActivity({ event: request.event, input: request.input });
}
//# sourceMappingURL=provider-registry.js.map