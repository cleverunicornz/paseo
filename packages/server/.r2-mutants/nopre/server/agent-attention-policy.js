export const PRESENCE_THRESHOLD_MS = 180000;
function isFocusedOnTarget(state, target) {
    if (target === null) {
        return false;
    }
    if (target.kind === "agent") {
        return state.focusedAgentId === target.id;
    }
    return state.focusedTerminalId === target.id;
}
export function computeNotificationPlan({ allStates, focusTarget, pushEligible, nowMs, }) {
    let mostRecentPresentIndex = null;
    let mostRecentPresentAtMs = Number.NEGATIVE_INFINITY;
    for (const [clientIndex, state] of allStates.entries()) {
        const clampedActivityAtMs = state.lastActivityAtMs === null ? null : Math.min(state.lastActivityAtMs, nowMs);
        const isPresent = clampedActivityAtMs !== null && nowMs - clampedActivityAtMs <= PRESENCE_THRESHOLD_MS;
        if (!isPresent) {
            continue;
        }
        if (state.appVisible && isFocusedOnTarget(state, focusTarget)) {
            return { inAppRecipientIndex: null, shouldPush: false };
        }
        if (clampedActivityAtMs > mostRecentPresentAtMs) {
            mostRecentPresentIndex = clientIndex;
            mostRecentPresentAtMs = clampedActivityAtMs;
        }
    }
    if (mostRecentPresentIndex !== null) {
        return { inAppRecipientIndex: mostRecentPresentIndex, shouldPush: false };
    }
    return { inAppRecipientIndex: null, shouldPush: pushEligible };
}
export function isPushEligibleAttentionReason(reason) {
    return reason !== "error";
}
//# sourceMappingURL=agent-attention-policy.js.map