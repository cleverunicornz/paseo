import { codexHooksFormat } from "./codex-settings.js";
const CODEX_EVENT_STATES = {
    UserPromptSubmit: "running",
    PreToolUse: "running",
    PostToolUse: "running",
    PermissionRequest: "needs-input",
    Stop: "idle",
};
export const codexAgentHookProvider = {
    id: "codex",
    events: [
        { event: "UserPromptSubmit" },
        { event: "PreToolUse" },
        { event: "PostToolUse" },
        { event: "PermissionRequest" },
        { event: "Stop" },
    ],
    install: {
        kind: "config-file",
        configDir: ".codex",
        configFile: "hooks.json",
        configDirEnvOverride: "CODEX_HOME",
        hookMarker: "hooks codex",
        format: codexHooksFormat,
    },
    async resolveActivity({ event }) {
        return CODEX_EVENT_STATES[event] ?? null;
    },
};
//# sourceMappingURL=codex.js.map