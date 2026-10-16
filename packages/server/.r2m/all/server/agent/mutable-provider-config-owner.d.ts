import type { DaemonConfigStore } from "../daemon-config-store.js";
import type { AgentManagerProviderState, ProviderSnapshotManager } from "./provider-snapshot-manager.js";
export declare function attachMutableProviderConfigOwner(options: {
    store: DaemonConfigStore;
    providerSnapshotManager: ProviderSnapshotManager;
    updateProviderRegistry: (state: AgentManagerProviderState) => void;
}): () => void;
//# sourceMappingURL=mutable-provider-config-owner.d.ts.map