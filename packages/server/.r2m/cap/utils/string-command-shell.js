export function createStringCommandShellEnv(env) {
    const sanitized = { ...env };
    delete sanitized.BASH_ENV;
    return sanitized;
}
export function createStringCommandShellEnvOverlay() {
    return { BASH_ENV: undefined };
}
export function buildStringCommandShellInvocation(options) {
    const platform = options.platform ?? process.platform;
    // Project-authored command strings use a stable script shell. The caller supplies
    // the environment; shell startup files should not rewrite it behind our back.
    if (platform === "win32") {
        if (options.windowsShell === "cmd") {
            return {
                shell: "cmd.exe",
                args: ["/c", options.command],
            };
        }
        return {
            shell: "powershell",
            args: [
                "-NoProfile",
                "-NonInteractive",
                "-ExecutionPolicy",
                "Bypass",
                "-Command",
                options.command,
            ],
        };
    }
    return {
        shell: "bash",
        args: ["-c", options.command],
    };
}
//# sourceMappingURL=string-command-shell.js.map