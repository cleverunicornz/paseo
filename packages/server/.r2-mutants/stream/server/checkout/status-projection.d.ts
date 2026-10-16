import type { CheckoutPrStatusResponse, CheckoutStatusResponse, SessionOutboundMessage } from "@getpaseo/protocol/messages";
import type { WorkspaceGitRuntimeSnapshot } from "../workspace-git-service.js";
type CheckoutPrStatusPayload = Extract<SessionOutboundMessage, {
    type: "checkout_pr_status_response";
}>["payload"];
type CheckoutPrStatusPayloadStatus = NonNullable<CheckoutPrStatusPayload["status"]>;
export declare function buildCheckoutStatusPayloadFromSnapshot({ cwd, requestId, snapshot, }: {
    cwd: string;
    requestId: string;
    snapshot: WorkspaceGitRuntimeSnapshot;
}): CheckoutStatusResponse["payload"];
export declare function buildCheckoutPrStatusPayloadFromSnapshot({ cwd, requestId, snapshot, }: {
    cwd: string;
    requestId: string;
    snapshot: WorkspaceGitRuntimeSnapshot;
}): CheckoutPrStatusResponse["payload"];
export declare function normalizeCheckoutPrStatusPayload(status: WorkspaceGitRuntimeSnapshot["forge"]["pullRequest"], forge?: string): CheckoutPrStatusPayloadStatus | null;
export {};
//# sourceMappingURL=status-projection.d.ts.map