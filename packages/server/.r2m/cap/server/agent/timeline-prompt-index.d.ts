import type { AgentTimelineRow } from "./agent-timeline-store-types.js";
export interface TimelinePromptIndexEntry {
    seq: number;
    timestamp: string;
    preview: string;
}
export interface TimelinePromptIndex {
    epoch: string;
    prompts: TimelinePromptIndexEntry[];
}
export declare function buildTimelinePromptIndex(epoch: string, rows: readonly AgentTimelineRow[]): TimelinePromptIndex;
//# sourceMappingURL=timeline-prompt-index.d.ts.map