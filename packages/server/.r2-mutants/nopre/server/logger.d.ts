import pino from "pino";
import type { PersistedConfig } from "./persisted-config.js";
export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";
export type LogFormat = "pretty" | "json";
export interface ResolvedLogConfig {
    level: LogLevel;
    console: {
        level: LogLevel;
        format: LogFormat;
    };
    file?: {
        level: LogLevel;
        path: string;
    };
}
interface LegacyLogConfig {
    level?: LogLevel;
    format?: LogFormat;
}
type LoggerConfigInput = PersistedConfig | LegacyLogConfig | undefined;
interface ResolveLogConfigOptions {
    paseoHome?: string;
    file?: boolean;
}
export declare function resolveLogConfig(configInput: LoggerConfigInput, options?: ResolveLogConfigOptions): ResolvedLogConfig;
export declare function createRootLogger(configInput: LoggerConfigInput, options?: ResolveLogConfigOptions): pino.Logger;
export declare function createChildLogger(parent: pino.Logger, name: string): pino.Logger;
export {};
//# sourceMappingURL=logger.d.ts.map