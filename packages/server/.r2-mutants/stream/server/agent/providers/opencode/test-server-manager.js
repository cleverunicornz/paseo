const events = {
    ready: async () => undefined,
    subscribe: () => () => undefined,
};
export class TestOpenCodeServerManager {
    constructor() {
        this.acquisitions = [];
        this.server = { port: 1234, url: "http://127.0.0.1:1234" };
    }
    async acquireCurrent() {
        return this.recordAcquisition({ kind: "current" });
    }
    async acquireNew() {
        return this.recordAcquisition({ kind: "new" });
    }
    async acquireDedicated(env) {
        return this.recordAcquisition({ kind: "dedicated", env });
    }
    acquireExisting(url) {
        return url === this.server.url ? this.recordAcquisition({ kind: "existing", url }) : null;
    }
    recordAcquisition(input) {
        const acquisition = {
            kind: input.kind,
            released: false,
            ...(input.env ? { env: input.env } : {}),
            ...(input.url ? { url: input.url } : {}),
        };
        this.acquisitions.push(acquisition);
        return {
            server: this.server,
            environment: input.env ?? {},
            events,
            release: async () => {
                acquisition.released = true;
            },
        };
    }
    async shutdown() { }
}
export function createTestOpenCodeServerManager() {
    return new TestOpenCodeServerManager();
}
//# sourceMappingURL=test-server-manager.js.map