import type { ChildProcessWithoutNullStreams } from "node:child_process";
import type { Logger } from "pino";
import type { ProviderRuntimeSettings } from "../../provider-launch-config.js";
import { type PiRuntime, type PiRuntimeLaunch, type PiRuntimeSession, type PiStartSessionInput } from "./runtime.js";
export interface PiCliRuntimeOptions {
    logger: Logger;
    runtimeSettings?: ProviderRuntimeSettings;
    command?: [string, ...string[]];
    commandsRpcName?: string;
    requestTimeoutMs?: number;
    spawnProcess?: (launch: PiRuntimeLaunch) => ChildProcessWithoutNullStreams;
}
export declare class PiCliRuntime implements PiRuntime {
    private readonly options;
    private readonly command;
    private readonly commandsRpcName;
    private readonly spawnProcess?;
    constructor(options: PiCliRuntimeOptions);
    startSession(input: PiStartSessionInput): Promise<PiRuntimeSession>;
}
//# sourceMappingURL=cli-runtime.d.ts.map