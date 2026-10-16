import type pino from "pino";
import type { WebSocketLike } from "../websocket-server.js";
import { type DaemonPermission } from "../authorization/index.js";
import type { HubExecutionAgents } from "./daemon-executions.js";
import type { HubRelationshipRemote } from "./relationship-remote.js";
export type HubConnectionState = "not_connected" | "connecting" | "connected" | "reconnecting" | "disconnecting" | "revoked";
export interface HubRelationshipStatus {
    state: HubConnectionState;
    daemonId: string | null;
    hubOrigin: string | null;
    permissions: DaemonPermission[];
    connectedAt: string | null;
    lastError: string | null;
}
export interface HubRelationshipManagement {
    connect(input: {
        hubUrl: string;
        token: string;
        permissions: readonly string[];
    }): Promise<HubRelationshipStatus>;
    updatePermissions(input: {
        grant: readonly string[];
        revoke: readonly string[];
    }): Promise<HubRelationshipStatus>;
    status(): HubRelationshipStatus;
    disconnect(input: {
        force: boolean;
    }): Promise<{
        status: HubRelationshipStatus;
        warning?: string;
    }>;
}
export interface ScheduledRelationshipTask {
    cancel(): void;
}
export interface HubRelationshipClock {
    now(): Date;
    schedule(delayMs: number, task: () => void): ScheduledRelationshipTask;
}
export interface HubRelationshipRetryPolicy {
    delay(attempt: number): number;
}
export interface HubRelationshipControllerOptions {
    paseoHome: string;
    hostname: string;
    serverId: string;
    daemonPublicKey: string;
    logger: pino.Logger;
    remote: HubRelationshipRemote;
    clock?: HubRelationshipClock;
    retryPolicy?: HubRelationshipRetryPolicy;
    createDaemonId?: () => string;
    attachSocket: (socket: WebSocketLike, options: {
        daemonId: string;
        principalId: string;
        permissions: readonly DaemonPermission[];
        agents: HubExecutionAgents;
        sessionProtocol: "legacy" | "session-v1";
    }) => Promise<void>;
    updateAttachedPermissions: (principalId: string, permissions: readonly DaemonPermission[]) => void;
    createExecutionAgents: (daemonId: string) => HubExecutionAgents;
}
export declare class HubRelationshipController implements HubRelationshipManagement {
    private readonly options;
    private readonly filePath;
    private readonly clock;
    private readonly retryPolicy;
    private record;
    private state;
    private connectedAt;
    private lastError;
    private socket;
    private retry;
    private generation;
    private enrollmentGeneration;
    private retryAttempt;
    private readonly inFlightEnrollments;
    private executionAgents;
    constructor(options: HubRelationshipControllerOptions);
    start(): Promise<void>;
    stop(): Promise<void>;
    status(): HubRelationshipStatus;
    connect(input: {
        hubUrl: string;
        token: string;
        permissions: readonly string[];
    }): Promise<HubRelationshipStatus>;
    updatePermissions(input: {
        grant: readonly string[];
        revoke: readonly string[];
    }): Promise<HubRelationshipStatus>;
    disconnect(input: {
        force: boolean;
    }): Promise<{
        status: HubRelationshipStatus;
        warning?: string;
    }>;
    private tryEnrollment;
    private openSocket;
    private socketConnected;
    private executionAgentsFor;
    private retireExecutionAgents;
    private socketRejected;
    private socketClosed;
    private socketFailed;
    private scheduleSocket;
    private scheduleEnrollment;
    private schedule;
    private revoke;
    private cancelLifecycle;
    private beginEnrollmentAttempt;
    private persist;
    private remove;
    private load;
}
//# sourceMappingURL=relationship-controller.d.ts.map