import type { Logger } from "pino";
import { ProviderSnapshotManager, type ProviderSnapshotManagerOptions } from "./provider-snapshot-manager.js";
import type { PaseoToolCatalog } from "./tools/types.js";
export interface AgentProviderRuntime {
    snapshotManager: ProviderSnapshotManager;
    setPaseoToolCatalog(catalog: PaseoToolCatalog | null): void;
    shutdown(): Promise<void>;
}
interface CreateAgentProviderRuntimeOptions {
    paseoHome: string;
    logger: Logger;
    snapshotManager: Omit<ProviderSnapshotManagerOptions, "logger" | "openCodeBridge">;
}
export declare function createAgentProviderRuntime(options: CreateAgentProviderRuntimeOptions): Promise<AgentProviderRuntime>;
export {};
//# sourceMappingURL=provider-runtime.d.ts.map