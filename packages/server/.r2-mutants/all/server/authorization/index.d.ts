import type { SessionInboundMessage, SessionOutboundMessage } from "../messages.js";
import { DAEMON_PERMISSIONS, type DaemonPermission } from "@getpaseo/protocol/messages";
export { DAEMON_PERMISSIONS, type DaemonPermission };
export declare function isDaemonPermission(value: string): value is DaemonPermission;
export declare function parseDaemonPermissions(values: readonly string[]): DaemonPermission[];
export declare const OWNER_PERMISSIONS: readonly DaemonPermission[];
export declare class SessionAuthorization {
    private permissions;
    constructor(permissions: readonly DaemonPermission[]);
    allowsInbound(message: SessionInboundMessage): boolean;
    allowsOutbound(message: SessionOutboundMessage): boolean;
    replacePermissions(permissions: readonly DaemonPermission[]): void;
    listPermissions(): DaemonPermission[];
    allowsPermission(permission: DaemonPermission): boolean;
    private allows;
}
export declare function permissionsForLegacyHubScopes(scopes: readonly string[]): readonly DaemonPermission[];
//# sourceMappingURL=index.d.ts.map