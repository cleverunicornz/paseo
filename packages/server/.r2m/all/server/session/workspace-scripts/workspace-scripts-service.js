import { buildWorkspaceScriptPayloads, readPaseoConfigForProjection, } from "../../script-status-projection.js";
import { deriveProjectServiceSlug, deriveProjectSlug } from "../../workspace-git-metadata.js";
export function createWorkspaceScriptsService(deps) {
    const { serviceProxy, scriptRuntimeStore, terminalManager, workspaceRegistry, projectRegistry, workspaceGitService, getDaemonTcpPort, getDaemonTcpHost, serviceProxyPublicBaseUrl, resolveScriptHealth, globalServicePorts, logger, emit, publishStatusUpdate, spawnWorkspaceScript, assertAutomationAllowed, } = deps;
    function resolveGitMetadata(workspace, project) {
        const snapshot = workspaceGitService.peekSnapshot(workspace.cwd);
        const currentBranch = snapshot?.git.currentBranch ?? workspace.branch ?? null;
        if (project) {
            return {
                projectSlug: deriveProjectServiceSlug(project),
                currentBranch,
            };
        }
        return {
            projectSlug: deriveProjectSlug(workspace.cwd, snapshot?.git.isGit ? snapshot.git.remoteUrl : null),
            currentBranch,
        };
    }
    function buildSnapshot(workspace, project = null) {
        if (!serviceProxy || !scriptRuntimeStore) {
            return [];
        }
        return buildWorkspaceScriptPayloads({
            workspaceId: workspace.workspaceId,
            workspaceDirectory: workspace.cwd,
            paseoConfig: readPaseoConfigForProjection(workspace.cwd, logger),
            serviceProxy,
            runtimeStore: scriptRuntimeStore,
            daemonPort: getDaemonTcpPort?.() ?? null,
            serviceProxyPublicBaseUrl,
            gitMetadata: resolveGitMetadata(workspace, project),
            resolveHealth: resolveScriptHealth ?? undefined,
        });
    }
    async function emitStatusUpdate(workspaceId, _workspaceDirectory) {
        try {
            const workspace = await workspaceRegistry.get(workspaceId);
            if (!workspace)
                return;
            const project = await projectRegistry.get(workspace.projectId);
            publishStatusUpdate({
                type: "script_status_update",
                payload: { workspaceId, scripts: buildSnapshot(workspace, project) },
            });
        }
        catch (error) {
            logger.warn({ err: error, workspaceId }, "Failed to project workspace script status");
        }
    }
    async function getWorkspace(workspaceId) {
        const workspace = await workspaceRegistry.get(workspaceId);
        if (!workspace) {
            throw new Error(`Workspace not found: ${workspaceId}`);
        }
        return workspace;
    }
    function requireAvailable() {
        if (!terminalManager || !serviceProxy || !scriptRuntimeStore) {
            throw new Error("Workspace scripts are not available on this daemon");
        }
        return { serviceProxy, runtimeStore: scriptRuntimeStore, terminalManager };
    }
    async function list(workspaceId) {
        requireAvailable();
        const workspace = await getWorkspace(workspaceId);
        const project = await projectRegistry.get(workspace.projectId);
        return buildSnapshot(workspace, project);
    }
    async function launchProcess(input) {
        const available = requireAvailable();
        const workspace = await getWorkspace(input.workspaceId);
        await assertAutomationAllowed(workspace.workspaceId);
        const project = await projectRegistry.get(workspace.projectId);
        const gitMetadata = resolveGitMetadata(workspace, project);
        const result = await spawnWorkspaceScript({
            repoRoot: workspace.cwd,
            workspaceId: workspace.workspaceId,
            projectSlug: gitMetadata.projectSlug,
            branchName: gitMetadata.currentBranch,
            scriptName: input.scriptName,
            daemonPort: getDaemonTcpPort?.() ?? null,
            daemonListenHost: getDaemonTcpHost?.() ?? null,
            serviceProxyPublicBaseUrl,
            serviceProxy: available.serviceProxy,
            runtimeStore: available.runtimeStore,
            terminalManager: available.terminalManager,
            globalServicePorts,
            logger,
            onLifecycleChanged: () => {
                void emitStatusUpdate(workspace.workspaceId, workspace.cwd);
            },
        });
        return { workspace, project, terminalId: result.terminalId };
    }
    async function launch(input) {
        const { workspace, project } = await launchProcess(input);
        const script = buildSnapshot(workspace, project).find((entry) => entry.scriptName === input.scriptName);
        if (!script) {
            throw new Error(`Script '${input.scriptName}' did not produce a status record`);
        }
        void emitStatusUpdate(workspace.workspaceId, workspace.cwd);
        return script;
    }
    async function stop(input) {
        const available = requireAvailable();
        const workspace = await getWorkspace(input.workspaceId);
        const project = await projectRegistry.get(workspace.projectId);
        const runtime = available.runtimeStore.get(input);
        if (!runtime || runtime.lifecycle !== "running") {
            throw new Error(`Script '${input.scriptName}' is not running`);
        }
        if (!available.terminalManager.getTerminal(runtime.terminalId)) {
            throw new Error(`Terminal for script '${input.scriptName}' is no longer available`);
        }
        // The launcher's terminal exit listener owns route removal and runtime state updates.
        await available.terminalManager.killTerminalAndWait(runtime.terminalId);
        const script = buildSnapshot(workspace, project).find((entry) => entry.scriptName === input.scriptName);
        if (!script) {
            throw new Error(`Script '${input.scriptName}' did not produce a status record`);
        }
        void emitStatusUpdate(workspace.workspaceId, workspace.cwd);
        return script;
    }
    async function start(request) {
        try {
            const { workspace, terminalId } = await launchProcess(request);
            void emitStatusUpdate(workspace.workspaceId, workspace.cwd);
            emit({
                type: "start_workspace_script_response",
                payload: {
                    requestId: request.requestId,
                    workspaceId: request.workspaceId,
                    scriptName: request.scriptName,
                    terminalId,
                    error: null,
                },
            });
        }
        catch (error) {
            const message = error instanceof Error ? error.message : "Failed to start workspace script";
            logger.error({ err: error, workspaceId: request.workspaceId, scriptName: request.scriptName }, "Failed to start workspace script");
            emit({
                type: "start_workspace_script_response",
                payload: {
                    requestId: request.requestId,
                    workspaceId: request.workspaceId,
                    scriptName: request.scriptName,
                    terminalId: null,
                    error: message,
                },
            });
        }
    }
    return { buildSnapshot, emitStatusUpdate, list, launch, stop, start };
}
//# sourceMappingURL=workspace-scripts-service.js.map