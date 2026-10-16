import net from "node:net";
import type { IncomingMessage } from "node:http";
import { type RequestHandler } from "express";
import type { Logger } from "pino";
export type ServiceProxyListenTarget = {
    type: "tcp";
    host: string;
    port: number;
} | {
    type: "socket";
    path: string;
} | {
    type: "pipe";
    path: string;
};
export interface ServiceProxyRoute {
    hostname: string;
    port: number;
}
export interface ServiceProxyRouteEntry extends ServiceProxyRoute {
    workspaceId: string;
    projectSlug: string;
    scriptName: string;
    localHostname?: string;
    publicHostname?: string | null;
    publicBaseUrl?: string | null;
}
export interface ServiceProxyUrlProjection {
    localProxyUrl: string | null;
    publicProxyUrl: string | null;
    proxyUrl: string | null;
}
export interface ServiceProxyScriptProjection extends ServiceProxyUrlProjection {
    hostname: string;
}
export interface ServiceProxyWorkspaceScriptProjection extends ServiceProxyScriptProjection {
    port: number | null;
}
export interface ServiceProxyHealthTarget {
    workspaceId: string;
    scriptName: string;
    hostname: string;
    port: number;
}
export interface WorkspaceServiceIdentity {
    workspaceId: string;
    projectSlug: string;
    branchName: string | null;
    scriptName: string;
}
export interface RegisterWorkspaceServiceInput extends WorkspaceServiceIdentity {
    port: number;
    publicBaseUrl?: string | null;
}
interface HostClassificationRegistered {
    type: "registered-service";
    route: ServiceProxyRoute;
}
interface HostClassificationKnownMiss {
    type: "known-service-miss";
}
interface HostClassificationDaemon {
    type: "daemon";
}
type HostClassification = HostClassificationRegistered | HostClassificationKnownMiss | HostClassificationDaemon;
export declare function buildServiceProxyLabel({ projectSlug, branchName, scriptName, }: {
    projectSlug: string;
    branchName: string | null;
    scriptName: string;
}): string;
export declare function buildLocalServiceHostname(input: {
    projectSlug: string;
    branchName: string | null;
    scriptName: string;
}): string;
export declare function buildPublicServiceHostname({ publicBaseUrl, ...service }: {
    publicBaseUrl: string;
    projectSlug: string;
    branchName: string | null;
    scriptName: string;
}): string;
export declare function buildPublicServiceProxyUrl(options: {
    publicBaseUrl: string;
    projectSlug: string;
    branchName: string | null;
    scriptName: string;
}): string;
export declare function projectServiceProxyUrls(options: {
    projectSlug: string;
    branchName: string | null;
    scriptName: string;
    daemonPort: number | null | undefined;
    publicBaseUrl?: string | null;
}): ServiceProxyUrlProjection;
export declare function projectWorkspaceService(input: {
    projectSlug: string;
    branchName: string | null;
    scriptName: string;
    daemonPort: number | null | undefined;
    publicBaseUrl?: string | null;
}): ServiceProxyScriptProjection;
export declare function projectRegisteredServiceProxyUrls(options: {
    route: Pick<ServiceProxyRouteEntry, "hostname" | "publicHostname" | "publicBaseUrl" | "projectSlug" | "scriptName">;
    daemonPort: number | null | undefined;
}): ServiceProxyUrlProjection;
export declare class ServiceProxyRouteCollisionError extends Error {
    readonly hostname: string;
    readonly existing: Pick<ServiceProxyRouteEntry, "workspaceId" | "scriptName">;
    readonly incoming: Pick<ServiceProxyRouteEntry, "workspaceId" | "scriptName">;
    constructor(hostname: string, existing: Pick<ServiceProxyRouteEntry, "workspaceId" | "scriptName">, incoming: Pick<ServiceProxyRouteEntry, "workspaceId" | "scriptName">);
}
export declare class ServiceProxyRouteRegistry {
    private routes;
    private hostnameAliases;
    private workspaceHostnames;
    private configuredPublicBaseHostnames;
    private publicBaseHostnames;
    constructor(publicBaseUrl?: string | null);
    registerWorkspaceService(input: RegisterWorkspaceServiceInput): ServiceProxyRouteEntry;
    registerRoute(entry: ServiceProxyRouteEntry): void;
    replaceWorkspaceBranchRoutes(params: {
        workspaceId: string;
        newBranch: string | null;
    }): boolean;
    removeRoute(hostname: string): void;
    removeRouteForWorkspaceScript(params: {
        workspaceId: string;
        scriptName: string;
    }): void;
    removeWorkspaceService(params: {
        workspaceId: string;
        scriptName: string;
    }): void;
    projectUrls(input: {
        projectSlug: string;
        branchName: string | null;
        scriptName: string;
        daemonPort: number | null | undefined;
        publicBaseUrl?: string | null;
    }): ServiceProxyUrlProjection;
    projectWorkspaceService(input: {
        projectSlug: string;
        branchName: string | null;
        scriptName: string;
        daemonPort: number | null | undefined;
        publicBaseUrl?: string | null;
    }): ServiceProxyScriptProjection;
    projectWorkspaceServiceState(input: {
        workspaceId: string;
        projectSlug: string;
        branchName: string | null;
        scriptName: string;
        daemonPort: number | null | undefined;
        publicBaseUrl?: string | null;
    }): ServiceProxyWorkspaceScriptProjection;
    getHealthCheckTargets(): ServiceProxyHealthTarget[];
    getWorkspaceHealthTargets(workspaceId: string): ServiceProxyHealthTarget[];
    getHealthTargetForHostname(hostname: string): ServiceProxyHealthTarget | null;
    removeServiceRoutesByHostnames(hostnames: string[]): void;
    removeRoutesForPort(port: number): void;
    classifyHost(host: string | undefined): HostClassification;
    findRoute(host: string): ServiceProxyRoute | null;
    getRouteEntry(hostname: string): ServiceProxyRouteEntry | null;
    listRoutes(): ServiceProxyRouteEntry[];
    listRoutesForWorkspace(workspaceId: string): ServiceProxyRouteEntry[];
    private assertCanRegister;
    private assertNoInternalCollisions;
    private toStoredEntry;
    private getRouteByHostname;
    private getRouteHostnames;
    private addHostnameToWorkspaceIndex;
    private removeHostnameFromWorkspaceIndex;
    private rebuildPublicBaseHostnames;
}
export { ServiceProxyRouteRegistry as ScriptRouteStore };
export type ScriptRoute = ServiceProxyRoute;
export type ScriptRouteEntry = ServiceProxyRouteEntry;
export declare function createScriptProxyMiddleware({ routeStore, logger, }: {
    routeStore: ServiceProxyRouteRegistry;
    logger: Logger;
}): RequestHandler;
export declare function createScriptProxyUpgradeHandler({ routeStore, logger, passthroughUnknown, }: {
    routeStore: ServiceProxyRouteRegistry;
    logger: Logger;
    passthroughUnknown?: boolean;
}): (req: IncomingMessage, socket: net.Socket, head: Buffer) => void;
export interface ServiceProxySubsystem {
    registerWorkspaceService(input: RegisterWorkspaceServiceInput): ServiceProxyRouteEntry;
    removeWorkspaceService(params: {
        workspaceId: string;
        scriptName: string;
    }): void;
    removeServiceRoutesByHostnames(hostnames: string[]): void;
    replaceWorkspaceBranchRoutes(params: {
        workspaceId: string;
        newBranch: string | null;
    }): boolean;
    getHealthCheckTargets(): ServiceProxyHealthTarget[];
    getWorkspaceHealthTargets(workspaceId: string): ServiceProxyHealthTarget[];
    getHealthTargetForHostname(hostname: string): ServiceProxyHealthTarget | null;
    projectUrls(input: {
        projectSlug: string;
        branchName: string | null;
        scriptName: string;
        daemonPort: number | null | undefined;
        publicBaseUrl?: string | null;
    }): ServiceProxyUrlProjection;
    projectWorkspaceService(input: {
        projectSlug: string;
        branchName: string | null;
        scriptName: string;
        daemonPort: number | null | undefined;
        publicBaseUrl?: string | null;
    }): ServiceProxyScriptProjection;
    projectWorkspaceServiceState(input: {
        workspaceId: string;
        projectSlug: string;
        branchName: string | null;
        scriptName: string;
        daemonPort: number | null | undefined;
        publicBaseUrl?: string | null;
    }): ServiceProxyWorkspaceScriptProjection;
    middleware(): RequestHandler;
    upgradeHandler(options: {
        passthroughUnknown: boolean;
    }): (req: IncomingMessage, socket: net.Socket, head: Buffer) => void;
    startStandalone(options: {
        listenTarget: ServiceProxyListenTarget;
    }): Promise<ServiceProxyListenTarget>;
    stopStandalone(): Promise<void>;
}
export declare function createServiceProxySubsystem({ logger, publicBaseUrl, }: {
    logger: Logger;
    publicBaseUrl?: string | null;
}): ServiceProxySubsystem;
export declare function findFreePort(): Promise<number>;
//# sourceMappingURL=service-proxy.d.ts.map