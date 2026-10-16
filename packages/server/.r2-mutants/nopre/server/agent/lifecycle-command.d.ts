import type { Logger } from "pino";
import { type AgentRunCancellationResult, type ManagedAgent } from "./agent-manager.js";
import type { StoredAgentRecord } from "./agent-storage.js";
import type { AgentProviderNotice } from "./agent-sdk-types.js";
export type LifecycleAgentSnapshot = Pick<ManagedAgent, "id" | "cwd" | "lifecycle">;
export interface LifecycleAgentManager {
    getAgent(agentId: string): LifecycleAgentSnapshot | null;
    hasInFlightRun(agentId: string): boolean;
    cancelAgentRun(agentId: string): Promise<AgentRunCancellationResult>;
    clearAgentAttention(agentId: string): Promise<void>;
    archiveAgent(agentId: string): Promise<{
        archivedAt: string;
    }>;
    archiveSnapshot(agentId: string, archivedAt: string): Promise<StoredAgentRecord>;
    closeAgent(agentId: string): Promise<void>;
    setLabels(agentId: string, labels: Record<string, string>): Promise<void>;
    detachAgent(agentId: string): Promise<{
        record: StoredAgentRecord;
        live: boolean;
        previousParentAgentId: string | null;
    }>;
    notifyAgentState(agentId: string): void;
    setAgentMode(agentId: string, modeId: string): Promise<AgentProviderNotice | null>;
    updateAgentMetadata(agentId: string, updates: {
        title?: string;
        labels?: Record<string, string>;
    }): Promise<void>;
}
export interface LifecycleAgentStorage {
    get(agentId: string): Promise<StoredAgentRecord | null>;
    upsert(record: StoredAgentRecord): Promise<void>;
}
export interface AgentLifecycleCommandDependencies {
    agentManager: LifecycleAgentManager;
    agentStorage: LifecycleAgentStorage;
    logger: Logger;
}
export interface CancelAgentRunResult {
    agent: LifecycleAgentSnapshot;
    cancelled: boolean;
}
export declare function cancelAgentRunCommand(dependencies: Pick<AgentLifecycleCommandDependencies, "agentManager" | "logger">, agentId: string): Promise<CancelAgentRunResult>;
export interface ArchiveAgentResult {
    agentId: string;
    archivedAt: string;
    record: StoredAgentRecord;
}
export declare function archiveAgentCommand(dependencies: AgentLifecycleCommandDependencies, agentId: string): Promise<ArchiveAgentResult>;
export declare function closeAgentCommand(dependencies: Pick<AgentLifecycleCommandDependencies, "agentManager">, agentId: string): Promise<void>;
export interface UpdateAgentResult {
    accepted: boolean;
    error: string | null;
}
export declare function updateAgentCommand(dependencies: Pick<AgentLifecycleCommandDependencies, "agentManager">, input: {
    agentId: string;
    name?: string;
    labels?: Record<string, string>;
}): Promise<UpdateAgentResult>;
export interface DetachAgentResult {
    agentId: string;
    record: StoredAgentRecord;
    live: boolean;
    previousParentAgentId: string | null;
}
export declare function detachAgentCommand(dependencies: Pick<AgentLifecycleCommandDependencies, "agentManager">, agentId: string): Promise<DetachAgentResult>;
export declare function setAgentModeCommand(dependencies: Pick<AgentLifecycleCommandDependencies, "agentManager">, input: {
    agentId: string;
    modeId: string;
}): Promise<{
    modeId: string;
    notice: AgentProviderNotice | null;
}>;
//# sourceMappingURL=lifecycle-command.d.ts.map