import type { ImportableProviderSession, ListImportableSessionsOptions } from "../../agent-sdk-types.js";
import type { ProviderRuntimeSettings } from "../../provider-launch-config.js";
export interface OmpSessionDescriptorOptions extends ListImportableSessionsOptions {
    sessionDir?: string;
    runtimeSettings?: ProviderRuntimeSettings;
    env?: NodeJS.ProcessEnv;
    homeDir?: string;
}
export interface OmpImportSessionConfig {
    model?: string;
    thinkingOptionId?: string;
}
export declare function listOmpImportableSessions(options?: OmpSessionDescriptorOptions): Promise<ImportableProviderSession[]>;
/**
 * Reads the model/thinking config of an OMP session for import.
 *
 * `handle` is either an absolute path to the session `.jsonl` (what the
 * importable-sessions list hands back) or a bare OMP session id (what
 * `paseo import <id>` supplies). Ids are resolved against the configured
 * sessions directory; an unresolvable handle yields `{}`.
 */
export declare function readOmpImportSessionConfig(handle: string, options?: OmpSessionDescriptorOptions): Promise<OmpImportSessionConfig>;
/**
 * Resolves an import handle to a session file path. Returns the handle itself
 * when it already names a readable file; otherwise searches the sessions
 * directory for a file whose header `id` matches.
 */
export declare function resolveOmpSessionFile(handle: string, options?: OmpSessionDescriptorOptions): Promise<string | null>;
//# sourceMappingURL=session-descriptor.d.ts.map