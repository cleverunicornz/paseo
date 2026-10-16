interface WorkspaceServicePortDeclaration {
    scriptName: string;
    port?: number;
}
interface WorkspaceServicePortAllocationRequest {
    scriptName: string;
    reservedPorts: ReadonlySet<number>;
}
interface EnsureWorkspaceServicePortPlanOptions {
    workspaceId: string;
    services: readonly WorkspaceServicePortDeclaration[];
    allocatePort: (request: WorkspaceServicePortAllocationRequest) => Promise<number>;
}
interface RefreshWorkspaceServicePortOptions {
    workspaceId: string;
    service: WorkspaceServicePortDeclaration;
    allocatePort: (request: WorkspaceServicePortAllocationRequest) => Promise<number>;
}
export declare function ensureWorkspaceServicePortPlan(options: EnsureWorkspaceServicePortPlanOptions): Promise<ReadonlyMap<string, number>>;
export declare function requirePlannedWorkspaceServicePort(plan: ReadonlyMap<string, number>, scriptName: string): number;
export declare function releaseWorkspaceServicePortPlan(workspaceId: string): void;
export declare function refreshWorkspaceServicePort(options: RefreshWorkspaceServicePortOptions): Promise<number>;
export {};
//# sourceMappingURL=workspace-service-port-registry.d.ts.map