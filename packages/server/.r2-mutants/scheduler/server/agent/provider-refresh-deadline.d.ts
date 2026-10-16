import type { ProviderRefreshContext } from "./agent-sdk-types.js";
interface RunProviderRefreshOptions<T> {
    label: string;
    timeoutMs: number;
    operation: (context: ProviderRefreshContext) => Promise<T>;
}
export declare function runProviderRefreshActivity<T>(context: ProviderRefreshContext | undefined, name: string, operation: () => Promise<T>): Promise<T>;
export declare function raceProviderRefreshAbort<T>(signal: AbortSignal | undefined, operation: Promise<T>): Promise<T>;
export declare function runProviderRefreshWithDeadline<T>(options: RunProviderRefreshOptions<T>): Promise<T>;
export {};
//# sourceMappingURL=provider-refresh-deadline.d.ts.map