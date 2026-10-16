export function createBranchChangeRouteHandler(options) {
    return (workspaceId, _oldBranch, newBranch) => {
        const changed = options.serviceProxy.replaceWorkspaceBranchRoutes({ workspaceId, newBranch });
        if (!changed) {
            return;
        }
        options.logger?.info({ workspaceId, newBranch }, "Updated service proxy routes for branch rename");
        options.onRoutesChanged(workspaceId);
    };
}
//# sourceMappingURL=script-route-branch-handler.js.map