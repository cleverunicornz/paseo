import { createOpenCodePluginInstallStrategy } from "./opencode-plugin.js";
const OPENCODE_EVENT_STATES = {
    "session.status.busy": "running",
    "session.status.retry": "running",
    "session.status.idle": "idle",
    "permission.asked": "needs-input",
    "permission.replied": "running",
};
export const opencodeAgentHookProvider = {
    id: "opencode",
    events: [
        { event: "session.status.busy" },
        { event: "session.status.retry" },
        { event: "session.status.idle" },
        { event: "permission.asked" },
        { event: "permission.replied" },
    ],
    install: createOpenCodePluginInstallStrategy(),
    async resolveActivity({ event }) {
        return OPENCODE_EVENT_STATES[event] ?? null;
    },
};
//# sourceMappingURL=opencode.js.map