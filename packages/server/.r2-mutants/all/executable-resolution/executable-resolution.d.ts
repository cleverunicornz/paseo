import { existsSync } from "node:fs";
import type { ProcessEnvRecord } from "../server/paseo-env.js";
export declare function probeExecutable(executablePath: string, options?: number | ExecutableResolutionOptions): Promise<boolean>;
/**
 * Check a literal executable path. PATH search is handled by findExecutable().
 */
export declare function executableExists(executablePath: string, exists?: typeof existsSync): string | null;
export interface ExecutableResolutionOptions {
    probeTimeoutMs?: number;
    env?: ProcessEnvRecord;
}
export declare function findExecutable(name: string, options?: number | ExecutableResolutionOptions): Promise<string | null>;
export declare function isCommandAvailable(command: string): Promise<boolean>;
//# sourceMappingURL=executable-resolution.d.ts.map