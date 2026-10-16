import type { PaseoServicePortAllocation } from "@getpaseo/protocol/paseo-config-schema";
export interface AllocateWorkspaceServicePortOptions {
    allocation: PaseoServicePortAllocation | undefined;
    cwd: string;
    scriptName: string;
    workspaceId: string;
    branchName: string | null;
    reservedPorts?: ReadonlySet<number>;
}
export declare function allocateWorkspaceServicePort(options: AllocateWorkspaceServicePortOptions): Promise<number>;
//# sourceMappingURL=workspace-service-port-allocator.d.ts.map