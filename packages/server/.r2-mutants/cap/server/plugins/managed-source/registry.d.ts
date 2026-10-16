import { type PluginRegistries, type PluginRegistryIdentity } from "@getpaseo/protocol/plugin-registry";
export interface RegistryOptions {
    defaultUrl?: string;
    registries?: PluginRegistries;
}
export declare function resolveRegistryPlugin(identity: PluginRegistryIdentity, options: RegistryOptions, install: boolean): Promise<{
    input: {
        source: string;
        ref?: undefined;
        pluginPath?: undefined;
    } | {
        source: string;
        ref: string;
        pluginPath: string | undefined;
    };
    target: {
        kind: "git";
        commit: string;
    } | {
        kind: "npm";
        version: string;
        resolved: string;
        integrity: string;
    };
    artifact: {
        kind: "npm";
        package: string;
        version: string;
        resolved: string;
        integrity: string;
    } | {
        kind: "git";
        remote: string;
        commit: string;
        pluginPath?: string | undefined;
    };
}>;
//# sourceMappingURL=registry.d.ts.map