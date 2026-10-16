export function formatWorkspaceAutomationBlockedMessage(source) {
    const changeRequestNoun = source.forge === "gitlab" ? "MR" : "PR";
    return `Scripts are blocked for ${changeRequestNoun} #${source.number} from ${source.headRepository}. Run setup to allow them.`;
}
export class WorkspaceAutomationBlockedError extends Error {
    constructor(source) {
        super(formatWorkspaceAutomationBlockedMessage(source));
        this.source = source;
        this.name = "WorkspaceAutomationBlockedError";
    }
}
export function assertWorkspaceAutomationAllowed(source) {
    if (source)
        throw new WorkspaceAutomationBlockedError(source);
}
export async function assertWorkspaceAutomationAllowedForWorkspace(registry, workspaceId) {
    const workspace = await registry.get(workspaceId);
    if (!workspace)
        throw new Error(`Workspace not found: ${workspaceId}`);
    assertWorkspaceAutomationAllowed(workspace.untrustedSource);
}
export async function clearWorkspaceAutomationBlock(registry, workspaceId) {
    let cleared = false;
    const workspace = await registry.update(workspaceId, (record) => {
        if (!record.untrustedSource)
            return record;
        cleared = true;
        const { untrustedSource: _removed, ...trusted } = record;
        return { ...trusted, updatedAt: new Date().toISOString() };
    });
    if (!workspace)
        throw new Error(`Workspace not found: ${workspaceId}`);
    return cleared;
}
//# sourceMappingURL=workspace-automation-gate.js.map