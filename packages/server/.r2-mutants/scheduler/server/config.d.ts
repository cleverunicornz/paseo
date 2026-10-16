import type { PaseoDaemonConfig } from "./bootstrap.js";
import { type PersistedConfig } from "./persisted-config.js";
import { type HostnamesConfig } from "./hostnames.js";
export { loadPersistedConfig, readPersistedConfig, savePersistedConfig, getPersistedConfigValue, editPersistedConfig, type PersistedConfig, } from "./persisted-config.js";
interface ResolveBundledWebUiDistDirInput {
    moduleUrl?: string | URL;
    resourcesPath?: string;
}
export declare function resolveBundledWebUiDistDir(input?: ResolveBundledWebUiDistDirInput): string;
export type CliConfigOverrides = Partial<{
    listen: string;
    relayEnabled: boolean;
    relayUseTls: boolean;
    mcpEnabled: boolean;
    mcpInjectIntoAgents: boolean;
    webUiEnabled: boolean;
    hostnames: HostnamesConfig;
}>;
interface ResolveConfigFromPersistedOptions {
    env?: NodeJS.ProcessEnv;
    cli?: CliConfigOverrides;
    relayEnabledFallback?: boolean;
}
export declare function resolveConfigFromPersisted(paseoHome: string, persisted: PersistedConfig, options?: ResolveConfigFromPersistedOptions): PaseoDaemonConfig;
export declare function loadConfig(paseoHome: string, options?: Omit<ResolveConfigFromPersistedOptions, "relayEnabledFallback">): PaseoDaemonConfig;
//# sourceMappingURL=config.d.ts.map