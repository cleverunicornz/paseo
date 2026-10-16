import { startRelayTransport, } from "./relay-transport.js";
export function createRelayRuntime(options) {
    const startTransport = options.startTransport ?? startRelayTransport;
    let config = options.config;
    let transport = null;
    function start() {
        if (transport)
            return;
        transport = startTransport({
            logger: options.logger,
            attachSocket: options.attachSocket,
            relayEndpoint: config.endpoint,
            relayUseTls: config.useTls,
            serverId: options.serverId,
            daemonKeyPair: options.daemonKeyPair,
        });
    }
    function setEnabled(enabled) {
        if (config.enabled === enabled)
            return;
        if (enabled) {
            start();
            config = { ...config, enabled: true };
            return;
        }
        config = { ...config, enabled: false };
        const current = transport;
        transport = null;
        void current?.stop().catch((error) => {
            options.logger.warn({ err: error }, "Failed to stop relay transport");
        });
    }
    async function stop() {
        const current = transport;
        transport = null;
        await current?.stop();
    }
    if (config.enabled)
        start();
    return {
        getConfig: () => config,
        setEnabled,
        stop,
    };
}
//# sourceMappingURL=relay-runtime.js.map