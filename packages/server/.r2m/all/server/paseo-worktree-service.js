import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { getRealpathAwareRelativePath } from "../utils/path.js";
import { createWorktreeCore, } from "./worktree-core.js";
import { mapWorkspaceRelativeCwdToWorktree, rollbackCreatedPaseoWorktree, seedPaseoConfigFile, validateBranchSlug, } from "../utils/worktree.js";
import { getCurrentBranch, localBranchExists, renameCurrentBranch } from "../utils/checkout-git.js";
import { markPaseoWorktreeFirstAgentBranchAutoNameAttempted, readPaseoWorktreeMetadata, writePaseoWorktreeFirstAgentBranchAutoNameMetadata, } from "../utils/worktree-metadata.js";
import { resolveFirstAgentPromptTitle } from "./agent/create-agent-title.js";
import { buildAgentBranchNameSeed } from "./agent/prompt-attachments.js";
import { runWithGitCommandPriority } from "../utils/run-git-command.js";
export async function createPaseoWorktree(input, deps) {
    return runWithGitCommandPriority("high", () => createPaseoWorktreeWithPriority(input, deps));
}
async function createPaseoWorktreeWithPriority(input, deps) {
    const workspaceCwdPlan = await planWorkspaceCwdForWorktree(input.cwd, deps.workspaceGitService);
    const createdWorktree = await createWorktreeCore(input, deps);
    try {
        maybeMarkFirstAgentBranchAutoNameEligible({ createdWorktree });
        const workspaceCwd = mapWorkspaceRelativeCwdToWorktree({
            relativeWorkspaceCwd: workspaceCwdPlan.relativeWorkspaceCwd,
            targetWorktreePath: createdWorktree.worktree.worktreePath,
        });
        if (!(await isDirectory(workspaceCwd))) {
            throw new Error(`Selected project directory is missing from the worktree: ${workspaceCwd}`);
        }
        if (createdWorktree.created) {
            await seedPaseoConfigFile({
                sourceCwd: workspaceCwdPlan.inputCwd,
                targetCwd: workspaceCwd,
            });
        }
        const workspace = await deps.workspaceProvisioning.createWorkspaceForWorktree({
            sourceCwd: workspaceCwdPlan.inputCwd,
            projectId: input.projectId,
            workspaceId: input.workspaceId,
            repoRoot: createdWorktree.repoRoot,
            cwd: workspaceCwd,
            worktreeRoot: createdWorktree.worktree.worktreePath,
            branch: createdWorktree.worktree.branchName || null,
            baseBranch: createdWorktree.worktree.comparisonBaseRef,
            title: input.title?.trim() || resolveFirstAgentPromptTitle(input.firstAgentContext),
            expectsInitialAgent: Boolean(input.firstAgentContext),
            ...(createdWorktree.intent.kind === "checkout-change-request" &&
                createdWorktree.intent.headRepository
                ? {
                    untrustedSource: {
                        kind: "change_request",
                        forge: createdWorktree.intent.forge,
                        number: createdWorktree.intent.changeRequestNumber,
                        headRepository: createdWorktree.intent.headRepository,
                    },
                }
                : {}),
        });
        deps.github.invalidate({ cwd: createdWorktree.worktree.worktreePath });
        return {
            worktree: createdWorktree.worktree,
            intent: createdWorktree.intent,
            workspace,
            repoRoot: createdWorktree.repoRoot,
            created: createdWorktree.created,
        };
    }
    catch (error) {
        if (!createdWorktree.created) {
            throw error;
        }
        return rollbackCreatedPaseoWorktree({
            cwd: createdWorktree.repoRoot,
            worktreePath: createdWorktree.worktree.worktreePath,
            ...(input.runSetup === false ? { teardownCwds: [] } : {}),
            paseoHome: input.paseoHome,
            worktreesBaseRoot: input.worktreesRoot,
        }, error);
    }
}
async function isDirectory(targetPath) {
    try {
        return (await stat(targetPath)).isDirectory();
    }
    catch {
        return false;
    }
}
async function planWorkspaceCwdForWorktree(inputCwd, workspaceGitService) {
    const normalizedInputCwd = resolve(inputCwd);
    const sourceCheckout = await workspaceGitService.getCheckout(normalizedInputCwd);
    const sourceWorktreePath = sourceCheckout.worktreeRoot ?? normalizedInputCwd;
    const relativeWorkspaceCwd = getRealpathAwareRelativePath(sourceWorktreePath, normalizedInputCwd);
    if (relativeWorkspaceCwd === null) {
        throw new Error(`Workspace cwd is outside its source worktree: ${normalizedInputCwd}`);
    }
    return { inputCwd: normalizedInputCwd, relativeWorkspaceCwd };
}
export async function attemptFirstAgentBranchAutoName(options) {
    const firstAgentContext = options.firstAgentContext;
    if (!firstAgentContext || !buildAgentBranchNameSeed(firstAgentContext)) {
        return { attempted: false, renamed: false, branchName: null };
    }
    let metadata;
    try {
        metadata = readPaseoWorktreeMetadata(options.cwd);
    }
    catch {
        return { attempted: false, renamed: false, branchName: null };
    }
    if (!metadata ||
        metadata.version !== 2 ||
        metadata.firstAgentBranchAutoName?.status !== "pending") {
        return { attempted: false, renamed: false, branchName: null };
    }
    const getCurrentBranchImpl = options.getCurrentBranch ?? getCurrentBranch;
    const placeholderBranchName = metadata.firstAgentBranchAutoName.placeholderBranchName;
    if ((await getCurrentBranchImpl(options.cwd)) !== placeholderBranchName) {
        markPaseoWorktreeFirstAgentBranchAutoNameAttempted(options.cwd);
        return { attempted: true, renamed: false, branchName: null };
    }
    markPaseoWorktreeFirstAgentBranchAutoNameAttempted(options.cwd);
    const branchName = await options.generateBranchNameFromContext({
        cwd: options.cwd,
        firstAgentContext,
    });
    if (!branchName) {
        return { attempted: true, renamed: false, branchName: null };
    }
    const validation = validateBranchSlug(branchName);
    if (!validation.valid || branchName === placeholderBranchName) {
        return { attempted: true, renamed: false, branchName: null };
    }
    if ((await getCurrentBranchImpl(options.cwd)) !== placeholderBranchName) {
        return { attempted: true, renamed: false, branchName: null };
    }
    const localBranchExistsImpl = options.localBranchExists ?? localBranchExists;
    const targetName = await findAvailableBranchName({
        cwd: options.cwd,
        desiredName: branchName,
        placeholderBranchName,
        localBranchExists: localBranchExistsImpl,
    });
    if (!targetName) {
        return { attempted: true, renamed: false, branchName: null };
    }
    const renameCurrentBranchImpl = options.renameCurrentBranch ?? renameCurrentBranch;
    const renamedBranch = await renameCurrentBranchImpl(options.cwd, targetName);
    return {
        attempted: true,
        renamed: true,
        branchName: renamedBranch.currentBranch ?? targetName,
    };
}
const MAX_BRANCH_NAME_SUFFIX_ATTEMPTS = 50;
async function findAvailableBranchName(options) {
    const { cwd, desiredName, placeholderBranchName } = options;
    if (!(await options.localBranchExists(cwd, desiredName))) {
        return desiredName;
    }
    for (let suffix = 2; suffix <= MAX_BRANCH_NAME_SUFFIX_ATTEMPTS; suffix++) {
        const candidate = `${desiredName}-${suffix}`;
        if (candidate === placeholderBranchName) {
            continue;
        }
        if (!(await options.localBranchExists(cwd, candidate))) {
            return candidate;
        }
    }
    return null;
}
function maybeMarkFirstAgentBranchAutoNameEligible(options) {
    const { createdWorktree } = options;
    if (!createdWorktree.created || createdWorktree.intent.kind !== "branch-off") {
        return;
    }
    writePaseoWorktreeFirstAgentBranchAutoNameMetadata(createdWorktree.worktree.worktreePath, {
        placeholderBranchName: createdWorktree.worktree.branchName,
    });
}
//# sourceMappingURL=paseo-worktree-service.js.map