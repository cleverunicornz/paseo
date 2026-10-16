import { JSONL_RPC_DEFAULT_TIMEOUT_MS, supportsJsonlRpcProtocolV2, } from "../jsonl-rpc-process.js";
const OMP_READY_TIMEOUT_MS = 20000;
export async function establishOmpProtocol(transport, logger, timeouts = {}) {
    const readyTimeoutMs = timeouts.readyTimeoutMs ?? OMP_READY_TIMEOUT_MS;
    const requestTimeoutMs = timeouts.requestTimeoutMs ?? JSONL_RPC_DEFAULT_TIMEOUT_MS;
    const ready = await waitForReady(transport, readyTimeoutMs);
    if (!supportsJsonlRpcProtocolV2(ready))
        return;
    const response = (await transport.request({ type: "negotiate_protocol", protocolVersion: 2 }, requestTimeoutMs));
    if (response?.protocolVersion !== 2)
        throw new Error("OMP did not accept RPC protocol v2");
    logger.debug({}, "Negotiated OMP RPC protocol v2 (chunked frame transport)");
}
function waitForReady(transport, requestTimeoutMs) {
    return new Promise((resolve, reject) => {
        let settled = false;
        let unsubscribeMessage = () => { };
        let unsubscribeExit = () => { };
        const timer = setTimeout(() => finish(new Error("Timed out waiting for OMP to become ready")), requestTimeoutMs);
        const finish = (result) => {
            if (settled)
                return;
            settled = true;
            clearTimeout(timer);
            unsubscribeMessage();
            unsubscribeExit();
            if (result instanceof Error)
                reject(result);
            else
                resolve(result);
        };
        unsubscribeMessage = transport.onMessage((message) => {
            if (message.type === "ready")
                finish(message);
        });
        unsubscribeExit = transport.onExit(({ error }) => finish(error));
    });
}
//# sourceMappingURL=protocol-session.js.map