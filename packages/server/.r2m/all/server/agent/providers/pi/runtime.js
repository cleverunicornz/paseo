export function buildPiLaunch(input) {
    const command = input.runtimeSettings?.command?.mode === "replace" && input.runtimeSettings.command.argv[0]
        ? input.runtimeSettings.command.argv
        : input.command;
    const argv = [...command];
    const protocolMode = input.session.protocolMode ?? "rpc";
    appendPiLaunchArgs(argv, input.session, protocolMode);
    return {
        cwd: input.session.cwd,
        argv,
        env: input.runtimeSettings?.env || input.session.env
            ? {
                ...input.runtimeSettings?.env,
                ...input.session.env,
            }
            : undefined,
        model: input.session.model,
        thinkingOptionId: input.session.thinkingOptionId,
        protocolMode,
        modeId: input.session.modeId,
        session: input.session.session,
        noSession: input.session.noSession,
        mcpConfigPath: input.session.mcpConfigPath,
        extensionPaths: input.session.extensionPaths,
        extraArgs: input.session.extraArgs,
    };
}
function appendPiLaunchArgs(argv, session, protocolMode) {
    if (!hasModeFlag(argv)) {
        argv.push("--mode", protocolMode);
    }
    if (session.extraArgs?.length) {
        argv.push(...session.extraArgs);
    }
    if (session.model) {
        argv.push("--model", session.model);
    }
    if (session.thinkingOptionId) {
        argv.push("--thinking", session.thinkingOptionId);
    }
    if (session.noSession) {
        argv.push("--no-session");
    }
    else if (session.session) {
        argv.push("--session", session.session);
    }
    if (session.mcpConfigPath) {
        argv.push("--mcp-config", session.mcpConfigPath);
    }
    for (const extensionPath of session.extensionPaths ?? []) {
        argv.push("--extension", extensionPath);
    }
}
function hasModeFlag(argv) {
    for (let i = 0; i < argv.length; i += 1) {
        if (argv[i] === "--mode") {
            return true;
        }
        if (argv[i]?.startsWith("--mode=")) {
            return true;
        }
    }
    return false;
}
//# sourceMappingURL=runtime.js.map