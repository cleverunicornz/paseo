import { type PersistedConfig } from "./persisted-config.js";
import type { AgentSkillSelection } from "@getpaseo/protocol/messages";
export type { MutableDaemonConfig, MutableDaemonConfigPatch } from "@getpaseo/protocol/messages";
type MutableDaemonConfig = import("@getpaseo/protocol/messages").MutableDaemonConfig;
type MutableDaemonConfigPatch = import("@getpaseo/protocol/messages").MutableDaemonConfigPatch;
type ProviderOverride = import("./agent/provider-launch-config.js").ProviderOverride;
interface LoggerLike {
    child(bindings: Record<string, unknown>): LoggerLike;
    info(...args: unknown[]): void;
}
export interface DaemonConfigChangeDetails {
    removedProviders: readonly string[];
}
export interface DaemonConfigReloadResult {
    appliedPaths: string[];
    restartRequiredPaths: string[];
    overrideControlledPaths: string[];
}
export interface DaemonConfigReloadSource {
    resolve(persisted: PersistedConfig): {
        mutable: MutableDaemonConfig;
        overrideControlledPaths: readonly string[];
    };
}
type ConfigListener = (config: MutableDaemonConfig, details: DaemonConfigChangeDetails) => void;
type ConfigApplyRollback = () => void;
type ConfigApplyListener = (config: MutableDaemonConfig, previous: MutableDaemonConfig, details: DaemonConfigChangeDetails) => ConfigApplyRollback;
type FieldChangeHandler = (value: unknown) => void;
export declare function applyMutableProviderConfigToOverrides(baseOverrides: Record<string, ProviderOverride> | undefined, mutableProviders: MutableDaemonConfig["providers"] | undefined): Record<string, ProviderOverride> | undefined;
export declare class DaemonConfigStore {
    private current;
    private readonly paseoHome;
    private readonly logger;
    private readonly changeListeners;
    private readonly applyListeners;
    private readonly fieldChangeHandlers;
    private readonly relayEnabledMutable;
    private readonly reloadSource;
    private readonly startupPersisted;
    private lastKnownPersisted;
    constructor(paseoHome: string, initial: MutableDaemonConfig, logger?: LoggerLike, options?: {
        relayEnabledMutable?: boolean;
        reloadSource?: DaemonConfigReloadSource;
        startupPersisted?: PersistedConfig;
    });
    get(): MutableDaemonConfig;
    patch(partial: MutableDaemonConfigPatch): MutableDaemonConfig;
    setAgentSkillSelection(selection: AgentSkillSelection): MutableDaemonConfig;
    private applySupportedPatch;
    reload(): DaemonConfigReloadResult;
    private applyReplacement;
    onFieldChange(path: string, handler: FieldChangeHandler): () => void;
    onChange(listener: ConfigListener): () => void;
    onApply(listener: ConfigApplyListener): () => void;
    private persistConfig;
}
//# sourceMappingURL=daemon-config-store.d.ts.map