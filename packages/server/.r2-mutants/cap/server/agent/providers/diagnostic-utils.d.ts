import { type ProviderLaunchAvailability, type ProviderRuntimeSettings, type ResolvedProviderLaunch } from "../provider-launch-config.js";
export interface DiagnosticEntry {
    label: string;
    value: string;
}
export declare function formatProviderDiagnostic(providerName: string, entries: DiagnosticEntry[]): string;
export declare function formatProviderDiagnosticError(providerName: string, error: unknown): string;
export declare function formatAvailabilityStatus(available: boolean): string;
export declare function formatDiagnosticStatus(available: boolean, error?: {
    source: string;
    cause: unknown;
}): string;
export declare function truncateForDiagnostic(value: string): string;
export declare function toDiagnosticErrorMessage(error: unknown): string;
export declare function resolveBinaryVersion(binaryPath: string, signal?: AbortSignal): Promise<string>;
export interface BinaryDiagnosticVersionCommand {
    command: string;
    args: string[];
    env?: Record<string, string>;
}
export interface BinaryDiagnosticRowsOptions {
    binaryLabel?: string;
    versionCommand?: BinaryDiagnosticVersionCommand;
}
export interface CommandResolutionDiagnosticRowsOptions {
    knownBinaryNames: readonly string[];
    includeCommandProbes?: boolean;
    pathValue?: string;
    pathext?: string;
    platform?: NodeJS.Platform;
    shell?: string;
}
export declare function buildCommandResolutionDiagnosticRows(launch: ResolvedProviderLaunch, options: CommandResolutionDiagnosticRowsOptions): Promise<DiagnosticEntry[]>;
export declare function buildBinaryDiagnosticRows(launch: ResolvedProviderLaunch, availability: ProviderLaunchAvailability, options?: BinaryDiagnosticRowsOptions): Promise<DiagnosticEntry[]>;
export declare function formatConfiguredCommand(defaultArgv: readonly string[], runtimeSettings?: ProviderRuntimeSettings): string;
//# sourceMappingURL=diagnostic-utils.d.ts.map