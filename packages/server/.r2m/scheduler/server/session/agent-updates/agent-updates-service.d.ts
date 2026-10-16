import type pino from "pino";
import type { AgentSnapshotPayload, ProjectPlacementPayload, SessionInboundMessage, SessionOutboundMessage } from "../../messages.js";
import type { ManagedAgent } from "../../agent/agent-manager.js";
import type { StoredAgentRecord } from "../../agent/agent-storage.js";
type AgentUpdatePayload = Extract<SessionOutboundMessage, {
    type: "agent_update";
}>["payload"];
type AgentUpdatesFilter = NonNullable<Extract<SessionInboundMessage, {
    type: "fetch_agents_request";
}>["filter"]>;
/** Owns filtered agent snapshots and live updates for independent observers. */
export interface AgentUpdatesService {
    beginSubscription(input: {
        subscriptionId: string;
        isProviderVisible?: (provider: string) => boolean;
        emit?: (message: SessionOutboundMessage) => void;
        filter?: AgentUpdatesFilter;
        syncEnabled?: boolean;
    }): void;
    flushBootstrapped(subscriptionId: string, options?: {
        snapshotUpdatedAtByAgentId?: Map<string, number>;
    }): void;
    clearSubscription(subscriptionId: string): void;
    hasSubscription(): boolean;
    includesLiveAgent(agent: ManagedAgent, subscriptionIds?: ReadonlySet<string>): Promise<boolean>;
    forwardLiveAgent(agent: ManagedAgent): Promise<void>;
    emitStoredRecord(record: StoredAgentRecord): Promise<AgentSnapshotPayload>;
    removeAgent(agentId: string): Promise<void>;
    dispose(): void;
}
export interface AgentUpdatesServiceDeps {
    emit(message: SessionOutboundMessage): void;
    enrichAgentPayload(payload: AgentSnapshotPayload): Promise<AgentSnapshotPayload>;
    buildStoredAgentPayload(record: StoredAgentRecord): AgentSnapshotPayload;
    isProviderVisibleToClient(provider: string): boolean;
    buildProjectPlacementForWorkspaceId(workspaceId: string): Promise<ProjectPlacementPayload | null>;
    emitWorkspaceUpdateForWorkspaceId(workspaceId: string): Promise<void>;
    sequenceAgentUpdate<T extends AgentUpdatePayload>(payload: T, agent: AgentSnapshotPayload | null, project: ProjectPlacementPayload | null, agentId: string, includeSequence: boolean): T;
    logger: pino.Logger;
}
/**
 * Pure predicate shared by the live subscription stream and the snapshot listing
 * pager: does an agent (with its resolved project placement) satisfy a
 * `fetch_agents` filter?
 */
export declare function matchesAgentUpdatesFilter(input: {
    agent: AgentSnapshotPayload;
    project: ProjectPlacementPayload;
    filter?: AgentUpdatesFilter;
}): boolean;
export declare function createAgentUpdatesService(deps: AgentUpdatesServiceDeps): AgentUpdatesService;
export {};
//# sourceMappingURL=agent-updates-service.d.ts.map