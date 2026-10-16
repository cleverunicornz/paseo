import type { AgentManager } from "./agent-manager.js";
import type { AgentTimelineItem } from "./agent-sdk-types.js";
export interface AppendTimelineItemIfAgentKnownOptions {
    agentManager: AgentManager;
    agentId: string;
    item: AgentTimelineItem;
}
export declare function appendTimelineItemIfAgentKnown(options: AppendTimelineItemIfAgentKnownOptions): Promise<boolean>;
export declare function emitLiveTimelineItemIfAgentKnown(options: AppendTimelineItemIfAgentKnownOptions): Promise<boolean>;
//# sourceMappingURL=timeline-append.d.ts.map