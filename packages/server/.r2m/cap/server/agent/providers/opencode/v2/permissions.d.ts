import type { V2Api } from "./api.js";
import type { AgentPermissionRequest, AgentPermissionResponse, AgentSessionConfig, AgentStreamEvent } from "../../../agent-sdk-types.js";
export declare class SessionPermissions {
    private readonly getClient;
    private readonly id;
    private readonly config;
    private readonly emit;
    private readonly pending;
    private readonly permissionOwners;
    private readonly forms;
    constructor(getClient: () => V2Api, id: string, config: AgentSessionConfig, emit: (event: AgentStreamEvent) => void);
    observe(event: import("@opencode/client").OpenCodeEvent): void;
    list(): AgentPermissionRequest[];
    isOwnedBy(requestId: string, sessionID: string): boolean;
    respondToPermission(requestId: string, response: AgentPermissionResponse): Promise<void>;
    reconcile(sessionID: string): Promise<void>;
    resolvePending(requestId: string, resolution: AgentPermissionResponse): void;
}
//# sourceMappingURL=permissions.d.ts.map