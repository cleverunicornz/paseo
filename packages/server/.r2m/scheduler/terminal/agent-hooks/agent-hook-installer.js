import { existsSync, readFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { writePrivateFileAtomicSync } from "../../server/private-files.js";
export function installAgentHooks(provider, options = {}) {
    if (provider.install.kind === "plugin-file") {
        return installAgentHookPluginFile(provider.install, options);
    }
    const format = provider.install.format;
    return updateAgentHookConfig(provider, options, (config) => format.install(config, provider));
}
export function uninstallAgentHooks(provider, options = {}) {
    if (provider.install.kind === "plugin-file") {
        return uninstallAgentHookPluginFile(provider.install, options);
    }
    const format = provider.install.format;
    return updateAgentHookConfig(provider, options, (config) => format.uninstall(config, provider));
}
export function agentHooksAreInstalled(provider, options = {}) {
    const configPath = resolveAgentHookConfigPath(provider, options);
    if (!existsSync(configPath)) {
        return false;
    }
    if (provider.install.kind === "plugin-file") {
        const currentRaw = readFileSync(configPath, "utf8");
        return normalizeRawConfig(currentRaw) === normalizeRawConfig(provider.install.source);
    }
    const config = provider.install.format.parse(readFileSync(configPath, "utf8"));
    return provider.install.format.isInstalled(config, provider);
}
export function resolveAgentHookConfigPath(provider, options = {}) {
    return resolveAgentHookInstallPath(provider.install, options);
}
function resolveAgentHookInstallPath(install, options) {
    const configDir = options.configDir ??
        resolveConfiguredDirectory({
            install,
            env: options.env ?? process.env,
            homeDir: options.homeDir ?? homedir(),
        });
    return path.join(configDir, install.configFile);
}
export function buildAgentHookShellCommand(provider, event) {
    const hookCommand = `"\${PASEO_HOOK_CLI:-paseo}" hooks ${shellToken(provider.id)} ${shellToken(event.event)}`;
    return `if [ -n "$PASEO_TERMINAL_ID" ]; then ${hookCommand}; fi`;
}
export function buildAgentHookWindowsCommand(provider, event) {
    const hookArgs = `hooks ${windowsToken(provider.id)} ${windowsToken(event.event)}`;
    return `if defined PASEO_TERMINAL_ID (if defined PASEO_HOOK_CLI ("%PASEO_HOOK_CLI%" ${hookArgs}) else (paseo ${hookArgs})) else (exit /b 0)`;
}
function installAgentHookPluginFile(install, options) {
    const configPath = resolveAgentHookInstallPath(install, options);
    const currentRaw = existsSync(configPath) ? readFileSync(configPath, "utf8") : null;
    const nextRaw = normalizeRawConfig(install.source);
    if (currentRaw === null || normalizeRawConfig(currentRaw) !== nextRaw) {
        writePrivateFileAtomicSync(configPath, nextRaw);
        return { configPath, changed: true };
    }
    return { configPath, changed: false };
}
function uninstallAgentHookPluginFile(install, options) {
    const configPath = resolveAgentHookInstallPath(install, options);
    if (!existsSync(configPath)) {
        return { configPath, changed: false };
    }
    rmSync(configPath, { force: true });
    return { configPath, changed: true };
}
function updateAgentHookConfig(provider, options, update) {
    const install = provider.install;
    if (install.kind !== "config-file") {
        throw new Error(`Provider ${provider.id} does not use config-file hooks`);
    }
    const configPath = resolveAgentHookConfigPath(provider, options);
    const currentRaw = existsSync(configPath) ? readFileSync(configPath, "utf8") : null;
    const currentConfig = currentRaw === null ? install.format.empty() : install.format.parse(currentRaw);
    const nextConfig = update(currentConfig);
    const nextRaw = install.format.stringify(nextConfig);
    if (currentRaw === null || nextRaw !== normalizeRawConfig(currentRaw)) {
        writePrivateFileAtomicSync(configPath, nextRaw);
        return { configPath, changed: true };
    }
    return { configPath, changed: false };
}
function resolveConfiguredDirectory(input) {
    const overrideName = input.install.configDirEnvOverride;
    const override = overrideName ? input.env[overrideName] : undefined;
    if (override) {
        return override;
    }
    if (input.install.configDirBase === "xdg-config") {
        return path.join(resolveXdgConfigHome(input), input.install.configDir);
    }
    return path.join(input.homeDir, input.install.configDir);
}
function resolveXdgConfigHome(input) {
    if (input.env.XDG_CONFIG_HOME) {
        return input.env.XDG_CONFIG_HOME;
    }
    return path.join(input.homeDir, ".config");
}
function normalizeRawConfig(raw) {
    return raw.endsWith("\n") ? raw : `${raw}\n`;
}
function shellToken(value) {
    if (/^[A-Za-z0-9_./:-]+$/.test(value)) {
        return value;
    }
    return `'${value.replaceAll("'", "'\\''")}'`;
}
function windowsToken(value) {
    if (/^[A-Za-z0-9_./:-]+$/.test(value)) {
        return value;
    }
    return `"${value.replaceAll('"', '\\"')}"`;
}
//# sourceMappingURL=agent-hook-installer.js.map