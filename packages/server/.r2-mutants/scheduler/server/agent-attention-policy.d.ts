import type { AgentAttentionReason } from "@getpaseo/protocol/agent-attention-notification";
export declare const PRESENCE_THRESHOLD_MS = 180000;
export interface ClientPresenceState {
    appVisible: boolean;
    lastActivityAtMs: number | null;
    focusedAgentId: string | null;
    focusedTerminalId: string | null;
}
export type AttentionFocusTarget = {
    kind: "agent";
    id: string;
} | {
    kind: "terminal";
    id: string;
};
export interface NotificationPlan {
    inAppRecipientIndex: number | null;
    shouldPush: boolean;
}
interface ComputeNotificationPlanInput {
    allStates: ClientPresenceState[];
    focusTarget: AttentionFocusTarget | null;
    pushEligible: boolean;
    nowMs: number;
}
export declare function computeNotificationPlan({ allStates, focusTarget, pushEligible, nowMs, }: ComputeNotificationPlanInput): NotificationPlan;
export declare function isPushEligibleAttentionReason(reason: AgentAttentionReason): boolean;
export {};
//# sourceMappingURL=agent-attention-policy.d.ts.map