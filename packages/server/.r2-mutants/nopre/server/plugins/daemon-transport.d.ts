import type { DaemonTransportFactory } from "@getpaseo/client/internal/daemon-client-transport-types";
import type { PluginProcessMessage, PluginProcessRequest } from "./plugin-process-protocol.js";
interface PluginProcessPort {
    send(message: PluginProcessMessage): void;
    onMessage(handler: (message: PluginProcessRequest) => void): () => void;
}
export declare function createPluginDaemonTransportFactory(port: PluginProcessPort): DaemonTransportFactory;
export {};
//# sourceMappingURL=daemon-transport.d.ts.map