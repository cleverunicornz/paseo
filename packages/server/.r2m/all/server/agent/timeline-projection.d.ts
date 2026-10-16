import type { AgentTimelineItem } from "./agent-sdk-types.js";
import type { AgentTimelineRow } from "./agent-timeline-store-types.js";
export type TimelineProjectionMode = "canonical" | "projected";
export interface TimelineSeqRange {
    startSeq: number;
    endSeq: number;
}
export type TimelineProjectionKind = "assistant_merge" | "reasoning_merge" | "tool_lifecycle" | "identity";
export type TimelineLimitDirection = "tail" | "before" | "after";
export interface TimelineProjectionEntry {
    item: AgentTimelineItem;
    turnId?: string;
    providerMessageId?: string;
    timestamp: string;
    seqStart: number;
    seqEnd: number;
    sourceSeqRanges: TimelineSeqRange[];
    collapsed: TimelineProjectionKind[];
}
interface ProjectedWindowSelection {
    projectedEntries: TimelineProjectionEntry[];
    selectedRows: AgentTimelineRow[];
    minSeq: number | null;
    maxSeq: number | null;
}
export interface ProjectedTimelinePageSelection {
    entries: TimelineProjectionEntry[];
    startSeq: number | null;
    endSeq: number | null;
    hasOlder: boolean;
    hasNewer: boolean;
}
/** Fold a later update for the same tool call into the one it follows. */
export declare function mergeToolCallItems(existing: Extract<AgentTimelineItem, {
    type: "tool_call";
}>, incoming: Extract<AgentTimelineItem, {
    type: "tool_call";
}>): Extract<AgentTimelineItem, {
    type: "tool_call";
}>;
/** A retained item. `seq` is its latest source event, not its display anchor. */
export type ProjectedTimelineRow = AgentTimelineRow & TimelineProjectionEntry;
/** Owns projected state; source events are consumed, never retained. */
export declare class TimelineProjection {
    private readonly rows;
    private readonly identities;
    append(row: AgentTimelineRow): void;
    getRows(): ProjectedTimelineRow[];
    enrichSubmittedUserMessage(clientMessageId: string, providerMessageId: string): ProjectedTimelineRow | null;
}
export declare function projectTimelineRows(input: {
    rows: readonly AgentTimelineRow[];
    mode: TimelineProjectionMode;
}): TimelineProjectionEntry[];
/**
 * Select a timeline window based on projected-entry count, then map it back to
 * contiguous canonical rows. This avoids cutting through merged assistant
 * chunks when callers request canonical rows with a bounded limit.
 */
export declare function selectTimelineWindowByProjectedLimit(input: {
    rows: readonly AgentTimelineRow[];
    direction: TimelineLimitDirection;
    limit: number;
}): ProjectedWindowSelection;
export declare function selectProjectedTimelinePage(input: {
    rows: readonly AgentTimelineRow[];
    bounds?: {
        minSeq: number;
        maxSeq: number;
    };
    direction: TimelineLimitDirection;
    cursorSeq?: number;
    limit?: number;
}): ProjectedTimelinePageSelection;
/**
 * Apply a projected-count limit to a flat AgentTimelineItem[] without seq metadata.
 * Used by callers that only have items in hand (e.g. MCP tools reading
 * `agentManager.getTimeline`). Index position is treated as canonical seq.
 */
export interface ProjectedItemSelection {
    items: AgentTimelineItem[];
    totalProjected: number;
    shownProjected: number;
}
export declare function selectItemsByProjectedLimit(input: {
    items: readonly AgentTimelineItem[];
    direction: TimelineLimitDirection;
    limit: number;
}): ProjectedItemSelection;
export {};
//# sourceMappingURL=timeline-projection.d.ts.map