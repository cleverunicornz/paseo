export class DaemonConfigBrowserToolsPolicy {
    constructor(configStore) {
        this.configStore = configStore;
    }
    isEnabled() {
        return readBrowserToolsEnabled(this.configStore.get());
    }
}
function readBrowserToolsEnabled(config) {
    const browserTools = config.browserTools;
    if (typeof browserTools !== "object" || browserTools === null || Array.isArray(browserTools)) {
        return false;
    }
    return browserTools.enabled === true;
}
//# sourceMappingURL=policy.js.map