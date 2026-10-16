import { type PluginProcessMessage, type PluginProcessRequest } from "./plugin-process-protocol.js";
import type { PluginServerContribution } from "@getpaseo/plugin/server";
export interface PluginWorkerChannel {
    send(message: PluginProcessMessage, callback?: () => void): void;
    onMessage(handler: (message: PluginProcessRequest) => void): () => void;
    disconnect(): void;
}
export declare function createPluginWorker(options: {
    channel: PluginWorkerChannel;
    contribute: PluginServerContribution;
}): {
    shutdown(): Promise<void>;
};
//# sourceMappingURL=plugin-process.d.ts.map