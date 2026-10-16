import { basename } from "node:path";
import { runAsyncWorktreeBootstrap, runWorktreeAutoTerminals, applyWorktreeSetupProgressEvent, buildWorktreeSetupDetail, createWorktreeSetupProgressAccumulator, getWorktreeSetupProgressResults, } from "./worktree-bootstrap.js";
import { expandTilde } from "../utils/path.js";
import { getWorktreeSetupCommands, resolveWorktreeRuntimeEnv, runWorktreeSetupCommands, slugify, validateBranchSlug, WorktreeSetupError, } from "../utils/worktree.js";
import { toCheckoutError } from "./checkout-git-utils.js";
import { toWorktreeWireError } from "./worktree-errors.js";
import { archiveCommand, createPaseoWorktreeCommand, listPaseoWorktreesCommand, } from "./worktree/commands.js";
import { formatWorkspaceAutomationBlockedMessage, WorkspaceAutomationBlockedError, } from "./workspace-automation-gate.js";
const SAFE_GIT_REF_PATTERN = /^[A-Za-z0-9._/-]+$/;
function normalizeFirstAgentContext(request) {
    if (request.firstAgentContext) {
        return request.firstAgentContext;
    }
    if (request.attachments || request.nameContext) {
        return {
            attachments: request.attachments ?? [],
            ...(request.nameContext ? { prompt: request.nameContext } : {}),
        };
    }
    return undefined;
}
export async function buildAgentSessionConfig(dependencies, config, gitOptions, legacyWorktreeName, firstAgentContext) {
    let cwd = expandTilde(config.cwd);
    const normalized = normalizeGitOptions(gitOptions, legacyWorktreeName);
    let setupContinuation;
    let createdWorkspaceId;
    if (!normalized) {
        return {
            sessionConfig: {
                ...config,
                cwd,
            },
        };
    }
    if (normalized.createWorktree) {
        dependencies.sessionLogger.info({ worktreeSlug: normalized.requestedWorktreeSlug }, "Creating worktree through createWorktreeCore");
        const createdWorktree = await dependencies.createPaseoWorktree({
            cwd,
            worktreeSlug: normalized.worktreeSlug,
            refName: normalized.refName,
            action: normalized.action,
            checkoutSource: normalized.checkoutSource,
            githubPrNumber: normalized.githubPrNumber,
            firstAgentContext,
            runSetup: false,
            paseoHome: dependencies.paseoHome,
            worktreesRoot: dependencies.worktreesRoot,
        }, {
            resolveDefaultBranch: normalized.baseBranch
                ? async () => normalized.baseBranch
                : (repoRoot) => resolveGitCreateBaseBranch(repoRoot, dependencies.workspaceGitService, dependencies.paseoHome),
        });
        cwd = createdWorktree.workspace.cwd;
        setupContinuation = createdWorktree.setupContinuation;
        createdWorkspaceId = createdWorktree.workspace.workspaceId;
    }
    else if (normalized.createNewBranch) {
        const baseBranch = normalized.baseBranch ??
            (await resolveGitCreateBaseBranch(cwd, dependencies.workspaceGitService, dependencies.paseoHome));
        await dependencies.createBranchFromBase({
            cwd,
            baseBranch,
            newBranchName: normalized.newBranchName,
        });
        dependencies.workspaceGitService?.invalidateForge(cwd);
    }
    else if (normalized.baseBranch) {
        await dependencies.checkoutExistingBranch(cwd, normalized.baseBranch);
        dependencies.workspaceGitService?.invalidateForge(cwd);
    }
    return {
        sessionConfig: {
            ...config,
            cwd,
        },
        setupContinuation,
        createdWorkspaceId,
    };
}
function validateNormalizedGitOptions(input) {
    if (input.baseBranch) {
        assertSafeGitRef(input.baseBranch, "base branch");
    }
    if (input.createNewBranch) {
        if (!input.normalizedBranchName) {
            throw new Error("New branch name is required");
        }
        const validation = validateBranchSlug(input.normalizedBranchName);
        if (!validation.valid) {
            throw new Error(`Invalid branch name: ${validation.error}`);
        }
    }
    if (input.normalizedWorktreeSlug) {
        const validation = validateBranchSlug(input.normalizedWorktreeSlug);
        if (!validation.valid) {
            throw new Error(`Invalid worktree name: ${validation.error}`);
        }
    }
}
export function normalizeGitOptions(gitOptions, legacyWorktreeName) {
    const fallbackOptions = legacyWorktreeName
        ? {
            createWorktree: true,
            createNewBranch: true,
            newBranchName: legacyWorktreeName,
            worktreeSlug: legacyWorktreeName,
        }
        : undefined;
    const merged = gitOptions ?? fallbackOptions;
    if (!merged) {
        return null;
    }
    const baseBranch = merged.baseBranch?.trim() || undefined;
    const createWorktree = Boolean(merged.createWorktree);
    const createNewBranch = Boolean(merged.createNewBranch);
    const normalizedBranchName = merged.newBranchName ? slugify(merged.newBranchName) : undefined;
    const requestedWorktreeSlug = merged.worktreeSlug ? slugify(merged.worktreeSlug) : undefined;
    const normalizedWorktreeSlug = requestedWorktreeSlug ?? normalizedBranchName;
    const refName = merged.refName?.trim() || undefined;
    const action = merged.action;
    // COMPAT(githubPrNumber): legacy GitHub checkout input retained when
    // checkoutSource shipped in v0.2.0-beta.1. Remove after 2027-01-17 once the
    // supported client floor is >= v0.2.0.
    const checkoutSource = merged.checkoutSource ??
        (merged.githubPrNumber
            ? { kind: "change_request", forge: "github", number: merged.githubPrNumber }
            : undefined);
    const githubPrNumber = merged.githubPrNumber;
    if (!createWorktree &&
        !createNewBranch &&
        !baseBranch &&
        !refName &&
        !action &&
        !checkoutSource &&
        !githubPrNumber) {
        return null;
    }
    validateNormalizedGitOptions({
        baseBranch,
        createNewBranch,
        normalizedBranchName,
        normalizedWorktreeSlug,
    });
    return {
        baseBranch,
        createNewBranch,
        newBranchName: normalizedBranchName,
        createWorktree,
        worktreeSlug: normalizedWorktreeSlug,
        requestedWorktreeSlug,
        refName,
        action,
        checkoutSource,
        githubPrNumber,
    };
}
export function assertSafeGitRef(ref, label) {
    if (!SAFE_GIT_REF_PATTERN.test(ref) || ref.includes("..") || ref.includes("@{")) {
        throw new Error(`Invalid ${label}: ${ref}`);
    }
}
export async function resolveGitCreateBaseBranch(cwd, workspaceGitService, _paseoHome) {
    if (!workspaceGitService) {
        throw new Error("WorkspaceGitService is required to resolve the repository root");
    }
    return workspaceGitService.resolveDefaultBranch(cwd);
}
export async function handlePaseoWorktreeListRequest(dependencies, msg) {
    const { requestId } = msg;
    const cwd = msg.repoRoot ?? msg.cwd;
    if (!cwd) {
        dependencies.emit({
            type: "paseo_worktree_list_response",
            payload: {
                worktrees: [],
                error: { code: "UNKNOWN", message: "cwd or repoRoot is required" },
                requestId,
            },
        });
        return;
    }
    try {
        const worktrees = await listPaseoWorktreesCommand({ workspaceGitService: dependencies.workspaceGitService }, { cwd });
        dependencies.emit({
            type: "paseo_worktree_list_response",
            payload: {
                worktrees: worktrees.map((entry) => ({
                    worktreePath: entry.path,
                    createdAt: entry.createdAt,
                    branchName: entry.branchName ?? null,
                    head: entry.head ?? null,
                })),
                error: null,
                requestId,
            },
        });
    }
    catch (error) {
        dependencies.emit({
            type: "paseo_worktree_list_response",
            payload: {
                worktrees: [],
                error: toCheckoutError(error),
                requestId,
            },
        });
    }
}
export async function handlePaseoWorktreeArchiveRequest(dependencies, msg) {
    const { requestId } = msg;
    try {
        const result = await archiveCommand(dependencies, {
            requestId,
            worktreePath: msg.worktreePath,
            repoRoot: msg.repoRoot,
            branchName: msg.branchName,
            workspaceId: msg.workspaceId,
            scope: msg.scope,
        });
        if (!result.ok) {
            dependencies.emit({
                type: "paseo_worktree_archive_response",
                payload: {
                    success: false,
                    removedAgents: result.removedAgents,
                    error: {
                        code: result.code,
                        message: result.message,
                    },
                    requestId,
                },
            });
            return;
        }
        dependencies.emit({
            type: "paseo_worktree_archive_response",
            payload: {
                success: true,
                removedAgents: result.removedAgents,
                error: null,
                requestId,
            },
        });
    }
    catch (error) {
        dependencies.emit({
            type: "paseo_worktree_archive_response",
            payload: {
                success: false,
                removedAgents: [],
                error: toCheckoutError(error),
                requestId,
            },
        });
    }
}
export async function handleCreatePaseoWorktreeRequest(dependencies, request) {
    try {
        const commandResult = await createPaseoWorktreeCommand({
            paseoHome: dependencies.paseoHome,
            worktreesRoot: dependencies.worktreesRoot,
            createPaseoWorktreeWorkflow: dependencies.createPaseoWorktreeWorkflow,
        }, {
            cwd: request.cwd,
            projectId: request.projectId,
            worktreeSlug: request.worktreeSlug,
            firstAgentContext: normalizeFirstAgentContext(request),
            refName: request.refName,
            action: request.action,
            checkoutSource: request.checkoutSource,
            githubPrNumber: request.githubPrNumber,
        });
        if (!commandResult.ok) {
            dependencies.sessionLogger.error({ err: commandResult.cause, cwd: request.cwd, worktreeSlug: request.worktreeSlug }, "Failed to create worktree");
            dependencies.emit({
                type: "create_paseo_worktree_response",
                payload: {
                    workspace: null,
                    error: commandResult.error.message,
                    errorCode: commandResult.error.code,
                    setupTerminalId: null,
                    requestId: request.requestId,
                },
            });
            return;
        }
        const createdWorktree = commandResult.createdWorktree;
        const descriptor = await dependencies.describeWorkspaceRecord(createdWorktree);
        dependencies.emit({
            type: "create_paseo_worktree_response",
            payload: {
                workspace: descriptor,
                error: null,
                setupTerminalId: null,
                ...(createdWorktree.workspace.untrustedSource
                    ? {
                        setupSkippedReason: formatWorkspaceAutomationBlockedMessage(createdWorktree.workspace.untrustedSource),
                    }
                    : {}),
                requestId: request.requestId,
            },
        });
        dependencies.emit({
            type: "workspace_update",
            payload: {
                kind: "upsert",
                workspace: descriptor,
            },
        });
    }
    catch (error) {
        const wireError = toWorktreeWireError(error);
        dependencies.sessionLogger.error({ err: error, cwd: request.cwd, worktreeSlug: request.worktreeSlug }, "Failed to create worktree");
        dependencies.emit({
            type: "create_paseo_worktree_response",
            payload: {
                workspace: null,
                error: wireError.message,
                errorCode: wireError.code,
                setupTerminalId: null,
                requestId: request.requestId,
            },
        });
    }
}
export async function createPaseoWorktreeWorkflow(dependencies, input, options) {
    const createdWorktree = await dependencies.createPaseoWorktree({
        ...input,
        runSetup: false,
        paseoHome: input.paseoHome ?? dependencies.paseoHome,
        worktreesRoot: input.worktreesRoot ?? dependencies.worktreesRoot,
    }, options?.resolveDefaultBranch
        ? { resolveDefaultBranch: options.resolveDefaultBranch }
        : undefined);
    const slug = basename(createdWorktree.worktree.worktreePath);
    const workspace = createdWorktree.workspace;
    const setupContinuation = options?.setupContinuation ?? { kind: "workspace" };
    try {
        await dependencies.assertWorkspaceAutomationAllowed?.(workspace.workspaceId);
    }
    catch (error) {
        if (!(error instanceof WorkspaceAutomationBlockedError))
            throw error;
        const snapshot = {
            status: "blocked",
            detail: buildWorktreeSetupDetail({ worktree: createdWorktree.worktree, results: [] }),
            error: null,
            blockedSource: error.source,
        };
        dependencies.cacheWorkspaceSetupSnapshot(workspace.workspaceId, snapshot);
        dependencies.emit({
            type: "workspace_setup_progress",
            payload: { workspaceId: workspace.workspaceId, ...snapshot },
        });
        if (setupContinuation.kind === "agent") {
            return {
                ...createdWorktree,
                setupContinuation: {
                    kind: "agent",
                    startAfterAgentCreate: () => undefined,
                },
            };
        }
        return createdWorktree;
    }
    setTimeout(() => {
        if (input.firstAgentContext) {
            dependencies.autoNameWorkspaceBranchForFirstAgent({
                workspace,
                firstAgentContext: input.firstAgentContext,
            });
        }
        void dependencies.warmWorkspaceGitData(workspace).catch((error) => {
            dependencies.sessionLogger.warn({ err: error, workspaceId: workspace.workspaceId }, "Failed to warm workspace git data after creating worktree");
        });
        if (setupContinuation.kind === "workspace") {
            const runSetup = (signal) => runWorktreeSetupInBackground(dependencies, {
                requestCwd: input.cwd,
                repoRoot: createdWorktree.repoRoot,
                workspaceId: workspace.workspaceId,
                worktree: createdWorktree.worktree,
                shouldBootstrap: createdWorktree.created,
                slug,
                worktreePath: createdWorktree.worktree.worktreePath,
                workspaceCwd: workspace.cwd,
            }, signal);
            if (dependencies.startWorkspaceSetup) {
                dependencies.startWorkspaceSetup(workspace.workspaceId, runSetup);
            }
            else {
                void runSetup(new AbortController().signal);
            }
        }
    }, 0);
    if (setupContinuation.kind === "agent") {
        return {
            ...createdWorktree,
            setupContinuation: {
                kind: "agent",
                startAfterAgentCreate: ({ agentId }) => {
                    void runAsyncWorktreeBootstrap({
                        agentId,
                        workspaceId: workspace.workspaceId,
                        worktree: createdWorktree.worktree,
                        workspaceCwd: workspace.cwd,
                        shouldBootstrap: createdWorktree.created,
                        terminalManager: setupContinuation.terminalManager,
                        appendTimelineItem: (item) => setupContinuation.appendTimelineItem({ agentId, item }),
                        emitLiveTimelineItem: (item) => setupContinuation.emitLiveTimelineItem({ agentId, item }),
                        logger: setupContinuation.logger,
                    });
                },
            },
        };
    }
    return createdWorktree;
}
export async function handleWorkspaceSetupStatusRequest(dependencies, request) {
    const workspaceId = request.workspaceId;
    let snapshot = dependencies.workspaceSetupSnapshots.get(workspaceId) ?? null;
    if (!snapshot) {
        const workspace = await dependencies.getWorkspace(workspaceId);
        if (workspace?.untrustedSource) {
            snapshot = {
                status: "blocked",
                detail: buildWorktreeSetupDetail({
                    worktree: {
                        worktreePath: workspace.worktreeRoot ?? workspace.cwd,
                        branchName: workspace.branch ?? "",
                    },
                    results: [],
                }),
                error: null,
                blockedSource: workspace.untrustedSource,
            };
        }
    }
    dependencies.emit({
        type: "workspace_setup_status_response",
        payload: {
            requestId: request.requestId,
            workspaceId,
            snapshot,
        },
    });
}
export async function handleWorkspaceSetupRunRequest(dependencies, request) {
    try {
        const workspace = await dependencies.getWorkspace(request.workspaceId);
        if (!workspace || workspace.archivedAt) {
            throw new Error(`Workspace not found: ${request.workspaceId}`);
        }
        const started = await dependencies.clearAutomationBlock(request.workspaceId);
        if (started) {
            const worktree = {
                worktreePath: workspace.worktreeRoot ?? workspace.cwd,
                branchName: workspace.branch ?? "",
            };
            dependencies.startWorkspaceSetup(request.workspaceId, (signal) => runWorktreeSetupInBackground(dependencies, {
                requestCwd: workspace.cwd,
                repoRoot: workspace.mainRepoRoot ?? workspace.cwd,
                workspaceId: workspace.workspaceId,
                worktree,
                shouldBootstrap: true,
                slug: basename(worktree.worktreePath),
                worktreePath: worktree.worktreePath,
                workspaceCwd: workspace.cwd,
                runAutoTerminals: true,
            }, signal));
            await dependencies.emitWorkspaceUpdateForWorkspaceId(request.workspaceId);
        }
        dependencies.emit({
            type: "workspace.setup.run.response",
            payload: {
                requestId: request.requestId,
                workspaceId: request.workspaceId,
                started,
                error: null,
            },
        });
    }
    catch (error) {
        dependencies.emit({
            type: "workspace.setup.run.response",
            payload: {
                requestId: request.requestId,
                workspaceId: request.workspaceId,
                started: false,
                error: error instanceof Error ? error.message : "Failed to run workspace setup",
            },
        });
    }
}
export async function runWorktreeSetupInBackground(dependencies, options, signal) {
    let worktree = options.worktree;
    let setupResults = [];
    const progressAccumulator = createWorktreeSetupProgressAccumulator();
    const workspaceId = options.workspaceId;
    const emitSetupProgress = (status, error) => {
        const snapshot = {
            status,
            detail: buildWorktreeSetupDetail({
                worktree,
                results: status === "running"
                    ? getWorktreeSetupProgressResults(progressAccumulator)
                    : setupResults,
                outputAccumulatorsByIndex: progressAccumulator.outputAccumulatorsByIndex,
            }),
            error,
        };
        dependencies.cacheWorkspaceSetupSnapshot(workspaceId, snapshot);
        dependencies.emit({
            type: "workspace_setup_progress",
            payload: {
                workspaceId,
                ...snapshot,
            },
        });
    };
    try {
        try {
            emitSetupProgress("running", null);
            if (!options.shouldBootstrap) {
                emitSetupProgress("completed", null);
            }
            else {
                const workspaceCwd = options.workspaceCwd ?? worktree.worktreePath;
                const setupCommands = getWorktreeSetupCommands(workspaceCwd);
                if (setupCommands.length === 0) {
                    emitSetupProgress("completed", null);
                }
                else {
                    const runtimeEnv = await resolveWorktreeRuntimeEnv({
                        worktreePath: worktree.worktreePath,
                        branchName: worktree.branchName,
                        repoRootPath: options.repoRoot,
                    });
                    dependencies.terminalManager?.registerCwdEnv({
                        cwd: workspaceCwd,
                        env: runtimeEnv,
                    });
                    setupResults = await runWorktreeSetupCommands({
                        worktreePath: workspaceCwd,
                        branchName: worktree.branchName,
                        cleanupOnFailure: false,
                        repoRootPath: options.repoRoot,
                        runtimeEnv,
                        signal,
                        onEvent: (event) => {
                            applyWorktreeSetupProgressEvent(progressAccumulator, event);
                            emitSetupProgress("running", null);
                        },
                    });
                    emitSetupProgress("completed", null);
                }
                if (options.runAutoTerminals) {
                    await runWorktreeAutoTerminals({
                        workspaceId,
                        worktree,
                        workspaceCwd,
                        terminalManager: dependencies.terminalManager,
                        logger: dependencies.sessionLogger,
                    });
                }
            }
        }
        catch (error) {
            if (error instanceof WorktreeSetupError) {
                setupResults = error.results;
            }
            const message = error instanceof Error ? error.message : String(error);
            emitSetupProgress("failed", message);
            dependencies.sessionLogger.error({
                err: error,
                cwd: options.requestCwd,
                repoRoot: options.repoRoot,
                worktreeSlug: worktree.branchName,
                worktreePath: worktree.worktreePath,
            }, "Background worktree setup failed");
            return;
        }
    }
    finally {
        await dependencies.emitWorkspaceUpdateForWorkspaceId(options.workspaceId);
    }
}
//# sourceMappingURL=worktree-session.js.map