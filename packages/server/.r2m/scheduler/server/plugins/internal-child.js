import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { createPluginWorker } from "./plugin-process.js";
export class InternalPluginChild extends EventEmitter {
    constructor(contribute) {
        super();
        this.connected = true;
        this.killed = false;
        this.stdout = new PassThrough();
        this.stderr = new PassThrough();
        this.workerMessages = new Set();
        this.closing = null;
        const channel = {
            send: (message, callback) => {
                const copy = structuredClone(message);
                queueMicrotask(() => {
                    if (this.connected)
                        this.emit("message", copy);
                    callback?.();
                });
            },
            onMessage: (handler) => {
                this.workerMessages.add(handler);
                return () => this.workerMessages.delete(handler);
            },
            disconnect: () => this.disconnect(),
        };
        this.worker = createPluginWorker({ channel, contribute });
    }
    send(message, callback) {
        if (!this.connected) {
            callback?.(new Error("Plugin child is disconnected"));
            return false;
        }
        const copy = structuredClone(message);
        queueMicrotask(() => {
            for (const handler of this.workerMessages)
                handler(copy);
            callback?.(null);
        });
        return true;
    }
    kill() {
        if (this.killed)
            return false;
        this.killed = true;
        this.disconnect();
        return true;
    }
    disconnect() {
        if (this.closing)
            return;
        this.closing = Promise.resolve()
            .then(() => this.worker.shutdown())
            .finally(() => {
            this.connected = false;
            this.stdout.end();
            this.stderr.end();
            this.emit("close", 0, null);
        });
    }
}
//# sourceMappingURL=internal-child.js.map