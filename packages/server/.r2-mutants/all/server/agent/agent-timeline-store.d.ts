import { type ProjectedTimelineRow } from "./timeline-projection.js";
import type { AgentTimelineItem } from "./agent-sdk-types.js";
import type { AgentTimelineFetchOptions, AgentTimelineFetchResult, AgentTimelineRow } from "./agent-timeline-store-types.js";
export interface SeedAgentTimelineOptions {
    items?: readonly AgentTimelineItem[];
    rows?: readonly AgentTimelineRow[];
    epoch?: string;
    nextSeq?: number;
    timestamp?: string;
}
export declare class InMemoryAgentTimelineStore {
    private readonly states;
    has(agentId: string): boolean;
    initialize(agentId: string, options?: SeedAgentTimelineOptions): void;
    delete(agentId: string): void;
    getItems(agentId: string): AgentTimelineItem[];
    getRows(agentId: string): ProjectedTimelineRow[];
    getSubmittedUserMessage(agentId: string, clientMessageId: string): AgentTimelineRow | null;
    enrichSubmittedUserMessage(agentId: string, clientMessageId: string, providerMessageId: string): AgentTimelineRow | null;
    getEpoch(agentId: string): string;
    fetch(agentId: string, options?: AgentTimelineFetchOptions): AgentTimelineFetchResult;
    append(agentId: string, item: AgentTimelineItem, options?: {
        timestamp?: string;
        providerMessageId?: string;
        turnId?: string;
    }): AgentTimelineRow;
    getLastItem(agentId: string): AgentTimelineItem | null;
    getLastAssistantMessage(agentId: string): string | null;
    private requireState;
    private buildRowsFromItems;
}
//# sourceMappingURL=agent-timeline-store.d.ts.map