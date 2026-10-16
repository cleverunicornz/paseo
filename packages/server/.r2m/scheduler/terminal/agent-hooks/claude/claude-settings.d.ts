import { type AgentHookConfigFormat } from "../agent-hook-installer.js";
export interface ClaudeSettings {
    hooks?: Record<string, unknown>;
    [key: string]: unknown;
}
export declare const claudeSettingsFormat: AgentHookConfigFormat<ClaudeSettings>;
//# sourceMappingURL=claude-settings.d.ts.map