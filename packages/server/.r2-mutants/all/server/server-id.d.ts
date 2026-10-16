interface LoggerLike {
    child(bindings: Record<string, unknown>): LoggerLike;
    info(...args: unknown[]): void;
    warn(...args: unknown[]): void;
}
/**
 * Stable daemon identifier scoped to a given $PASEO_HOME.
 *
 * - Persisted to `$PASEO_HOME/server-id`
 * - Can be overridden via `PASEO_SERVER_ID` (useful for tests)
 */
export declare function getOrCreateServerId(paseoHome: string, options?: {
    env?: NodeJS.ProcessEnv;
    logger?: LoggerLike;
}): string;
export {};
//# sourceMappingURL=server-id.d.ts.map