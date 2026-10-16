import type { z } from "zod";
import type { Logger } from "pino";
import type { ProviderSnapshotManager } from "./provider-snapshot-manager.js";
import type { AgentManager, ManagedAgent } from "./agent-manager.js";
import type { AgentStorage } from "./agent-storage.js";
import type { AgentProvider } from "./agent-sdk-types.js";
import { type AgentLoaderManager } from "./agent-loading.js";
import type { WorkspaceProvisioningService } from "../session/workspace-provisioning/workspace-provisioning-service.js";
import type { PersistedWorkspaceRecord } from "../workspace-registry.js";
import type { FetchRecentProviderSessionsRequestMessage, ImportAgentRequestMessageSchema, RecentProviderSessionDescriptorPayload } from "@getpaseo/protocol/messages";
type ImportAgentRequestMessage = z.infer<typeof ImportAgentRequestMessageSchema>;
export type ImportSessionAgentManager = AgentLoaderManager & Pick<AgentManager, "archiveSnapshot" | "closeAgent" | "getTimeline" | "importProviderSession" | "notifyAgentState" | "unarchiveSnapshot">;
export interface NormalizedImportAgentRequest {
    provider: AgentProvider;
    providerHandleId: string;
    cwd?: string;
    workspaceId?: string;
    labels?: Record<string, string>;
    requestId: string;
}
export declare class ImportSessionsRequestError extends Error {
    readonly code: string;
    constructor(code: string, message: string);
}
export interface ListImportableProviderSessionsInput {
    request: FetchRecentProviderSessionsRequestMessage;
    agentManager: Pick<AgentManager, "listAgents" | "listImportableSessions">;
    agentStorage: Pick<AgentStorage, "list">;
    providerSnapshotManager: Pick<ProviderSnapshotManager, "getProviderLabel">;
}
export interface ListImportableProviderSessionsResult {
    entries: RecentProviderSessionDescriptorPayload[];
    filteredAlreadyImportedCount: number;
    providerErrors: Array<{
        provider: string;
        message: string;
    }>;
}
export interface ImportProviderSessionInput {
    request: NormalizedImportAgentRequest;
    workspaceProvisioning: Pick<WorkspaceProvisioningService, "runInImportWorkspace">;
    agentManager: ImportSessionAgentManager;
    agentStorage: AgentStorage;
    logger: Logger;
}
export interface ImportProviderSessionResult {
    snapshot: ManagedAgent;
    timelineSize: number;
    createdWorkspace: PersistedWorkspaceRecord | null;
}
export declare function normalizeImportAgentRequest(msg: ImportAgentRequestMessage): NormalizedImportAgentRequest | {
    error: string;
};
export declare function listImportableProviderSessions(input: ListImportableProviderSessionsInput): Promise<ListImportableProviderSessionsResult>;
export declare function importProviderSession(input: ImportProviderSessionInput): Promise<ImportProviderSessionResult>;
export {};
//# sourceMappingURL=import-sessions.d.ts.map