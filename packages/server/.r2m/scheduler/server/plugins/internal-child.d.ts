import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { PluginServerContribution } from "@getpaseo/plugin/server";
import type { PluginProcessRequest } from "./plugin-process-protocol.js";
export declare class InternalPluginChild extends EventEmitter {
    connected: boolean;
    killed: boolean;
    readonly stdout: PassThrough;
    readonly stderr: PassThrough;
    private readonly worker;
    private readonly workerMessages;
    private closing;
    constructor(contribute: PluginServerContribution);
    send(message: PluginProcessRequest, callback?: (error: Error | null) => void): boolean;
    kill(): boolean;
    disconnect(): void;
}
//# sourceMappingURL=internal-child.d.ts.map