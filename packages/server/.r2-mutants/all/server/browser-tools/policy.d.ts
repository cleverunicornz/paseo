import type { DaemonConfigStore } from "../daemon-config-store.js";
export interface BrowserToolsPolicy {
    isEnabled(): boolean;
}
export declare class DaemonConfigBrowserToolsPolicy implements BrowserToolsPolicy {
    private readonly configStore;
    constructor(configStore: Pick<DaemonConfigStore, "get">);
    isEnabled(): boolean;
}
//# sourceMappingURL=policy.d.ts.map