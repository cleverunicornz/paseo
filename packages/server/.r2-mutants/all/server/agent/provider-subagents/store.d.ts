import type { AgentProvider, AgentTimelineItem } from "../agent-sdk-types.js";
import type { AgentTimelineFetchOptions, AgentTimelineFetchResult, AgentTimelineRow } from "../agent-timeline-store-types.js";
export type ProviderSubagentStatus = "running" | "completed" | "failed" | "canceled";
export interface ProviderSubagentDescriptor {
    id: string;
    parentAgentId: string;
    /** Direct provider-subagent parent. Null identifies a child of the managed agent. */
    parentSubagentId: string | null;
    provider: AgentProvider;
    title: string | null;
    description: string | null;
    status: ProviderSubagentStatus;
    createdAt: string;
    updatedAt: string;
    toolCallId: string | null;
    cwd: string | null;
    subtitle: string | null;
}
export type ProviderSubagentInputEvent = {
    type: "upsert";
    id: string;
    title?: string | null;
    description?: string | null;
    /**
     * Omit to keep the stored status. A presentation-only upsert says nothing about whether the
     * child is still running, and must not revert a finished one.
     */
    status?: ProviderSubagentStatus;
    toolCallId?: string | null;
    cwd?: string | null;
    subtitle?: string | null;
    parentSubagentId?: string | null;
    timestamp?: string;
} | {
    type: "timeline";
    id: string;
    item: AgentTimelineItem;
    timestamp?: string;
} | {
    type: "remove";
    id: string;
};
export type ProviderSubagentStoreEvent = {
    type: "upsert";
    subagent: ProviderSubagentDescriptor;
} | {
    type: "timeline";
    parentAgentId: string;
    subagentId: string;
    provider: AgentProvider;
    row: AgentTimelineRow;
    epoch: string;
} | {
    type: "remove";
    parentAgentId: string;
    subagentId: string;
};
export declare class ProviderSubagentStore {
    private readonly descriptors;
    private readonly timelines;
    apply(parentAgentId: string, provider: AgentProvider, event: ProviderSubagentInputEvent): ProviderSubagentStoreEvent;
    list(parentAgentId: string): ProviderSubagentDescriptor[];
    listAll(): ProviderSubagentDescriptor[];
    get(parentAgentId: string, subagentId: string): ProviderSubagentDescriptor | null;
    fetchTimeline(parentAgentId: string, subagentId: string, options?: AgentTimelineFetchOptions): AgentTimelineFetchResult;
    deleteParent(parentAgentId: string): ProviderSubagentStoreEvent[];
}
//# sourceMappingURL=store.d.ts.map