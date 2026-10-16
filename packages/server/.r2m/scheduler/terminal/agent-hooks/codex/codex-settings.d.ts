import { type AgentHookConfigFormat } from "../agent-hook-installer.js";
export interface CodexHooksFile {
    hooks?: Record<string, unknown>;
    [key: string]: unknown;
}
export declare const codexHooksFormat: AgentHookConfigFormat<CodexHooksFile>;
//# sourceMappingURL=codex-settings.d.ts.map