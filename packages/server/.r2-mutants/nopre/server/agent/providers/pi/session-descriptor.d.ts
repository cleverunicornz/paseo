import type { ImportableProviderSession, ListImportableSessionsOptions } from "../../agent-sdk-types.js";
import type { ProviderRuntimeSettings } from "../../provider-launch-config.js";
interface PiSessionDescriptorOptions extends ListImportableSessionsOptions {
    sessionDir?: string;
    runtimeSettings?: ProviderRuntimeSettings;
    env?: NodeJS.ProcessEnv;
    homeDir?: string;
}
export interface PiImportSessionConfig {
    model?: string;
    thinkingOptionId?: string;
}
export declare function listPiImportableSessions(options?: PiSessionDescriptorOptions): Promise<ImportableProviderSession[]>;
export declare function readPiImportSessionConfig(filePath: string): Promise<PiImportSessionConfig>;
export {};
//# sourceMappingURL=session-descriptor.d.ts.map