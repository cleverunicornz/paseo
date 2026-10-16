import type { AgentListItemPayload, AgentSnapshotPayload, RecentProviderSessionDescriptorPayload } from "../messages.js";
import type { StoredAgentRecord } from "./agent-storage.js";
import type { AgentProvider, AgentRuntimeInfo, ImportableProviderSession } from "./agent-sdk-types.js";
import type { ManagedAgent } from "./agent-manager.js";
export type { ManagedAgent };
interface ProjectionOptions {
    title?: string | null;
    createdAt?: string;
    internal?: boolean;
}
interface RecentProviderSessionProjectionOptions {
    providerLabel: string;
}
export declare function resolveEffectiveThinkingOptionId(options: {
    runtimeInfo?: AgentRuntimeInfo | null;
    configuredThinkingOptionId?: string | null;
}): string | null;
export declare function toStoredAgentRecord(agent: ManagedAgent, options?: ProjectionOptions): StoredAgentRecord;
export declare function toAgentPayload(agent: ManagedAgent, options?: ProjectionOptions): AgentSnapshotPayload;
export declare function buildStoredAgentPayload(record: StoredAgentRecord, validProviders: Iterable<AgentProvider>): AgentSnapshotPayload;
export declare function toAgentListItemPayload(agent: AgentSnapshotPayload): AgentListItemPayload;
export declare function toRecentProviderSessionDescriptorPayload(session: ImportableProviderSession & {
    provider: string;
}, options: RecentProviderSessionProjectionOptions): RecentProviderSessionDescriptorPayload;
//# sourceMappingURL=agent-projections.d.ts.map