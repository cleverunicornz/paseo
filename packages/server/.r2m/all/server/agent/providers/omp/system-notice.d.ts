import type { AgentTimelineItem } from "../../agent-sdk-types.js";
type OmpSystemNotificationItem = Extract<AgentTimelineItem, {
    type: "notification";
}>;
export declare function isOmpSystemNotice(text: string): boolean;
export declare function mapOmpSystemNoticeToNotification(text: string): OmpSystemNotificationItem | null;
export {};
//# sourceMappingURL=system-notice.d.ts.map