import type pino from "pino";
import type { SubscribeCheckoutDiffRequest, SessionOutboundMessage } from "./messages.js";
import type { WorkspaceGitService } from "./workspace-git-service.js";
type CheckoutDiffWorkspace = Pick<WorkspaceGitService, "getCheckoutDiff" | "getSnapshot" | "peekSnapshot" | "registerWorkspace" | "requestWorkingTreeWatch">;
export type CheckoutDiffCompareInput = SubscribeCheckoutDiffRequest["compare"];
export type CheckoutDiffSnapshotPayload = Omit<Extract<SessionOutboundMessage, {
    type: "checkout_diff_update";
}>["payload"], "subscriptionId">;
export interface CheckoutDiffMetrics {
    checkoutDiffTargetCount: number;
    checkoutDiffSubscriptionCount: number;
    checkoutDiffWatcherCount: number;
    checkoutDiffFallbackRefreshTargetCount: number;
}
export interface CheckoutDiffSubscriptionRequest {
    cwd: string;
    compare: CheckoutDiffCompareInput;
    signal?: AbortSignal;
}
export interface CheckoutDiffSubscription {
    initial: CheckoutDiffSnapshotPayload;
    unsubscribe: () => void;
}
export declare class CheckoutDiffManager {
    private readonly workspaceGitService;
    private readonly targets;
    constructor(options: {
        logger: pino.Logger;
        paseoHome: string;
        workspaceGitService: CheckoutDiffWorkspace;
    });
    read(params: Omit<CheckoutDiffSubscriptionRequest, "signal">): Promise<CheckoutDiffSnapshotPayload>;
    subscribe(params: CheckoutDiffSubscriptionRequest, listener: (snapshot: CheckoutDiffSnapshotPayload) => void): Promise<CheckoutDiffSubscription>;
    scheduleRefreshForCwd(cwd: string): void;
    getMetrics(): CheckoutDiffMetrics;
    dispose(): void;
    private normalizeCompare;
    private buildTargetKey;
    private closeTarget;
    private rememberWorkspaceSnapshot;
    private removeListener;
    private scheduleTargetRefresh;
    private computeCheckoutDiffSnapshot;
    private refreshTarget;
    private ensureTarget;
    private openTarget;
}
export {};
//# sourceMappingURL=checkout-diff-manager.d.ts.map