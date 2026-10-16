import { OMP_MODES } from "@getpaseo/protocol/provider-manifest";
import { z } from "zod";
import type { ProviderRuntimeSettings } from "../../provider-launch-config.js";
export declare const MIN_SUPPORTED_OMP_VERSION = "16.3.9";
export { OMP_MODES };
export declare const OmpProviderOptionsSchema: z.ZodObject<{
    sessionDir: z.ZodOptional<z.ZodString>;
    rpcTimeoutMs: z.ZodOptional<z.ZodNumber>;
    smolModel: z.ZodOptional<z.ZodString>;
    slowModel: z.ZodOptional<z.ZodString>;
    planModel: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
export interface OmpRuntimeOptions {
    sessionDir?: string;
    readyTimeoutMs: number;
    rpcTimeoutMs: number;
}
export interface OmpModelRoles {
    smolModel?: string;
    slowModel?: string;
    planModel?: string;
}
export declare function resolveOmpLaunchMode(modeId: string | undefined, modelRoles?: OmpModelRoles): {
    modeId: string;
    extraArgs: string[];
};
export interface OmpDiagnosticPaths {
    profile: string;
    configRoot: string;
    agentDir: string;
    agentDb: string;
    xdgDataRoot: string;
    xdgStateRoot: string;
    xdgCacheRoot: string;
}
export declare function resolveOmpDiagnosticPaths(env?: NodeJS.ProcessEnv, home?: string, platform?: NodeJS.Platform): OmpDiagnosticPaths;
export declare function formatOmpVersionSupport(versionOutput: string): string;
export declare function resolveOmpProviderOptions(providerOptions: unknown): {
    runtimeOptions: OmpRuntimeOptions;
    modelRoles: OmpModelRoles;
};
export declare function mergeOmpRuntimeSettings(base: ProviderRuntimeSettings | undefined, override: ProviderRuntimeSettings | undefined): ProviderRuntimeSettings | undefined;
//# sourceMappingURL=provider-config.d.ts.map