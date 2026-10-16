import { DAEMON_PERMISSIONS } from "@getpaseo/protocol/messages";
import { requiredPermissionForInbound, requiredPermissionForOutbound, } from "./operation-permissions.js";
export { DAEMON_PERMISSIONS };
const daemonPermissionSet = new Set(DAEMON_PERMISSIONS);
export function isDaemonPermission(value) {
    return daemonPermissionSet.has(value);
}
export function parseDaemonPermissions(values) {
    const permissions = [...new Set(values)];
    if (!permissions.every(isDaemonPermission))
        throw new Error("Invalid daemon permission");
    return permissions;
}
export const OWNER_PERMISSIONS = DAEMON_PERMISSIONS;
export class SessionAuthorization {
    constructor(permissions) {
        this.permissions = new Set(permissions);
    }
    allowsInbound(message) {
        return this.allows(requiredPermissionForInbound(message.type));
    }
    allowsOutbound(message) {
        return this.allows(requiredPermissionForOutbound(message));
    }
    replacePermissions(permissions) {
        this.permissions = new Set(permissions);
    }
    listPermissions() {
        return [...this.permissions];
    }
    allowsPermission(permission) {
        return this.permissions.has(permission);
    }
    allows(requirement) {
        if (requirement === null)
            return true;
        if (typeof requirement === "string")
            return this.permissions.has(requirement);
        return requirement.some((permission) => this.permissions.has(permission));
    }
}
const LEGACY_HUB_EXECUTION_SCOPE = "hub.execution.*";
export function permissionsForLegacyHubScopes(scopes) {
    // COMPAT(semanticHubPermissions): added in v0.7, remove after Hub enrollment uses permissions.
    return scopes.includes(LEGACY_HUB_EXECUTION_SCOPE) ? ["hub.execute"] : [];
}
//# sourceMappingURL=index.js.map