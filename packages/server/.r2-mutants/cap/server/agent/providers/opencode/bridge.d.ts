import type { Logger } from "pino";
import type { PaseoToolCatalog } from "../../tools/types.js";
interface OpenCodeBridgeOptions {
    paseoHome: string;
    logger: Logger;
}
interface OpenCodeSessionBinding {
    env: Record<string, string>;
    tools?: PaseoToolCatalog;
}
interface BindOpenCodeSessionInput extends OpenCodeSessionBinding {
    sessionId: string;
}
export declare class OpenCodeBridge {
    private readonly paseoHome;
    private readonly logger;
    private readonly token;
    private readonly sessions;
    private server;
    private baseUrl;
    private pluginUrl;
    private v2PluginUrl;
    private manifestCatalog;
    constructor(options: OpenCodeBridgeOptions);
    start(): Promise<void>;
    setManifestCatalog(catalog: PaseoToolCatalog | null): void;
    bindSession(input: BindOpenCodeSessionInput): () => void;
    decorateServerEnv(env: Record<string, string>): Record<string, string>;
    decorateV2ServerEnv(env: Record<string, string>): Promise<Record<string, string>>;
    close(): Promise<void>;
    private materializePlugin;
    private route;
    private serializeManifest;
    private executeTool;
    private requireBaseUrl;
    private requirePluginUrl;
}
export declare function materializeOpenCodeV2Plugin(paseoHome: string): Promise<string>;
export declare function decorateOpenCodeV2Env(env: Record<string, string>, pluginUrl: string, options?: Record<string, string>): Record<string, string>;
type CompileOpenCodeBridgePlugin = (sourcePath: string) => Promise<Uint8Array>;
export declare function loadOpenCodeBridgePluginArtifact(moduleUrl: string, compileSource?: CompileOpenCodeBridgePlugin, version?: 1 | 2): Promise<Uint8Array>;
export {};
//# sourceMappingURL=bridge.d.ts.map