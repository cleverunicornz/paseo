import type { ProjectRegistry } from "./workspace-registry.js";
export interface WorktreeWorkspaceSource {
    cwd?: string;
    projectId?: string;
}
export declare function resolveWorktreeSourceCwd(source: WorktreeWorkspaceSource, projectRegistry: Pick<ProjectRegistry, "get">): Promise<string>;
//# sourceMappingURL=workspace-source.d.ts.map