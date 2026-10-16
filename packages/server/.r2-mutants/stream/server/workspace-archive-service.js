import { resolve } from "node:path";
import { deletePaseoWorktree, isPaseoOwnedWorktreeCwd, runWorktreeTeardownCommands, WorktreeTeardownError, } from "../utils/worktree.js";
import { createRealpathAwarePathMatcher } from "../utils/path.js";
import { runWithGitCommandPriority } from "../utils/run-git-command.js";
import { WorkspaceAutomationBlockedError } from "./workspace-automation-gate.js";
export async function requireActiveWorkspaceForArchive(dependencies, workspaceId) {
    const workspace = (await dependencies.listActiveWorkspaces()).find((candidate) => candidate.workspaceId === workspaceId);
    if (!workspace) {
        throw new Error(`Workspace not found: ${workspaceId}`);
    }
    return workspace;
}
export async function resolveWorkspaceIdAtPath(dependencies, targetPath) {
    const matchesTarget = createRealpathAwarePathMatcher(targetPath);
    const activeWorkspaces = await dependencies.listActiveWorkspaces();
    const exactMatches = activeWorkspaces.filter((workspace) => matchesTarget(workspace.cwd));
    const worktreeMatch = exactMatches.find((workspace) => workspace.kind === "worktree");
    if (worktreeMatch) {
        return worktreeMatch.workspaceId;
    }
    return dependencies.findWorkspaceIdForCwd(targetPath);
}
// Resolves the in-scope record set, tears each down
// (agents + terminals + record), then removes the backing directory iff it is
// Paseo-owned AND no active workspace still references it.
export async function archiveByScope(dependencies, request) {
    return runWithGitCommandPriority("high", () => archiveByScopeWithPriority(dependencies, request));
}
async function archiveByScopeWithPriority(dependencies, request) {
    const target = await resolveArchiveTarget(dependencies, request.scope);
    const targetWorkspaceIds = target.workspaceIds;
    await stopWorkspaceSetups(dependencies, target.setupWorkspaceIds, request.requestId);
    if (targetWorkspaceIds.length > 0) {
        dependencies.markWorkspaceArchiving(targetWorkspaceIds, new Date().toISOString());
    }
    let removedDirectory = false;
    try {
        if (targetWorkspaceIds.length > 0) {
            await dependencies.emitWorkspaceUpdatesForWorkspaceIds(targetWorkspaceIds);
        }
        const { archivedAgents, archivedWorkspaceIds } = await archiveTargetRecords(dependencies, targetWorkspaceIds, request.requestId);
        if (target.backing?.mainRepoRoot) {
            try {
                await dependencies.workspaceGitService.getSnapshot(target.backing.mainRepoRoot, {
                    force: true,
                    reason: "archive-worktree",
                });
            }
            catch (error) {
                dependencies.sessionLogger?.warn({ err: error, cwd: target.backing.mainRepoRoot, requestId: request.requestId }, "Failed to force-refresh workspace git snapshot after archiving");
            }
        }
        if (target.backing !== null) {
            removedDirectory = await maybeRemoveDirectory(dependencies, request, target, archivedWorkspaceIds);
        }
        return {
            archivedAgentIds: Array.from(archivedAgents),
            archivedWorkspaceIds,
            removedDirectory,
        };
    }
    finally {
        if (targetWorkspaceIds.length > 0) {
            dependencies.clearWorkspaceArchiving(targetWorkspaceIds);
            await dependencies.emitWorkspaceUpdatesForWorkspaceIds(targetWorkspaceIds);
        }
    }
}
async function resolveArchiveTarget(dependencies, scope) {
    const activeWorkspaces = await dependencies.listActiveWorkspaces();
    if (scope.kind === "workspace") {
        const workspaceId = scope.workspaceId;
        const record = (await dependencies.getWorkspace?.(workspaceId)) ??
            activeWorkspaces.find((workspace) => workspace.workspaceId === workspaceId);
        if (!record) {
            dependencies.sessionLogger?.warn({ workspaceId }, "Workspace not found for archive-by-scope; skipping");
            return { backing: null, teardownTargets: [], setupWorkspaceIds: [], workspaceIds: [] };
        }
        const isArchived = "archivedAt" in record && Boolean(record.archivedAt);
        return {
            backing: await resolveWorkspaceBackingDirectory(record, dependencies),
            teardownTargets: isArchived ? [] : [{ workspaceId, cwd: record.cwd }],
            setupWorkspaceIds: [workspaceId],
            workspaceIds: isArchived ? [] : [workspaceId],
        };
    }
    const backing = await resolveBackingDirectory(scope.targetPath, dependencies);
    const matchesBackingDirectory = createRealpathAwarePathMatcher(backing.path);
    const targetWorkspaces = (await Promise.all(activeWorkspaces.map(async (workspace) => {
        const backingDirectory = await resolveWorkspaceBackingDirectory(workspace, dependencies);
        return matchesBackingDirectory(backingDirectory.path) ? workspace : null;
    }))).filter((workspace) => workspace !== null);
    const persistedMainRepoRoot = targetWorkspaces.find((workspace) => workspace.mainRepoRoot)?.mainRepoRoot;
    return {
        backing: {
            ...backing,
            mainRepoRoot: persistedMainRepoRoot ?? backing.mainRepoRoot,
        },
        teardownTargets: targetWorkspaces.length > 0
            ? targetWorkspaces.map((workspace) => ({
                workspaceId: workspace.workspaceId,
                cwd: workspace.cwd,
            }))
            : [{ workspaceId: null, cwd: scope.targetPath }],
        setupWorkspaceIds: targetWorkspaces.map((workspace) => workspace.workspaceId),
        workspaceIds: targetWorkspaces.map((workspace) => workspace.workspaceId),
    };
}
async function stopWorkspaceSetups(dependencies, workspaceIds, requestId) {
    if (!dependencies.stopWorkspaceSetup) {
        return;
    }
    const results = await Promise.allSettled(workspaceIds.map((workspaceId) => dependencies.stopWorkspaceSetup(workspaceId)));
    for (const [index, result] of results.entries()) {
        if (result?.status === "rejected") {
            dependencies.sessionLogger?.warn({ err: result.reason, workspaceId: workspaceIds[index], requestId }, "Failed to stop workspace setup during archive; continuing");
        }
    }
}
async function resolveWorkspaceBackingDirectory(workspace, dependencies) {
    if (workspace.isPaseoOwnedWorktree && workspace.worktreeRoot && workspace.mainRepoRoot) {
        return {
            path: resolve(workspace.worktreeRoot),
            isPaseoOwnedWorktree: true,
            mainRepoRoot: workspace.mainRepoRoot,
            paseoWorktreesRoot: null,
        };
    }
    if (workspace.kind !== "worktree") {
        return {
            path: resolve(workspace.cwd),
            isPaseoOwnedWorktree: false,
            mainRepoRoot: workspace.mainRepoRoot ?? null,
            paseoWorktreesRoot: null,
        };
    }
    // COMPAT(archiveMissingWorkspacePlacement): worktree records created before v0.1.110
    // lack durable backing ownership; remove filesystem discovery after 2027-01-17.
    const backing = await resolveBackingDirectory(workspace.worktreeRoot ?? workspace.cwd, dependencies);
    return { ...backing, mainRepoRoot: workspace.mainRepoRoot ?? backing.mainRepoRoot };
}
async function resolveBackingDirectory(cwd, dependencies) {
    const options = {
        paseoHome: dependencies.paseoHome,
        worktreesRoot: dependencies.paseoWorktreesBaseRoot,
    };
    const ownership = await isPaseoOwnedWorktreeCwd(cwd, options);
    return {
        path: resolve(ownership.allowed && ownership.worktreePath ? ownership.worktreePath : cwd),
        isPaseoOwnedWorktree: ownership.allowed,
        mainRepoRoot: ownership.repoRoot ?? null,
        paseoWorktreesRoot: ownership.worktreeRoot ?? null,
    };
}
async function archiveTargetRecords(dependencies, targetWorkspaceIds, requestId) {
    const archivedAgents = new Set();
    const archivedWorkspaceIds = [];
    const results = await Promise.allSettled(targetWorkspaceIds.map(async (workspaceId) => {
        const agents = await archiveWorkspaceContents(dependencies, workspaceId);
        await dependencies.archiveWorkspaceRecord(workspaceId);
        return { workspaceId, agents };
    }));
    for (const result of results) {
        if (result.status === "fulfilled") {
            archivedWorkspaceIds.push(result.value.workspaceId);
            for (const agentId of result.value.agents) {
                archivedAgents.add(agentId);
            }
        }
        else {
            dependencies.sessionLogger?.warn({ err: result.reason, requestId }, "archiveByScope workspace teardown failed; continuing");
        }
    }
    return { archivedAgents, archivedWorkspaceIds };
}
async function maybeRemoveDirectory(dependencies, request, target, archivedWorkspaceIds) {
    const backing = target.backing;
    if (!backing?.isPaseoOwnedWorktree) {
        return false;
    }
    const archivedWorkspaceIdSet = new Set(archivedWorkspaceIds);
    const teardownTargets = target.teardownTargets.filter((teardownTarget) => teardownTarget.workspaceId === null || archivedWorkspaceIdSet.has(teardownTarget.workspaceId));
    try {
        const allowedTeardownTargets = await filterAllowedTeardownTargets(dependencies, teardownTargets);
        for (const teardownTarget of uniqueTeardownTargets(allowedTeardownTargets)) {
            await runWorktreeTeardownCommands({
                worktreePath: backing.path,
                teardownCwd: teardownTarget.cwd,
                repoRootPath: backing.mainRepoRoot ?? undefined,
            });
        }
    }
    catch (error) {
        if (error instanceof WorktreeTeardownError) {
            dependencies.sessionLogger?.warn({ err: error, targetPath: backing.path, requestId: request.requestId }, "Worktree teardown failed during archive; workspace already archived");
            return false;
        }
        throw error;
    }
    const remainingActive = await dependencies.listActiveWorkspaces();
    if (!(await isDirectoryUnreferenced(remainingActive, backing.path, new Set(archivedWorkspaceIds), dependencies))) {
        return false;
    }
    try {
        await deletePaseoWorktree({
            cwd: backing.mainRepoRoot,
            worktreePath: backing.path,
            teardownCwds: [],
            worktreesRoot: backing.paseoWorktreesRoot ?? undefined,
            paseoHome: dependencies.paseoHome,
            worktreesBaseRoot: dependencies.paseoWorktreesBaseRoot,
        });
        dependencies.github.invalidate({ cwd: backing.path });
        return true;
    }
    catch (error) {
        dependencies.sessionLogger?.warn({ err: error, targetPath: backing.path, requestId: request.requestId }, "Worktree disk removal failed during archive; workspace already archived");
        return false;
    }
}
async function filterAllowedTeardownTargets(dependencies, targets) {
    const allowed = [];
    const blockedCwds = [];
    for (const target of targets) {
        try {
            if (target.workspaceId)
                await dependencies.assertWorkspaceAutomationAllowed?.(target.workspaceId);
            allowed.push(target);
        }
        catch (error) {
            if (!(error instanceof WorkspaceAutomationBlockedError))
                throw error;
            blockedCwds.push(target.cwd);
        }
    }
    return allowed.filter((target) => !blockedCwds.some((cwd) => createRealpathAwarePathMatcher(cwd)(target.cwd)));
}
function uniqueTeardownTargets(targets) {
    const unique = [];
    for (const candidate of targets) {
        if (!unique.some((existing) => createRealpathAwarePathMatcher(existing.cwd)(candidate.cwd))) {
            unique.push(candidate);
        }
    }
    return unique;
}
// Tears down everything OWNED by a single workspace record: its live agents,
// its persisted-but-not-running agent snapshots, and its terminals. Scoped by
// workspaceId so a sibling workspace sharing the same directory is untouched.
// Returns the set of archived agent ids.
export async function archiveWorkspaceContents(dependencies, workspaceId) {
    const archivedAgents = new Set();
    const liveAgents = dependencies.agentManager
        .listAgents()
        .filter((agent) => agent.workspaceId === workspaceId);
    for (const agent of liveAgents) {
        archivedAgents.add(agent.id);
    }
    let storedRecords = [];
    try {
        storedRecords = await dependencies.agentStorage.listByWorkspace(workspaceId);
    }
    catch (error) {
        dependencies.sessionLogger?.warn({ err: error, workspaceId }, "Failed to list stored agents during workspace archive; continuing");
    }
    const matchingStoredRecords = storedRecords;
    for (const record of matchingStoredRecords) {
        archivedAgents.add(record.id);
    }
    const archivedAt = new Date().toISOString();
    const agentIdsToArchive = new Set([
        ...liveAgents.map((agent) => agent.id),
        ...matchingStoredRecords.filter((record) => !record.archivedAt).map((record) => record.id),
    ]);
    const archiveResults = await Promise.allSettled([
        ...[...agentIdsToArchive].map((agentId) => dependencies.agentManager.getAgent(agentId)
            ? dependencies.agentManager.archiveAgent(agentId)
            : dependencies.agentManager.archiveSnapshot(agentId, archivedAt)),
        dependencies.killTerminalsForWorkspace(workspaceId),
    ]);
    for (const result of archiveResults) {
        if (result.status === "rejected") {
            dependencies.sessionLogger?.warn({ err: result.reason, workspaceId }, "Workspace archive teardown step failed; continuing");
        }
    }
    return archivedAgents;
}
// True when, after archiving
// the in-scope records, no active workspace still points at targetDir. Derived
// from records each call — no stored counter.
async function isDirectoryUnreferenced(activeWorkspaces, targetDir, archivedWorkspaceIds, dependencies) {
    const target = resolve(targetDir);
    const matchesTarget = createRealpathAwarePathMatcher(target);
    for (const workspace of activeWorkspaces) {
        if (archivedWorkspaceIds.has(workspace.workspaceId))
            continue;
        const backingDirectory = await resolveWorkspaceBackingDirectory(workspace, dependencies);
        if (matchesTarget(backingDirectory.path))
            return false;
    }
    return true;
}
export async function killTerminalsForWorkspace(dependencies, workspaceId) {
    const terminalManager = dependencies.terminalManager;
    if (!terminalManager) {
        return;
    }
    const terminalIds = [];
    const terminalLists = await Promise.all(terminalManager.listDirectories().map(async (terminalCwd) => {
        try {
            return await terminalManager.getTerminals(terminalCwd, { workspaceId });
        }
        catch (error) {
            dependencies.sessionLogger.warn({ err: error, cwd: terminalCwd }, "Failed to enumerate workspace terminals during archive");
            return [];
        }
    }));
    for (const terminals of terminalLists) {
        for (const terminal of terminals) {
            if (terminal.workspaceId === workspaceId) {
                terminalIds.push(terminal.id);
            }
        }
    }
    if (terminalIds.length === 0) {
        return;
    }
    await Promise.allSettled(terminalIds.map(async (terminalId) => {
        try {
            dependencies.detachTerminalStream?.(terminalId, { emitExit: true });
            await terminalManager.killTerminalAndWait(terminalId, {
                gracefulTimeoutMs: 2000,
                forceTimeoutMs: 1500,
            });
        }
        catch (error) {
            dependencies.sessionLogger.warn({ err: error, terminalId }, "Terminal kill escalation failed during archive; proceeding anyway");
        }
    }));
}
// Archiving the last workspace of a project leaves the project record active.
// The user removes the project explicitly, so we never archive the parent here.
export async function archivePersistedWorkspaceRecord(input) {
    const existingWorkspace = await input.workspaceRegistry.get(input.workspaceId);
    if (!existingWorkspace) {
        return null;
    }
    if (existingWorkspace.archivedAt) {
        return existingWorkspace;
    }
    const archivedAt = input.archivedAt ?? new Date().toISOString();
    await input.workspaceRegistry.archive(input.workspaceId, archivedAt, input.context);
    return existingWorkspace;
}
//# sourceMappingURL=workspace-archive-service.js.map