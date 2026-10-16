export type WorkspaceSetupOperation = (signal: AbortSignal) => Promise<void>;
export declare class WorkspaceSetupRuntime {
    private readonly runs;
    start(workspaceId: string, operation: WorkspaceSetupOperation): void;
    stop(workspaceId: string): Promise<void>;
}
//# sourceMappingURL=workspace-setup-runtime.d.ts.map