import { expandTilde } from "../utils/path.js";
export async function resolveWorktreeSourceCwd(source, projectRegistry) {
    if (source.cwd) {
        return expandTilde(source.cwd);
    }
    if (!source.projectId) {
        throw new Error("cwd or projectId is required for a worktree-backed workspace");
    }
    const project = await projectRegistry.get(source.projectId);
    if (!project || project.archivedAt) {
        throw new Error(`Project not found: ${source.projectId}`);
    }
    return project.rootPath;
}
//# sourceMappingURL=workspace-source.js.map