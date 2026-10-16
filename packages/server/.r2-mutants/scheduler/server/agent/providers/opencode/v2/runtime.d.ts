import type { V2Api } from "./api.js";
import type { Logger } from "pino";
import { type ProviderRuntimeSettings } from "../../../provider-launch-config.js";
import type { ManagedProcessRegistry } from "../../../../managed-processes/managed-processes.js";
export interface V2Connection {
    client: V2Api;
    release(): Promise<void>;
    retain(): V2Connection;
    readonly exited: Promise<Error>;
}
export interface V2RuntimeOptions {
    logger: Logger;
    settings?: ProviderRuntimeSettings;
    managedProcesses?: ManagedProcessRegistry;
    decorateEnv?: (env: Record<string, string>) => Promise<Record<string, string>>;
}
export interface V2RuntimeAcquireOptions {
    fresh?: boolean;
    dedicated?: boolean;
    env?: Record<string, string>;
    signal?: AbortSignal;
}
export declare class V2Runtime {
    private readonly options;
    private current;
    private generations;
    private starts;
    private closed;
    constructor(options: V2RuntimeOptions);
    acquire(input?: V2RuntimeAcquireOptions): Promise<V2Connection>;
    private lease;
    shutdown(): Promise<void>;
    private startTracked;
    private start;
}
//# sourceMappingURL=runtime.d.ts.map