export interface CreateAgentCaller {
    id: string;
    cwd: string;
    workspaceId?: string;
}
export interface CreateAgentPlacement {
    workspaceId: string;
    cwd: string;
}
export interface CreateAgentIntent {
    workspaceId: string;
    cwd: string;
    parentAgentId: string | null;
    labels: Record<string, string>;
}
export declare function resolveCreateAgentIntent(input: {
    explicitWorkspaceId?: string;
    caller: CreateAgentCaller | null;
    labels?: Record<string, string>;
    childAgentDefaultLabels?: Record<string, string>;
    resolveWorkspace: (workspaceId: string) => Promise<CreateAgentPlacement>;
    createWorkspace: () => Promise<CreateAgentPlacement>;
    legacyDetached?: boolean;
}): Promise<CreateAgentIntent>;
//# sourceMappingURL=intent.d.ts.map