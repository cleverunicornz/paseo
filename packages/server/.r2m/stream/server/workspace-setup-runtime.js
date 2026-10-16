export class WorkspaceSetupRuntime {
    constructor() {
        this.runs = new Map();
    }
    start(workspaceId, operation) {
        const controller = new AbortController();
        const run = {
            controller,
            completion: Promise.resolve(),
        };
        this.runs.set(workspaceId, run);
        run.completion = Promise.resolve()
            .then(() => operation(controller.signal))
            .catch(() => undefined)
            .finally(() => {
            if (this.runs.get(workspaceId) === run) {
                this.runs.delete(workspaceId);
            }
        });
    }
    async stop(workspaceId) {
        const run = this.runs.get(workspaceId);
        if (!run) {
            return;
        }
        run.controller.abort();
        await run.completion;
    }
}
//# sourceMappingURL=workspace-setup-runtime.js.map