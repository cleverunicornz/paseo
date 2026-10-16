import type { TerminalManager } from "./terminal-manager.js";
export interface ConfiguredTerminalManagerOptions {
    getTerminalActivityUrl?: () => string | null;
}
export declare function createConfiguredTerminalManager(options?: ConfiguredTerminalManagerOptions): TerminalManager;
//# sourceMappingURL=terminal-manager-factory.d.ts.map