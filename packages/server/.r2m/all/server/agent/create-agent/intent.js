import { PARENT_AGENT_ID_LABEL } from "@getpaseo/protocol/agent-labels";
export async function resolveCreateAgentIntent(input) {
    const parentAgentId = input.legacyDetached ? null : (input.caller?.id ?? null);
    const placement = await resolvePlacement(input);
    const labels = {
        ...input.childAgentDefaultLabels,
        ...input.labels,
        ...(parentAgentId ? { [PARENT_AGENT_ID_LABEL]: parentAgentId } : {}),
    };
    // COMPAT(detachedCreate): legacy callers may still request detached creation.
    // Added in v0.2.0; remove after 2027-01-17 once detached creation is outside the floor.
    // The delete also strips a parent label injected through input.labels.
    if (input.legacyDetached) {
        delete labels[PARENT_AGENT_ID_LABEL];
    }
    return { ...placement, parentAgentId, labels };
}
async function resolvePlacement(input) {
    if (input.explicitWorkspaceId) {
        return input.resolveWorkspace(input.explicitWorkspaceId);
    }
    if (input.caller) {
        if (!input.caller.workspaceId) {
            throw new Error(`Caller agent ${input.caller.id} has no workspace`);
        }
        return { workspaceId: input.caller.workspaceId, cwd: input.caller.cwd };
    }
    return input.createWorkspace();
}
//# sourceMappingURL=intent.js.map