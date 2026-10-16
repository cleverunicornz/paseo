import type { WebSocketLike } from "../websocket-server.js";
export interface HubEnrollment {
    daemonId: string;
    idempotencyKey: string;
    hubOrigin: string;
    token: string;
    hostname: string;
    serverId: string;
    daemonPublicKey: string;
    credentialVerifier: string;
    permissions: string[];
}
export interface HubEnrollmentResult {
    daemonId: string;
    permissions: string[];
    webSocketUrl: string;
}
export interface HubPermissionUpdate {
    daemonId: string;
    hubOrigin: string;
    credential: string;
    permissions: string[];
}
export interface HubRevocation {
    daemonId: string;
    hubOrigin: string;
    credential: string;
}
export interface HubSocketCredentials {
    daemonId: string;
    webSocketUrl: string;
    credential: string;
}
export interface HubSocketEvents {
    connected(socket: WebSocketLike, sessionProtocol: "legacy" | "session-v1"): void;
    rejected(statusCode: 401 | 403): void;
    closed(code: number): void;
    failed(error: Error): void;
}
export interface HubSocketConnection {
    close(): void;
}
export interface HubRelationshipRemote {
    enroll(input: HubEnrollment): Promise<HubEnrollmentResult>;
    updatePermissions(input: HubPermissionUpdate): Promise<{
        permissions: string[];
    }>;
    revoke(input: HubRevocation): Promise<void>;
    openSocket(input: HubSocketCredentials, events: HubSocketEvents): HubSocketConnection;
}
export declare class HubEnrollmentRejectedError extends Error {
    readonly statusCode: number;
    constructor(statusCode: number);
}
export declare class DirectHubRelationshipRemote implements HubRelationshipRemote {
    private readonly requestTimeoutMs;
    constructor(options?: {
        requestTimeoutMs?: number;
    });
    enroll(input: HubEnrollment): Promise<HubEnrollmentResult>;
    updatePermissions(input: HubPermissionUpdate): Promise<{
        permissions: string[];
    }>;
    revoke(input: HubRevocation): Promise<void>;
    openSocket(input: HubSocketCredentials, events: HubSocketEvents): HubSocketConnection;
    private withRequestTimeout;
}
//# sourceMappingURL=relationship-remote.d.ts.map