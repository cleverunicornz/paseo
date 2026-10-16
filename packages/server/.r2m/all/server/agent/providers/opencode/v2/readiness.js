import { setTimeout as delay } from "node:timers/promises";
import { raceProviderRefreshAbort } from "../../../provider-refresh-deadline.js";
export class OpenCodeLocationReadyTimeoutError extends Error {
    constructor(directory, waitedMs) {
        super(`OpenCode location ${directory} did not activate within ${waitedMs}ms`);
        this.directory = directory;
        this.waitedMs = waitedMs;
        this.name = "OpenCodeLocationReadyTimeoutError";
    }
}
export function waitForLocationReady(input) {
    return waitForPlugins({ ...input, requireBridge: false });
}
export function awaitPaseoPlugin(input) {
    return waitForPlugins({ ...input, requireBridge: true });
}
async function waitForPlugins(input) {
    const { client, location, signal, requireBridge, timeoutMs = 30000 } = input;
    signal?.throwIfAborted();
    const deadline = AbortSignal.timeout(timeoutMs);
    const lifetime = signal ? AbortSignal.any([signal, deadline]) : deadline;
    try {
        while (true) {
            const requestTimeout = AbortSignal.timeout(5000);
            const requestSignal = AbortSignal.any([lifetime, requestTimeout]);
            try {
                const plugins = await raceProviderRefreshAbort(requestSignal, client.plugin.list({ location }, { signal: requestSignal }));
                if (!requireBridge && plugins.data.length > 0)
                    return;
                const bridge = plugins.data.find((plugin) => plugin.id === "paseo");
                if (requireBridge && bridge?.state.status === "active")
                    return;
                if (requireBridge && bridge?.state.status === "failed")
                    throw new Error(`OpenCode Paseo tool bridge plugin failed: ${bridge.state.error}`);
            }
            catch (error) {
                lifetime.throwIfAborted();
                if (!requestTimeout.aborted)
                    throw error;
            }
            await delay(50, undefined, { signal: lifetime });
        }
    }
    catch (error) {
        signal?.throwIfAborted();
        if (deadline.aborted)
            throw new OpenCodeLocationReadyTimeoutError(location.directory, timeoutMs);
        throw error;
    }
}
//# sourceMappingURL=readiness.js.map