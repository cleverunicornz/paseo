/** Thrown when a prompt reaches a plugin session whose connection died with its plugin. */
export declare class StaleProviderSessionError extends Error {
    constructor(sessionId: string);
}
export declare function isStaleProviderSessionError(error: unknown): error is StaleProviderSessionError;
//# sourceMappingURL=stale-provider-session-error.d.ts.map