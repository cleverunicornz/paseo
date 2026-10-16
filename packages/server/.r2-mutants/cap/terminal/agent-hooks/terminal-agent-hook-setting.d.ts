import type { AgentHookInstallLogger, AgentHookInstallOptions } from "./agent-hook-installer.js";
import type { DaemonConfigStore } from "../../server/daemon-config-store.js";
interface ApplyTerminalAgentHookSettingOptions {
    store: DaemonConfigStore;
    logger?: AgentHookInstallLogger;
    install?: AgentHookInstallOptions;
}
export declare function applyTerminalAgentHookSetting(options: ApplyTerminalAgentHookSettingOptions): () => void;
export {};
//# sourceMappingURL=terminal-agent-hook-setting.d.ts.map