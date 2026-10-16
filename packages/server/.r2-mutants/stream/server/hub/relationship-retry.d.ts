import type { HubRelationshipRetryPolicy } from "./relationship-controller.js";
export declare class BoundedExponentialHubRetryPolicy implements HubRelationshipRetryPolicy {
    private readonly random;
    constructor(random?: () => number);
    delay(attempt: number): number;
}
//# sourceMappingURL=relationship-retry.d.ts.map