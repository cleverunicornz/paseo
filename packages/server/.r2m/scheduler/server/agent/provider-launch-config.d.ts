import { type ProcessEnvRecord, type ExternalProcessEnv } from "../paseo-env.js";
export { AgentProviderRuntimeSettingsMapSchema, ProviderCommandSchema, ProviderOverrideSchema, ProviderOverridesSchema, ProviderProfileModelSchema, ProviderRuntimeSettingsSchema, type AgentProviderRuntimeSettingsMap, type ProviderCommand, type ProviderOverride, type ProviderOverrides, type ProviderProfileModel, type ProviderRuntimeSettings, } from "@getpaseo/protocol/provider-config";
import { type ProviderCommand, type ProviderOverrides, type ProviderRuntimeSettings } from "@getpaseo/protocol/provider-config";
export interface ProviderCommandPrefix {
    command: string;
    args: string[];
}
export type ProviderLaunchSource = "default" | "append" | "override";
export interface ResolvedProviderLaunch {
    command: string;
    args: string[];
    source: ProviderLaunchSource;
    env?: ProcessEnvRecord;
}
export interface ProviderLaunchAvailability {
    available: boolean;
    resolvedPath: string | null;
}
export interface ProviderLaunchDefault {
    command: string;
    resolvePath?: () => Promise<string | null>;
}
export interface ResolveProviderLaunchOptions {
    commandConfig?: ProviderCommand;
    defaultBinary?: string | ProviderLaunchDefault;
}
export declare function resolveProviderLaunch({ commandConfig, defaultBinary, }: ResolveProviderLaunchOptions): Promise<ResolvedProviderLaunch>;
export declare function checkProviderLaunchAvailable(launch: ResolvedProviderLaunch, defaultBinary?: ProviderLaunchDefault): Promise<ProviderLaunchAvailability>;
export declare function resolveProviderCommandPrefix(commandConfig: ProviderCommand | undefined, resolveDefaultCommand: () => string | Promise<string>): Promise<ProviderCommandPrefix>;
export declare function resolveShellEnv(): Record<string, string>;
export declare function migrateProviderSettings(raw: Record<string, unknown>, builtinProviderIds: string[]): ProviderOverrides;
export interface ProviderEnvOptions {
    baseEnv?: ProcessEnvRecord;
    runtimeSettings?: ProviderRuntimeSettings;
    overlays?: Array<ProcessEnvRecord | undefined>;
}
export interface ProviderEnvSpec {
    baseEnv?: ProcessEnvRecord;
    envOverlay: ProcessEnvRecord;
}
export declare function createProviderEnvSpec(options?: ProviderEnvOptions): ProviderEnvSpec;
export declare function createProviderEnv(options?: ProviderEnvOptions): ExternalProcessEnv;
export declare function isProviderCommandAvailable(commandConfig: ProviderCommand | undefined, resolveDefaultCommand: () => string | Promise<string>): Promise<boolean>;
//# sourceMappingURL=provider-launch-config.d.ts.map