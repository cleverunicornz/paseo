import type { AgentTimelineItem } from "./agent-sdk-types.js";
import type { AgentAttachment } from "@getpaseo/protocol/messages";
import type { AgentTimelineRow } from "./agent-timeline-store-types.js";
interface ActivityCuratorOptions {
    maxItems?: number;
    labelAssistantMessages?: boolean;
    includeKinds?: readonly AgentTimelineItem["type"][];
    includeExternalToolInput?: boolean;
}
type TextAgentAttachment = Extract<AgentAttachment, {
    type: "text";
}>;
/**
 * Convert normalized agent timeline items into a concise text summary.
 */
export declare function curateAgentActivity(timeline: AgentTimelineItem[], options?: ActivityCuratorOptions): string;
interface ForkCursorBoundary {
    timelineEpoch: string;
    cursor: {
        epoch: string;
        seq: number;
    };
}
export declare function buildAgentForkContextAttachment(input: {
    rows: readonly AgentTimelineRow[];
    cursorBoundary?: ForkCursorBoundary | null;
    boundaryMessageId?: string | null;
    agentTitle?: string | null;
    cwd?: string | null;
}): {
    attachment: TextAgentAttachment;
    itemCount: number;
    boundaryCursor: {
        epoch: string;
        seq: number;
    } | null;
    boundaryMessageId: string | null;
};
export {};
//# sourceMappingURL=activity-curator.d.ts.map