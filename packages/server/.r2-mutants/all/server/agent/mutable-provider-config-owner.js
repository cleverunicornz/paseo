import equal from "fast-deep-equal";
export function attachMutableProviderConfigOwner(options) {
    let commitPendingProviderChange = null;
    const unsubscribeApply = options.store.onApply((config, previous, details) => {
        if (equal(config.providers, previous.providers))
            return () => undefined;
        const previousAgentManagerState = options.providerSnapshotManager.getAgentManagerProviderState();
        const prepared = options.providerSnapshotManager.prepareMutableProviderConfig(config.providers, {
            removeProviders: details.removedProviders,
            replace: true,
        });
        try {
            options.updateProviderRegistry(prepared.agentManagerState);
        }
        catch (error) {
            options.updateProviderRegistry(previousAgentManagerState);
            throw error;
        }
        commitPendingProviderChange = prepared.commit;
        return () => {
            commitPendingProviderChange = null;
            options.updateProviderRegistry(previousAgentManagerState);
        };
    });
    const unsubscribeChange = options.store.onChange(() => {
        const commit = commitPendingProviderChange;
        commitPendingProviderChange = null;
        commit?.();
    });
    return () => {
        unsubscribeApply();
        unsubscribeChange();
    };
}
//# sourceMappingURL=mutable-provider-config-owner.js.map