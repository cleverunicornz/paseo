import type { CheckoutDiffCompare, CheckoutDiffResult } from "../utils/checkout-git.js";
interface CheckoutDiffReadInput {
    cwd: string;
    compare: CheckoutDiffCompare;
    force?: boolean;
    reason?: string;
    load: () => Promise<CheckoutDiffResult>;
}
/** Completed payloads are bounded; active work survives invalidation and eviction. */
export declare class CheckoutDiffCache {
    private readonly now;
    private readonly values;
    private readonly active;
    constructor(now: () => number);
    read(input: CheckoutDiffReadInput): Promise<CheckoutDiffResult>;
    invalidate(cwd: string, mode: CheckoutDiffCompare["mode"]): void;
}
export {};
//# sourceMappingURL=checkout-diff-cache.d.ts.map