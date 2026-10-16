interface TimeoutOptions<T> {
    promise: Promise<T>;
    timeoutMs: number;
    label: string;
}
export declare function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T>;
export declare function withTimeout<T>(options: TimeoutOptions<T>): Promise<T>;
export {};
//# sourceMappingURL=promise-timeout.d.ts.map