import type { AgentSnapshotPayload, ProjectPlacementPayload, SessionOutboundMessage, WorkspaceDescriptorPayload, WorkspaceProjectDescriptorPayload } from "@getpaseo/protocol/messages";
interface AgentDirectoryEntry {
    agent: AgentSnapshotPayload;
    project: ProjectPlacementPayload;
}
interface DirectorySyncCursor {
    generation?: string;
    afterSeq?: number;
}
interface DirectoryVersion {
    generation: string;
    seq: number;
}
type ProjectUpdate = Extract<SessionOutboundMessage, {
    type: "project.update";
}>;
type ProjectListResponse = Extract<SessionOutboundMessage, {
    type: "project.list.response";
}>["payload"];
type FetchWorkspacesResponse = Extract<SessionOutboundMessage, {
    type: "fetch_workspaces_response";
}>["payload"];
type FetchAgentsResponse = Extract<SessionOutboundMessage, {
    type: "fetch_agents_response";
}>["payload"];
/** Daemon-global latest-state sequence owner for the active app directory. */
export declare class DirectorySyncService {
    private readonly generation;
    private readonly projects;
    private readonly workspaces;
    private readonly agents;
    constructor(generation?: `${string}-${string}-${string}-${string}-${string}`);
    synchronizeProjects(snapshot: Iterable<WorkspaceProjectDescriptorPayload>, cursor: DirectorySyncCursor): Pick<ProjectListResponse, "projects" | "sync">;
    synchronizeWorkspaces(snapshot: Iterable<WorkspaceDescriptorPayload>, cursor: DirectorySyncCursor): Pick<FetchWorkspacesResponse, "entries" | "emptyProjects" | "pageInfo" | "sync">;
    synchronizeAgents(snapshot: Iterable<AgentDirectoryEntry>, cursor: DirectorySyncCursor): Pick<FetchAgentsResponse, "entries" | "pageInfo" | "sync">;
    sequenceProjectUpdate(update: ProjectUpdate["payload"], includeSequence: boolean): ProjectUpdate["payload"];
    sequenceWorkspaceUpdate<T extends object>(payload: T, value: WorkspaceDescriptorPayload | null, id: string, includeSequence: boolean): T & Partial<DirectoryVersion>;
    sequenceAgentUpdate<T extends object>(payload: T, value: AgentDirectoryEntry | null, id: string, includeSequence: boolean): T & Partial<DirectoryVersion>;
    private metadata;
    private withVersion;
    private read;
    private version;
}
export {};
//# sourceMappingURL=index.d.ts.map