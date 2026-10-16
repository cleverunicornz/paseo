import { installRegisteredAgentHooks, uninstallRegisteredAgentHooks, } from "./provider-registry.js";
// Installing agent hooks edits the user's real agent config files, so it only
// happens when `enableTerminalAgentHooks` is on. At boot we install when enabled
// and otherwise leave the configs untouched; toggling the setting live installs
// on enable and removes our marker-matched hooks on disable so opting out cleans
// up after itself. Returns an unsubscribe for the field-change listener.
export function applyTerminalAgentHookSetting(options) {
    const { store, logger, install } = options;
    const installOptions = { ...install, logger };
    if (store.get().enableTerminalAgentHooks) {
        installRegisteredAgentHooks(installOptions);
    }
    return store.onFieldChange("enableTerminalAgentHooks", (value) => {
        if (value === true) {
            installRegisteredAgentHooks(installOptions);
            return;
        }
        try {
            uninstallRegisteredAgentHooks(install);
        }
        catch (error) {
            logger?.warn({ err: error }, "Failed to remove terminal activity hooks");
        }
    });
}
//# sourceMappingURL=terminal-agent-hook-setting.js.map