import type { ChildProcess, SpawnOptions } from "node:child_process";
import { type ProcessEnvRecord } from "../server/paseo-env.js";
interface ExternalEnvOptions {
    baseEnv?: ProcessEnvRecord;
    envMode?: "external" | "internal";
    env?: ProcessEnvRecord;
    envOverlay?: ProcessEnvRecord;
}
export type SpawnProcessOptions = Omit<SpawnOptions, "env"> & ExternalEnvOptions;
interface ExecCommandOptions extends ExternalEnvOptions {
    cwd?: string;
    encoding?: BufferEncoding;
    killSignal?: NodeJS.Signals;
    timeout?: number;
    maxBuffer?: number;
    shell?: boolean | string;
    signal?: AbortSignal;
}
interface ExecCommandResult {
    stdout: string;
    stderr: string;
}
export declare function spawnProcess(command: string, args: string[], options?: SpawnProcessOptions): ChildProcess;
export declare function execCommand(command: string, args: string[], options?: ExecCommandOptions): Promise<ExecCommandResult>;
export {};
//# sourceMappingURL=spawn.d.ts.map