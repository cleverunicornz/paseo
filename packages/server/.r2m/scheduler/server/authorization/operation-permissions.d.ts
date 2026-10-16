import type { SessionInboundMessage, SessionOutboundMessage } from "../messages.js";
import type { DaemonPermission } from "./index.js";
type InboundOperation = SessionInboundMessage["type"];
export type PermissionRequirement = DaemonPermission | readonly DaemonPermission[] | null;
export declare function requiredPermissionForInbound(operation: InboundOperation): PermissionRequirement;
export declare function requiredPermissionForOutbound(message: SessionOutboundMessage): PermissionRequirement;
export {};
//# sourceMappingURL=operation-permissions.d.ts.map