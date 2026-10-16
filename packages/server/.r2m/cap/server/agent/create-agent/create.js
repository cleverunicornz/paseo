import { expandUserPath, resolvePathFromBase } from "../../path-utils.js";
import { toWorktreeRequestError } from "../../worktree-errors.js";
import { setupFinishNotification, startCreatedAgentInitialPrompt } from "../agent-prompt.js";
import { resolveCreateAgentTitles } from "../create-agent-title.js";
import { buildAgentPrompt } from "../prompt-attachments.js";
import { normalizeClientMessageId, resolveClientMessageId } from "../../client-message-id.js";
import { resolveRequiredProviderModel } from "../mcp-shared.js";
import { appendTimelineItemIfAgentKnown, emitLiveTimelineItemIfAgentKnown, } from "../timeline-append.js";
import { resolveCreateAgentIntent } from "./intent.js";
function requireResolvedWorkspaceId(workspaceId) {
    if (!workspaceId) {
        throw new Error("createAgentCommand requires a resolved workspaceId");
    }
    return workspaceId;
}
export function formatProviderModel(provider, model) {
    if (!model || provider.includes("/")) {
        return provider;
    }
    return `${provider}/${model}`;
}
function resolveProviderModel(providerValue) {
    const providerInput = providerValue.trim();
    if (providerInput.includes("/")) {
        return resolveRequiredProviderModel(providerInput);
    }
    if (!providerInput) {
        throw new Error("provider is required");
    }
    return { provider: providerInput, model: undefined };
}
export async function createAgentCommand(dependencies, input) {
    const resolved = input.kind === "session"
        ? await resolveSessionCreateAgent(dependencies, input)
        : await resolveMcpCreateAgent(dependencies, input);
    const snapshot = await dependencies.agentManager.createAgent(resolved.config, input.kind === "session" ? input.agentId : undefined, resolved.createOptions);
    resolved.setupContinuation?.startAfterAgentCreate({
        agentId: snapshot.id,
    });
    if (input.kind === "session")
        await input.onAgentReady?.(snapshot);
    let liveSnapshot = snapshot;
    let initialPromptStarted = false;
    let initialPromptError = null;
    if (input.kind === "mcp") {
        input.onCreated?.({ agentId: snapshot.id, createdWorktree: resolved.createdWorktree ?? null });
    }
    if (resolved.prompt !== undefined) {
        const sendResult = await sendInitialPrompt(dependencies, resolved, snapshot);
        initialPromptStarted = sendResult.started;
        liveSnapshot = sendResult.liveSnapshot;
        initialPromptError = sendResult.error ?? null;
    }
    if (input.kind === "mcp" && input.notifyOnFinish && input.callerAgentId && initialPromptStarted) {
        setupFinishNotification({
            agentManager: dependencies.agentManager,
            agentStorage: dependencies.agentStorage,
            childAgentId: snapshot.id,
            callerAgentId: input.callerAgentId,
            requireParentOwnership: true,
            logger: dependencies.logger,
        });
    }
    return {
        snapshot,
        liveSnapshot,
        background: resolved.background,
        initialPromptStarted,
        initialPromptError,
        ...(resolved.createdWorktree ? { createdWorktree: resolved.createdWorktree } : {}),
    };
}
async function resolveSessionCreateAgent(dependencies, input) {
    const trimmedPrompt = input.initialPrompt?.trim();
    const { sessionConfig: builtSessionConfig, setupContinuation, createdWorkspaceId, } = await input.buildSessionConfig(input.config, input.git, input.worktreeName, input.firstAgentContext);
    // Validate the requested mode against the provider's modes for the resolved
    // cwd. The app remembers mode preferences globally, so a saved mode can be
    // stale for a workspace whose provider config no longer defines it — reject
    // it here instead of letting the provider fail mid-turn.
    //
    // This runs after buildSessionConfig, which may already have created a
    // worktree and/or workspace record — cwd (required to resolve modes) is
    // only known once that step completes. If validation throws, any
    // worktree/workspace buildSessionConfig created is the caller's
    // responsibility to clean up (session.ts's handleCreateAgentRequest does
    // this for the worktree path via cleanupCreatedWorktreeAfterFailedAgentCreate;
    // this is a pre-existing gap for directory-only workspace creates, not
    // introduced by this validation).
    const resolvedCreateConfig = await dependencies.providerSnapshotManager.resolveCreateConfig({
        cwd: builtSessionConfig.cwd,
        provider: builtSessionConfig.provider,
        requestedMode: builtSessionConfig.modeId,
        featureValues: builtSessionConfig.featureValues,
        parent: null,
        unattended: false,
    });
    const sessionConfig = {
        ...builtSessionConfig,
        modeId: resolvedCreateConfig.modeId,
        featureValues: resolvedCreateConfig.featureValues,
    };
    const prompt = buildAgentPrompt(trimmedPrompt ?? "", input.images, input.attachments);
    const hasPromptContent = Array.isArray(prompt) ? prompt.length > 0 : prompt.length > 0;
    const clientMessageId = normalizeClientMessageId(input.clientMessageId);
    const runOptions = input.outputSchema || clientMessageId
        ? {
            ...(input.outputSchema ? { outputSchema: input.outputSchema } : {}),
            ...(clientMessageId ? { clientMessageId } : {}),
        }
        : undefined;
    const workspaceId = setupContinuation ? createdWorkspaceId : input.workspaceId;
    return {
        config: sessionConfig,
        createOptions: {
            labels: input.labels,
            initialPrompt: trimmedPrompt,
            env: input.env,
            initialTitle: input.provisionalTitle,
            // A legacy git/worktreeName worktree creates a fresh workspace, so the
            // agent belongs to that workspace, not the source one. createdWorkspaceId
            // is the freshly created worktree's workspace.
            workspaceId: requireResolvedWorkspaceId(workspaceId),
        },
        prompt: hasPromptContent ? prompt : undefined,
        runOptions,
        setupContinuation,
        background: true,
        promptFailure: "throw",
        promptLogger: dependencies.logger.child({
            clientMessageId: resolveClientMessageId(input.clientMessageId),
        }),
    };
}
async function resolveMcpCreateAgent(dependencies, input) {
    const resolvedProviderModel = resolveProviderModel(input.provider);
    const provider = resolvedProviderModel.provider;
    const parentAgent = input.callerAgentId
        ? requireParentAgent(dependencies.agentManager, input.callerAgentId)
        : null;
    const cwd = resolveMcpInitialCwd(input, parentAgent);
    const { resolvedCwd, setupContinuation, createdWorkspaceId, createdWorktree } = await resolveMcpCwd({
        dependencies,
        cwd,
        worktree: input.worktree,
        initialPrompt: input.initialPrompt ?? "",
    });
    if (createdWorktree)
        input.onWorktreeCreated?.(createdWorktree);
    const intent = await resolveCreateAgentIntent({
        explicitWorkspaceId: setupContinuation ? createdWorkspaceId : input.workspaceId,
        caller: parentAgent
            ? { id: parentAgent.id, cwd: parentAgent.cwd, workspaceId: parentAgent.workspaceId }
            : null,
        labels: input.labels,
        childAgentDefaultLabels: input.callerContext?.childAgentDefaultLabels,
        legacyDetached: input.detached ?? false,
        resolveWorkspace: async (workspaceId) => ({ workspaceId, cwd: resolvedCwd }),
        createWorkspace: async () => ({
            workspaceId: requireResolvedWorkspaceId(await ensureWorkspaceForMcpCreate(dependencies, resolvedCwd, input.initialPrompt ?? "")),
            cwd: resolvedCwd,
        }),
    });
    const resolvedCreateConfig = await resolveMcpProviderCreateConfig({
        dependencies,
        input,
        provider,
        resolvedCwd,
        parentAgent,
    });
    const trimmedPrompt = input.initialPrompt?.trim() ?? "";
    return {
        config: buildMcpSessionConfig({
            input,
            resolvedProviderModel,
            provider,
            resolvedCwd: intent.cwd,
            trimmedPrompt,
            resolvedMode: resolvedCreateConfig.modeId,
            resolvedFeatures: resolvedCreateConfig.featureValues,
        }),
        createOptions: {
            ...(Object.keys(intent.labels).length > 0 ? { labels: intent.labels } : {}),
            workspaceId: intent.workspaceId,
            owner: input.owner,
            env: input.env,
        },
        prompt: trimmedPrompt ? trimmedPrompt : undefined,
        setupContinuation,
        createdWorktree,
        background: input.background,
        promptFailure: input.promptFailure ?? "log",
    };
}
function resolveMcpInitialCwd(input, parentAgent) {
    if (!parentAgent) {
        return expandUserPath(input.cwd ?? process.cwd());
    }
    return resolveChildAgentCwd({
        parentCwd: parentAgent.cwd,
        requestedCwd: input.cwd,
        lockedCwd: input.callerContext?.lockedCwd,
        allowCustomCwd: input.callerContext?.allowCustomCwd ?? true,
    });
}
async function resolveMcpProviderCreateConfig(params) {
    const passthroughConfig = params.input.config;
    return params.dependencies.providerSnapshotManager.resolveCreateConfig({
        cwd: params.resolvedCwd,
        provider: params.provider,
        requestedMode: params.input.mode ?? passthroughConfig?.modeId,
        featureValues: params.input.features ?? passthroughConfig?.featureValues,
        parent: params.parentAgent,
        unattended: params.input.unattended ?? false,
    });
}
function buildMcpSessionConfig(params) {
    const passthroughConfig = params.input.config;
    const { provisionalTitle } = resolveCreateAgentTitles({
        configTitle: passthroughConfig?.title ?? params.input.title,
        initialPrompt: params.trimmedPrompt,
    });
    const featureValues = params.resolvedFeatures ?? passthroughConfig?.featureValues;
    const config = {
        ...passthroughConfig,
        provider: params.provider,
        cwd: params.resolvedCwd,
        modeId: params.resolvedMode ?? passthroughConfig?.modeId,
        model: params.resolvedProviderModel.model ?? passthroughConfig?.model,
        thinkingOptionId: params.input.thinking ?? passthroughConfig?.thinkingOptionId,
        internal: params.input.internal ?? passthroughConfig?.internal,
    };
    if (provisionalTitle) {
        config.title = provisionalTitle;
    }
    if (featureValues) {
        config.featureValues = featureValues;
    }
    return config;
}
async function ensureWorkspaceForMcpCreate(dependencies, cwd, initialPrompt) {
    if (!dependencies.ensureWorkspaceForCreate) {
        return undefined;
    }
    return dependencies.ensureWorkspaceForCreate(cwd, { prompt: initialPrompt });
}
async function sendInitialPrompt(dependencies, resolved, snapshot) {
    try {
        const prompt = resolved.prompt;
        if (prompt === undefined) {
            return { started: false, liveSnapshot: snapshot };
        }
        const liveSnapshot = await startCreatedAgentInitialPrompt({
            agentManager: dependencies.agentManager,
            agentId: snapshot.id,
            snapshot,
            prompt,
            runOptions: resolved.runOptions,
            logger: resolved.promptLogger ?? dependencies.logger,
        });
        return { started: true, liveSnapshot };
    }
    catch (error) {
        if (resolved.promptFailure === "throw") {
            throw error;
        }
        if (resolved.promptFailure === "return-error") {
            return { started: false, liveSnapshot: snapshot, error };
        }
        dependencies.logger.error({ err: error, agentId: snapshot.id }, "Failed to run initial prompt");
        return { started: false, liveSnapshot: snapshot };
    }
}
function requireParentAgent(agentManager, parentAgentId) {
    const parentAgent = agentManager.getAgent(parentAgentId);
    if (!parentAgent) {
        throw new Error(`Parent agent ${parentAgentId} not found`);
    }
    return parentAgent;
}
function resolveChildAgentCwd(params) {
    const lockedCwd = params.lockedCwd?.trim();
    if (lockedCwd) {
        return expandUserPath(lockedCwd);
    }
    const requestedCwd = params.requestedCwd?.trim();
    if (!requestedCwd || !params.allowCustomCwd) {
        return params.parentCwd;
    }
    return resolvePathFromBase(params.parentCwd, requestedCwd);
}
async function resolveMcpCwd(params) {
    const { dependencies, worktree } = params;
    if (!worktree) {
        return { resolvedCwd: params.cwd };
    }
    const shouldCreateWorktree = Boolean(worktree.worktreeName || worktree.refName || worktree.action || worktree.githubPrNumber);
    if (!shouldCreateWorktree) {
        return { resolvedCwd: params.cwd };
    }
    if (worktree.worktreeName &&
        !worktree.baseBranch &&
        !worktree.refName &&
        !worktree.action &&
        worktree.githubPrNumber === undefined) {
        throw new Error("baseBranch is required when creating a worktree");
    }
    const baseBranch = worktree.baseBranch;
    const createdWorktree = await createMcpWorktree({
        input: {
            cwd: params.cwd,
            worktreeSlug: worktree.worktreeName,
            branchName: worktree.branchName,
            refName: worktree.refName,
            action: worktree.action,
            githubPrNumber: worktree.githubPrNumber,
            firstAgentContext: { prompt: params.initialPrompt },
            runSetup: false,
            paseoHome: dependencies.paseoHome,
            worktreesRoot: dependencies.worktreesRoot,
        },
        createPaseoWorktree: dependencies.createPaseoWorktree,
        resolveDefaultBranch: baseBranch ? async () => baseBranch : undefined,
        setupContinuation: {
            kind: "agent",
            terminalManager: dependencies.terminalManager ?? null,
            appendTimelineItem: ({ agentId, item }) => appendTimelineItemIfAgentKnown({
                agentManager: dependencies.agentManager,
                agentId,
                item,
            }),
            emitLiveTimelineItem: ({ agentId, item }) => emitLiveTimelineItemIfAgentKnown({
                agentManager: dependencies.agentManager,
                agentId,
                item,
            }),
            logger: dependencies.logger,
        },
    });
    return {
        resolvedCwd: createdWorktree.workspace.cwd,
        setupContinuation: createdWorktree.setupContinuation,
        createdWorkspaceId: createdWorktree.workspace.workspaceId,
        createdWorktree,
    };
}
async function createMcpWorktree(options) {
    try {
        if (!options.createPaseoWorktree) {
            throw new Error("Paseo worktree service is not configured");
        }
        return await options.createPaseoWorktree(options.input, {
            ...(options.resolveDefaultBranch
                ? { resolveDefaultBranch: options.resolveDefaultBranch }
                : {}),
            ...(options.setupContinuation ? { setupContinuation: options.setupContinuation } : {}),
        });
    }
    catch (error) {
        throw toWorktreeRequestError(error);
    }
}
//# sourceMappingURL=create.js.map