export declare const builtinPlugins: readonly ["antigravity-provider", "claude-usage-source", "codex-usage-source", "copilot-usage-source", "cursor-usage-source", "grok-usage-source", "kimi-usage-source", "minimax-usage-source", "muse-provider", "opencode-go-usage-source", "zai-usage-source"];
export declare function resolveBuiltinPluginsRoot(moduleUrl?: string | URL): string;
export interface BuiltinPlugin {
    id: string;
    directory: string;
}
export declare class BuiltinPluginLoader {
    private readonly root;
    private readonly list;
    readonly ids: ReadonlySet<string>;
    constructor(root?: string, list?: readonly string[]);
    load(start: (plugin: BuiltinPlugin) => Promise<void>): Promise<void>;
}
//# sourceMappingURL=index.d.ts.map