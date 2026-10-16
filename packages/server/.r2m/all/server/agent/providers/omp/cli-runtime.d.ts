import type { ChildProcessWithoutNullStreams } from "node:child_process";
import type { Logger } from "pino";
import type { ProviderRuntimeSettings } from "../../provider-launch-config.js";
import { type OmpRuntime, type OmpRuntimeLaunch, type OmpRuntimeSession, type OmpStartSessionInput } from "./runtime.js";
export interface OmpCliRuntimeOptions {
    logger: Logger;
    runtimeSettings?: ProviderRuntimeSettings;
    command?: [string, ...string[]];
    commandsRpcName?: "get_available_commands";
    readyTimeoutMs?: number;
    requestTimeoutMs?: number;
    spawnProcess?: (launch: OmpRuntimeLaunch) => ChildProcessWithoutNullStreams;
}
export declare class OmpCliRuntime implements OmpRuntime {
    private readonly options;
    private readonly command;
    private readonly commandsRpcName;
    private readonly spawnProcess?;
    constructor(options: OmpCliRuntimeOptions);
    startSession(input: OmpStartSessionInput): Promise<OmpRuntimeSession>;
}
//# sourceMappingURL=cli-runtime.d.ts.map