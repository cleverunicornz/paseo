import type pino from "pino";
import type { AgentSnapshotPayload, SessionInboundMessage, SessionOutboundMessage, WorkspaceDescriptorPayload } from "./messages.js";
import type { PersistedProjectRecord, PersistedWorkspaceRecord } from "./workspace-registry.js";
import { type TerminalActivity } from "@getpaseo/protocol/terminal-activity";
import type { ProviderSubagentDescriptor } from "./agent/provider-subagents/store.js";
type FetchWorkspacesRequestMessage = Extract<SessionInboundMessage, {
    type: "fetch_workspaces_request";
}>;
type FetchWorkspacesRequestFilter = NonNullable<FetchWorkspacesRequestMessage["filter"]>;
type FetchWorkspacesResponsePayload = Extract<SessionOutboundMessage, {
    type: "fetch_workspaces_response";
}>["payload"];
type FetchWorkspacesResponseEntry = FetchWorkspacesResponsePayload["entries"][number];
type FetchWorkspacesResponsePageInfo = FetchWorkspacesResponsePayload["pageInfo"];
type WorkspaceProjectDescriptor = FetchWorkspacesResponsePayload["emptyProjects"][number];
export type WorkspaceUpdatesFilter = FetchWorkspacesRequestFilter;
export type ProviderSubagentWorkspaceActivity = Pick<ProviderSubagentDescriptor, "parentAgentId" | "status" | "updatedAt">;
export interface WorkspaceDirectoryDeps {
    logger: pino.Logger;
    projectRegistry: {
        list(): Promise<PersistedProjectRecord[]>;
    };
    workspaceRegistry: {
        list(): Promise<PersistedWorkspaceRecord[]>;
    };
    listAgentPayloads(): Promise<AgentSnapshotPayload[]>;
    listProviderSubagentActivity(): Promise<ProviderSubagentWorkspaceActivity[]>;
    listTerminalActivityContributions(): Promise<Array<{
        cwd: string;
        workspaceId?: string;
        activity: TerminalActivity | null;
    }>>;
    isProviderVisibleToClient(provider: string): boolean;
    buildWorkspaceDescriptor(input: {
        workspace: PersistedWorkspaceRecord;
        projectRecord?: PersistedProjectRecord | null;
        includeGitData: boolean;
    }): Promise<WorkspaceDescriptorPayload>;
}
export declare function summarizeFetchWorkspacesEntries(entries: Iterable<FetchWorkspacesResponseEntry>): {
    count: number;
    projectIds: string[];
    statusCounts: Record<string, number>;
    workspaces: Array<{
        id: string;
        projectId: string;
        projectDisplayName: string;
        name: string;
        status: FetchWorkspacesResponseEntry["status"];
        workspaceKind: FetchWorkspacesResponseEntry["workspaceKind"];
        activityAt: string | null;
    }>;
};
/**
 * Git facts (branch, diff, dirty, PR) belong to a checkout on disk, not to a
 * workspace identity. Every workspace whose own cwd is that checkout re-derives
 * its git facts from the same folder. This returns the ids of those workspaces
 * so a git change can fan out to all of them. This is git-fact display, NOT
 * ownership: do not use it to decide which workspace owns an arbitrary path.
 */
export declare function workspaceIdsOnCheckout(workspaces: Iterable<PersistedWorkspaceRecord>, cwd: string): string[];
export declare function workspaceIdsForProjects(workspaces: Iterable<PersistedWorkspaceRecord>, projectIds: ReadonlySet<string>): string[];
export declare class WorkspaceDirectory {
    private readonly deps;
    private readonly archivingByWorkspaceId;
    /**
     * Per-workspace last-seen winning bucket + entered-at. Persists across
     * `buildDescriptorMap` calls inside the daemon process; reset on cold start.
     * Server-internal; never crosses the wire.
     */
    private readonly bucketHistoryByWorkspaceId;
    private readonly pager;
    constructor(deps: WorkspaceDirectoryDeps);
    markArchiving(workspaceIds: Iterable<string>, archivingAt: string): void;
    clearArchiving(workspaceIds: Iterable<string>): void;
    buildDescriptorMap(options: {
        includeGitData: boolean;
        workspaceIds?: Iterable<string>;
    }): Promise<Map<string, WorkspaceDescriptorPayload>>;
    private applyProviderSubagentContributions;
    private applyAgentBucketContributions;
    private applyTerminalContributions;
    private resolveStatusEnteredAt;
    private findNewestTimestampInBucket;
    listEmptyProjects(): Promise<WorkspaceProjectDescriptor[]>;
    listObservationTargets(): Promise<Pick<WorkspaceDescriptorPayload, "id" | "workspaceDirectory" | "workspaceKind">[]>;
    listDescriptors(): Promise<WorkspaceDescriptorPayload[]>;
    matchesFilter(input: {
        workspace: WorkspaceDescriptorPayload;
        filter: FetchWorkspacesRequestFilter | undefined;
    }): boolean;
    listFetchEntries(request: FetchWorkspacesRequestMessage): Promise<{
        entries: FetchWorkspacesResponseEntry[];
        emptyProjects: WorkspaceProjectDescriptor[];
        pageInfo: FetchWorkspacesResponsePageInfo;
    }>;
}
export declare function resolveWorkspaceRootAgent(agent: AgentSnapshotPayload, activeAgentsById: ReadonlyMap<string, AgentSnapshotPayload>): AgentSnapshotPayload | null;
export {};
//# sourceMappingURL=workspace-directory.d.ts.map