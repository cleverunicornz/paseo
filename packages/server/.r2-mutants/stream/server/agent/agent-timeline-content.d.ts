import type { AgentTimelineItem } from "./agent-sdk-types.js";
import type { JsonValue } from "@getpaseo/protocol/agent-types";
export declare const PLUGIN_TIMELINE_DATA_MAX_BYTES: number;
export declare function assertPluginTimelineDataSize(data: JsonValue): void;
export declare function limitAgentTimelineItemContent(item: AgentTimelineItem): AgentTimelineItem;
//# sourceMappingURL=agent-timeline-content.d.ts.map