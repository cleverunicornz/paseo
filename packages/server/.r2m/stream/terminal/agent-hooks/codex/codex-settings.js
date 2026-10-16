import { buildAgentHookShellCommand, buildAgentHookWindowsCommand, } from "../agent-hook-installer.js";
export const codexHooksFormat = {
    empty() {
        return {};
    },
    parse(raw) {
        const parsed = JSON.parse(raw);
        if (!isRecord(parsed)) {
            return {};
        }
        return parsed;
    },
    stringify(config) {
        return `${JSON.stringify(config, null, 2)}\n`;
    },
    install(config, provider) {
        const install = provider.install;
        const hooks = normalizeHooks(config.hooks);
        for (const event of provider.events) {
            const userEntries = removePaseoHooks(hooks[event.event], install.hookMarker);
            hooks[event.event] = [
                ...userEntries,
                {
                    matcher: "",
                    hooks: [
                        {
                            type: "command",
                            command: buildAgentHookShellCommand(provider, event),
                            commandWindows: buildAgentHookWindowsCommand(provider, event),
                            timeout: 10,
                        },
                    ],
                },
            ];
        }
        return { ...config, hooks };
    },
    uninstall(config, provider) {
        const install = provider.install;
        const hooks = normalizeHooks(config.hooks);
        for (const event of provider.events) {
            const entries = removePaseoHooks(hooks[event.event], install.hookMarker);
            if (entries.length > 0) {
                hooks[event.event] = entries;
            }
            else {
                delete hooks[event.event];
            }
        }
        return { ...config, hooks };
    },
    isInstalled(config, provider) {
        const install = provider.install;
        const hooks = normalizeHooks(config.hooks);
        return provider.events.every((event) => normalizeMatchers(hooks[event.event]).some((entry) => normalizeCommandHooks(entry.hooks).some((hook) => hasPaseoCommands(hook, install.hookMarker))));
    },
};
function normalizeHooks(value) {
    return isRecord(value) ? { ...value } : {};
}
function normalizeMatchers(value) {
    if (!Array.isArray(value)) {
        return [];
    }
    return value.filter(isRecord);
}
function normalizeCommandHooks(value) {
    if (!Array.isArray(value)) {
        return [];
    }
    return value.filter(isRecord);
}
function removePaseoHooks(value, marker) {
    const entries = [];
    for (const entry of normalizeMatchers(value)) {
        const hooks = normalizeCommandHooks(entry.hooks).filter((hook) => !commandContainsMarker(hook, marker));
        if (hooks.length > 0) {
            entries.push(Object.assign({}, entry, { hooks }));
        }
    }
    return entries;
}
function hasPaseoCommands(hook, marker) {
    return (commandFieldContainsMarker(hook.command, marker) && windowsCommandContainsMarker(hook, marker));
}
function commandContainsMarker(hook, marker) {
    return (commandFieldContainsMarker(hook.command, marker) || windowsCommandContainsMarker(hook, marker));
}
function windowsCommandContainsMarker(hook, marker) {
    return (commandFieldContainsMarker(hook.commandWindows, marker) ||
        commandFieldContainsMarker(hook.command_windows, marker));
}
function commandFieldContainsMarker(value, marker) {
    return typeof value === "string" && value.includes(marker);
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
//# sourceMappingURL=codex-settings.js.map