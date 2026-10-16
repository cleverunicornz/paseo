import type { AgentTimelineItem } from "../../agent-sdk-types.js";
export type OmpRuntimeEventMapping = {
    handled: false;
} | {
    handled: true;
    item: AgentTimelineItem;
} | {
    handled: true;
    item: null;
    logReason: string;
};
export declare function mapOmpRuntimeEventToTimelineItem(event: unknown): OmpRuntimeEventMapping;
//# sourceMappingURL=event-mapper.d.ts.map