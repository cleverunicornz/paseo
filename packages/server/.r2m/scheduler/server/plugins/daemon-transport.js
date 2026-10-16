function normalizeFrame(data) {
    if (typeof data === "string")
        return data;
    if (data instanceof Uint8Array) {
        return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    }
    return new Uint8Array(data);
}
export function createPluginDaemonTransportFactory(port) {
    return () => {
        const messageHandlers = new Set();
        const openHandlers = new Set();
        const closeHandlers = new Set();
        let isOpen = true;
        const unsubscribe = port.onMessage((message) => {
            if (message.type === "paseo_frame") {
                for (const handler of messageHandlers)
                    handler(message.data, message.isBinary);
            }
            if (message.type === "paseo_close")
                closeTransport();
        });
        function closeTransport() {
            if (!isOpen)
                return;
            isOpen = false;
            unsubscribe();
            for (const handler of closeHandlers)
                handler();
        }
        queueMicrotask(() => {
            if (!isOpen)
                return;
            for (const handler of openHandlers)
                handler();
        });
        return {
            send(data) {
                if (!isOpen)
                    throw new Error("Plugin daemon transport is closed");
                const frame = normalizeFrame(data);
                port.send({ type: "paseo_frame", data: frame, isBinary: typeof frame !== "string" });
            },
            close() {
                if (!isOpen)
                    return;
                port.send({ type: "paseo_close" });
                closeTransport();
            },
            onMessage(handler) {
                messageHandlers.add(handler);
                return () => messageHandlers.delete(handler);
            },
            onOpen(handler) {
                openHandlers.add(handler);
                return () => openHandlers.delete(handler);
            },
            onClose(handler) {
                closeHandlers.add(handler);
                return () => closeHandlers.delete(handler);
            },
            onError() {
                return () => undefined;
            },
        };
    };
}
//# sourceMappingURL=daemon-transport.js.map