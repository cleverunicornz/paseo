import type { WorkspaceRegistry } from "./workspace-registry.js";
export interface UntrustedWorkspaceSource {
    kind: "change_request";
    forge: string;
    number: number;
    headRepository: string;
}
export declare function formatWorkspaceAutomationBlockedMessage(source: UntrustedWorkspaceSource): string;
export declare class WorkspaceAutomationBlockedError extends Error {
    readonly source: UntrustedWorkspaceSource;
    constructor(source: UntrustedWorkspaceSource);
}
export declare function assertWorkspaceAutomationAllowed(source: UntrustedWorkspaceSource | undefined): void;
export declare function assertWorkspaceAutomationAllowedForWorkspace(registry: Pick<WorkspaceRegistry, "get">, workspaceId: string): Promise<void>;
export declare function clearWorkspaceAutomationBlock(registry: Pick<WorkspaceRegistry, "update">, workspaceId: string): Promise<boolean>;
//# sourceMappingURL=workspace-automation-gate.d.ts.map