import { describeHookWorkspace } from "../../plugins/lifecycle/index.js";
import { basename, resolve } from "node:path";
import { generateWorkspaceId, initialWorkspacePlacement, reconcileWorkspacePlacement, } from "../../workspace-registry-model.js";
import { createPersistedWorkspaceRecord, } from "../../workspace-registry.js";
import { deriveProjectKey } from "../../project-key.js";
import { areEquivalentPaths, createRealpathAwarePathMatcher } from "../../../utils/path.js";
export class WorkspaceProvisioningError extends Error {
    constructor(code, projectId) {
        super(code === "unknown_project"
            ? `Unknown project: ${projectId}`
            : `Archived project: ${projectId}`);
        this.code = code;
        this.name = "WorkspaceProvisioningError";
    }
}
export function createWorkspaceProvisioningService(deps) {
    const { serverId, workspaceRegistry, projectRegistry, workspaceGitService, logger } = deps;
    /**
     * Placement facts at a workspace directory, or null when there is nothing
     * there to read. A git read answers "not a checkout" for a plain directory
     * and for a directory that is gone, and only the first is evidence that a
     * worktree stopped being one. That answer therefore counts only while the
     * directory is there on both sides of the read, so a worktree removed or
     * unmounted while the read is in flight stays an absence.
     */
    async function observeWorkspaceCheckout(cwd) {
        if (!(await deps.isDirectory(cwd)))
            return null;
        const checkout = await workspaceGitService.getCheckout(cwd);
        if (!checkout.isGit && !(await deps.isDirectory(cwd)))
            return null;
        return checkout;
    }
    async function runInImportWorkspace(input, operation) {
        if (input.requestedWorkspaceId) {
            const workspace = await workspaceRegistry.get(input.requestedWorkspaceId);
            if (!workspace || workspace.archivedAt) {
                throw new Error(`Workspace not found: ${input.requestedWorkspaceId}`);
            }
            const project = await projectRegistry.get(workspace.projectId);
            if (!project || project.archivedAt) {
                throw new Error(`Project not found: ${workspace.projectId}`);
            }
            if (!createRealpathAwarePathMatcher(workspace.cwd)(input.cwd)) {
                throw new Error(`Import cwd does not match workspace: ${workspace.workspaceId}`);
            }
            return {
                value: await operation(workspace),
                createdWorkspace: null,
            };
        }
        const [projectsBeforeImport, workspacesBeforeImport] = await Promise.all([
            projectRegistry.list(),
            workspaceRegistry.list(),
        ]);
        const workspace = await findOrCreateWorkspaceForDirectory(input.cwd);
        const createdWorkspace = workspacesBeforeImport.some((candidate) => candidate.workspaceId === workspace.workspaceId)
            ? null
            : workspace;
        const previousProject = projectsBeforeImport.find((project) => project.projectId === workspace.projectId) ?? null;
        try {
            return {
                value: await operation(workspace),
                createdWorkspace,
            };
        }
        catch (error) {
            if (createdWorkspace) {
                await rollbackFailedImportWorkspace(createdWorkspace, previousProject);
            }
            throw error;
        }
    }
    async function rollbackFailedImportWorkspace(workspace, previousProject) {
        try {
            await workspaceRegistry.remove(workspace.workspaceId);
            const projectHasActiveWorkspace = (await workspaceRegistry.list()).some((candidate) => candidate.projectId === workspace.projectId && !candidate.archivedAt);
            if (projectHasActiveWorkspace) {
                return;
            }
            if (previousProject?.archivedAt) {
                await projectRegistry.upsert(previousProject);
            }
            else if (!previousProject) {
                await projectRegistry.remove(workspace.projectId);
            }
        }
        catch (error) {
            logger.error({ err: error, workspaceId: workspace.workspaceId, projectId: workspace.projectId }, "Failed to restore workspace state after provider import failure");
        }
    }
    async function findOrCreateProjectForDirectory(cwd) {
        const rootPath = resolve(cwd);
        const checkout = await workspaceGitService.getCheckout(rootPath);
        const timestamp = new Date().toISOString();
        return projectRegistry.getOrCreateActiveByRoot({
            rootPath,
            kind: checkout.isGit ? "git" : "non_git",
            displayName: basename(rootPath) || rootPath,
            projectKey: deriveProjectKey({
                rootPath,
                remoteUrl: checkout.remoteUrl,
                worktreeRoot: checkout.worktreeRoot,
                mainRepoRoot: checkout.mainRepoRoot,
                serverId,
            }),
            timestamp,
        });
    }
    async function requireActiveProject(projectId) {
        const project = await projectRegistry.get(projectId);
        if (!project)
            throw new WorkspaceProvisioningError("unknown_project", projectId);
        if (project.archivedAt)
            throw new WorkspaceProvisioningError("archived_project", projectId);
        return project;
    }
    async function createWorkspaceForDirectory(cwd, title, projectId, context) {
        const normalizedCwd = resolve(cwd);
        const checkout = await workspaceGitService.getCheckout(normalizedCwd);
        const project = projectId
            ? await refreshProjectKind(await requireActiveProject(projectId), normalizedCwd, checkout)
            : // COMPAT(workspaceCreateMissingProjectId): added in v0.1.107, remove after 2027-01-15.
                await findOrCreateProjectForDirectory(normalizedCwd);
        const timestamp = new Date().toISOString();
        const workspace = createPersistedWorkspaceRecord({
            workspaceId: context?.workspaceId ?? generateWorkspaceId(),
            projectId: project.projectId,
            ...initialWorkspacePlacement({ source: "checkout", cwd: normalizedCwd, checkout }),
            title: title?.trim() || null,
            createdAt: timestamp,
            updatedAt: timestamp,
        });
        await workspaceRegistry.upsert(workspace, context);
        deps.lifecycle?.emit("workspace.created", { workspace: describeHookWorkspace(workspace) });
        return workspace;
    }
    async function createWorkspaceForWorktree(input) {
        const sourceCwd = resolve(input.sourceCwd);
        const repoRoot = resolve(input.repoRoot);
        const cwd = resolve(input.cwd);
        const worktreeRoot = resolve(input.worktreeRoot);
        const project = await resolveSourceProjectForWorktree({
            sourceCwd,
            projectId: input.projectId,
            repoRoot,
        });
        const timestamp = new Date().toISOString();
        const workspace = createPersistedWorkspaceRecord({
            workspaceId: input.workspaceId ?? generateWorkspaceId(),
            projectId: project.projectId,
            ...initialWorkspacePlacement({
                source: "created_worktree",
                cwd,
                worktreeRoot,
                branch: input.branch,
                baseBranch: input.baseBranch,
                mainRepoRoot: repoRoot,
            }),
            title: input.title,
            createdAt: timestamp,
            updatedAt: timestamp,
            ...(input.untrustedSource ? { untrustedSource: input.untrustedSource } : {}),
        });
        await workspaceRegistry.upsert(workspace, {
            expectsInitialAgent: input.expectsInitialAgent,
        });
        deps.lifecycle?.emit("workspace.created", { workspace: describeHookWorkspace(workspace) });
        return workspace;
    }
    async function resolveSourceProjectForWorktree(input) {
        if (input.projectId) {
            return refreshProjectKind(await requireActiveProject(input.projectId));
        }
        const workspaces = await workspaceRegistry.list();
        const sourceWorkspace = workspaces.find((workspace) => !workspace.archivedAt && areEquivalentPaths(workspace.cwd, input.sourceCwd)) ??
            workspaces.find((workspace) => !workspace.archivedAt && areEquivalentPaths(workspace.cwd, input.repoRoot));
        if (sourceWorkspace) {
            const project = await projectRegistry.get(sourceWorkspace.projectId);
            if (project)
                return refreshProjectKind(project);
            // COMPAT(worktreeMissingSourceProject): added in v0.1.107, remove after 2027-01-15.
            // Orphaned legacy workspace FKs fall through to exact-root allocation.
        }
        const checkout = await workspaceGitService.getCheckout(input.repoRoot);
        const project = await projectRegistry.getOrCreateActiveByRoot({
            rootPath: input.repoRoot,
            kind: "git",
            displayName: basename(input.repoRoot) || input.repoRoot,
            projectKey: deriveProjectKey({
                rootPath: input.repoRoot,
                remoteUrl: checkout.remoteUrl,
                worktreeRoot: checkout.worktreeRoot,
                mainRepoRoot: checkout.mainRepoRoot,
                serverId,
            }),
            timestamp: new Date().toISOString(),
        });
        return refreshProjectKind(project);
    }
    async function findOrCreateWorkspaceForDirectory(cwd) {
        const normalizedCwd = resolve(cwd);
        const workspaces = await workspaceRegistry.list();
        const active = workspaces
            .filter((workspace) => !workspace.archivedAt && areEquivalentPaths(workspace.cwd, normalizedCwd))
            .sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt) ||
            left.workspaceId.localeCompare(right.workspaceId))[0];
        if (active)
            return refreshWorkspaceRecord(active);
        const archived = workspaces
            .filter((workspace) => workspace.archivedAt && areEquivalentPaths(workspace.cwd, normalizedCwd))
            .sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt) ||
            left.workspaceId.localeCompare(right.workspaceId))[0];
        if (archived) {
            const project = await projectRegistry.get(archived.projectId);
            if (project && !project.archivedAt)
                return ensureWorkspaceRecordUnarchived(archived);
        }
        return createWorkspaceForDirectory(normalizedCwd);
    }
    async function resolveOrCreateWorkspaceIdForCreateAgent(input) {
        if (input.createdWorktree)
            return input.createdWorktree.workspace.workspaceId;
        if (input.requestedWorkspaceId)
            return input.requestedWorkspaceId;
        return (await createWorkspaceForDirectory(input.cwd, input.initialTitle, undefined, {
            expectsInitialAgent: true,
        })).workspaceId;
    }
    async function resolveRestoredAutoArchiveChangeRequestUrl(workspace) {
        if (!workspace.archivedAt) {
            return workspace.autoArchivedChangeRequestUrl;
        }
        const snapshot = await workspaceGitService.getSnapshot(workspace.cwd, {
            force: true,
            includeForge: true,
            reason: "workspace-restore-auto-archive-latch",
        });
        return snapshot.forge.pullRequest?.isMerged
            ? snapshot.forge.pullRequest.url
            : workspace.autoArchivedChangeRequestUrl;
    }
    async function ensureWorkspaceRecordUnarchived(workspace) {
        const project = await projectRegistry.get(workspace.projectId);
        if (!project)
            throw new Error(`Unknown project: ${workspace.projectId}`);
        const timestamp = new Date().toISOString();
        const checkout = workspace.archivedAt || project.archivedAt
            ? await observeWorkspaceCheckout(workspace.cwd)
            : null;
        const autoArchivedChangeRequestUrl = await resolveRestoredAutoArchiveChangeRequestUrl(workspace);
        let next = null;
        if (workspace.archivedAt) {
            const placementUpdate = reconcileWorkspacePlacement({
                workspace,
                checkout,
                updatedAt: timestamp,
            });
            next = {
                ...(placementUpdate?.workspace ?? workspace),
                archivedAt: null,
                autoArchivedChangeRequestUrl,
                updatedAt: timestamp,
            };
        }
        if (project.archivedAt || workspace.archivedAt) {
            const projectCheckout = checkout && areEquivalentPaths(project.rootPath, workspace.cwd)
                ? checkout
                : await workspaceGitService.getCheckout(project.rootPath);
            const kind = projectCheckout.isGit ? "git" : "non_git";
            const projectKey = deriveProjectKey({
                rootPath: project.rootPath,
                remoteUrl: projectCheckout.remoteUrl,
                worktreeRoot: projectCheckout.worktreeRoot,
                mainRepoRoot: projectCheckout.mainRepoRoot,
                serverId,
            });
            if (project.archivedAt || project.kind !== kind || project.projectKey !== projectKey) {
                await projectRegistry.upsert({
                    ...project,
                    kind,
                    projectKey,
                    archivedAt: null,
                    updatedAt: timestamp,
                });
            }
        }
        if (!next)
            return workspace;
        await workspaceRegistry.upsert(next);
        return next;
    }
    async function refreshWorkspaceRecord(workspace) {
        const checkout = await observeWorkspaceCheckout(workspace.cwd);
        const project = await projectRegistry.get(workspace.projectId);
        if (project && !project.archivedAt) {
            await refreshProjectKind(project, workspace.cwd, checkout ?? undefined);
        }
        const update = reconcileWorkspacePlacement({
            workspace,
            checkout,
            updatedAt: new Date().toISOString(),
        });
        if (!update)
            return workspace;
        await workspaceRegistry.upsert(update.workspace);
        return update.workspace;
    }
    async function refreshProjectKind(project, workspaceCwd, workspaceCheckout) {
        const projectCheckout = workspaceCwd && workspaceCheckout && areEquivalentPaths(project.rootPath, workspaceCwd)
            ? workspaceCheckout
            : await workspaceGitService.getCheckout(project.rootPath);
        const kind = projectCheckout.isGit ? "git" : "non_git";
        const projectKey = deriveProjectKey({
            rootPath: project.rootPath,
            remoteUrl: projectCheckout.remoteUrl,
            worktreeRoot: projectCheckout.worktreeRoot,
            mainRepoRoot: projectCheckout.mainRepoRoot,
            serverId,
        });
        if (project.kind === kind && project.projectKey === projectKey)
            return project;
        const refreshed = {
            ...project,
            kind,
            projectKey,
            updatedAt: new Date().toISOString(),
        };
        await projectRegistry.upsert(refreshed);
        return refreshed;
    }
    return {
        runInImportWorkspace,
        findOrCreateWorkspaceForDirectory,
        resolveOrCreateWorkspaceIdForCreateAgent,
        createWorkspaceForDirectory,
        createWorkspaceForWorktree,
        findOrCreateProjectForDirectory,
        ensureWorkspaceRecordUnarchived,
    };
}
//# sourceMappingURL=workspace-provisioning-service.js.map