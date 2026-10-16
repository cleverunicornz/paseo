export interface AgentHookEventDefinition {
    event: string;
}
export type AgentHookActivityState = "running" | "idle" | "needs-input";
export interface AgentHookActivityInput {
    isTTY?: boolean;
    read(): Promise<string | null>;
}
export interface AgentHookProvider<TConfig = unknown> {
    id: string;
    events: AgentHookEventDefinition[];
    resolveActivity(input: {
        event: string;
        input: AgentHookActivityInput;
    }): Promise<AgentHookActivityState | null>;
    install: AgentHookInstallStrategy<TConfig>;
}
export type AgentHookInstallStrategy<TConfig> = AgentHookConfigFileInstallStrategy<TConfig> | AgentHookPluginFileInstallStrategy;
interface AgentHookInstallStrategyBase {
    kind: "config-file" | "plugin-file";
    configDir: string;
    configDirBase?: "home" | "xdg-config";
    configFile: string;
    configDirEnvOverride?: string;
    hookMarker: string;
}
export interface AgentHookConfigFileInstallStrategy<TConfig> extends AgentHookInstallStrategyBase {
    kind: "config-file";
    format: AgentHookConfigFormat<TConfig>;
}
export interface AgentHookPluginFileInstallStrategy extends AgentHookInstallStrategyBase {
    kind: "plugin-file";
    source: string;
}
export interface AgentHookConfigFormat<TConfig> {
    empty(): TConfig;
    parse(raw: string): TConfig;
    stringify(config: TConfig): string;
    install(config: TConfig, provider: AgentHookProvider<TConfig>): TConfig;
    uninstall(config: TConfig, provider: AgentHookProvider<TConfig>): TConfig;
    isInstalled(config: TConfig, provider: AgentHookProvider<TConfig>): boolean;
}
export interface AgentHookInstallOptions {
    env?: NodeJS.ProcessEnv;
    homeDir?: string;
    configDir?: string;
}
export interface AgentHookInstallLogger {
    warn(bindings: Record<string, unknown>, message: string): void;
}
export interface AgentHookInstallResult {
    configPath: string;
    changed: boolean;
}
export declare function installAgentHooks<TConfig>(provider: AgentHookProvider<TConfig>, options?: AgentHookInstallOptions): AgentHookInstallResult;
export declare function uninstallAgentHooks<TConfig>(provider: AgentHookProvider<TConfig>, options?: AgentHookInstallOptions): AgentHookInstallResult;
export declare function agentHooksAreInstalled<TConfig>(provider: AgentHookProvider<TConfig>, options?: AgentHookInstallOptions): boolean;
export declare function resolveAgentHookConfigPath<TConfig>(provider: AgentHookProvider<TConfig>, options?: AgentHookInstallOptions): string;
export declare function buildAgentHookShellCommand<TConfig>(provider: AgentHookProvider<TConfig>, event: AgentHookEventDefinition): string;
export declare function buildAgentHookWindowsCommand<TConfig>(provider: AgentHookProvider<TConfig>, event: AgentHookEventDefinition): string;
export {};
//# sourceMappingURL=agent-hook-installer.d.ts.map