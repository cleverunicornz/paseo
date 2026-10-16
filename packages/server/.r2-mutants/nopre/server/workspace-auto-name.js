import { resolveFirstAgentPromptTitle } from "./agent/create-agent-title.js";
import { attemptFirstAgentBranchAutoName, } from "./paseo-worktree-service.js";
import { generateBranchNameFromFirstAgentContext, } from "./worktree-branch-name-generator.js";
export class WorkspaceAutoName {
    constructor(options) {
        this.agentManager = options.agentManager;
        this.workspaceRegistry = options.workspaceRegistry;
        this.workspaceGitService = options.workspaceGitService;
        this.providerSnapshotManager = options.providerSnapshotManager;
        this.readDaemonConfig = options.readDaemonConfig;
        this.gitMutation = options.gitMutation;
        this.emitWorkspaceUpdateForCwd = options.emitWorkspaceUpdateForCwd;
        this.emitWorkspaceUpdateForWorkspaceId = options.emitWorkspaceUpdateForWorkspaceId;
        this.logger = options.logger;
        this.generateWorkspaceName =
            options.generateWorkspaceName ?? generateBranchNameFromFirstAgentContext;
    }
    scheduleForWorktree(input, context = {}) {
        this.schedule(() => this.maybeAutoNameWorkspaceBranchForFirstAgent({
            ...input,
            currentSelection: context.currentSelection ?? null,
        }), {
            cwd: input.workspace.cwd,
            message: "Failed to auto-name worktree branch",
        });
    }
    scheduleForDirectory(input, context = {}) {
        this.schedule(() => this.maybeAutoNameDirectoryWorkspaceTitle({
            ...input,
            currentSelection: context.currentSelection ?? null,
        }), { cwd: input.cwd, message: "Failed to auto-name directory workspace title" });
    }
    async maybeAutoNameWorkspaceBranchForFirstAgent(input) {
        const worktreeRoot = input.workspace.worktreeRoot ?? input.workspace.cwd;
        let generated = null;
        const result = await attemptFirstAgentBranchAutoName({
            cwd: worktreeRoot,
            firstAgentContext: input.firstAgentContext,
            generateBranchNameFromContext: ({ firstAgentContext }) => {
                return this.generateFromContext({
                    cwd: input.workspace.cwd,
                    firstAgentContext,
                    currentSelection: input.currentSelection,
                }).then((nextGenerated) => {
                    generated = nextGenerated;
                    return nextGenerated?.branch ?? null;
                });
            },
        });
        if (!generated) {
            generated = await this.generateFromContext({
                cwd: input.workspace.cwd,
                firstAgentContext: input.firstAgentContext,
                currentSelection: input.currentSelection,
            });
        }
        const generatedTitle = generated?.title ?? null;
        if (!generatedTitle) {
            return;
        }
        // K4: re-read from the registry before writing so any concurrent upsert
        // that happened between workspace creation and this async path is not clobbered.
        // When the first-agent rename changed the git branch too, persist that branch
        // alongside the title — both are this path's own fields.
        await this.applyGeneratedWorkspaceTitle(input.workspace.workspaceId, {
            title: generatedTitle,
            ...(result.renamed ? { branch: result.branchName } : {}),
            promptTitle: resolveFirstAgentPromptTitle(input.firstAgentContext),
        });
        if (result.renamed) {
            await this.gitMutation.notifyGitMutation(worktreeRoot, "rename-branch");
        }
        await this.emitWorkspaceUpdateForCwd(input.workspace.cwd);
    }
    async maybeAutoNameDirectoryWorkspaceTitle(input) {
        const generated = await this.generateFromContext({
            cwd: input.cwd,
            firstAgentContext: input.firstAgentContext,
            currentSelection: input.currentSelection,
        });
        const title = generated?.title ?? null;
        if (!title) {
            return;
        }
        // K4: applyGeneratedWorkspaceTitle re-reads from the registry before writing.
        // Directory workspaces have no branch — write only the title.
        await this.applyGeneratedWorkspaceTitle(input.workspaceId, {
            title,
            promptTitle: resolveFirstAgentPromptTitle(input.firstAgentContext),
        });
        await this.emitWorkspaceUpdateForWorkspaceId(input.workspaceId);
    }
    async applyGeneratedWorkspaceTitle(workspaceId, input) {
        await this.workspaceRegistry.update(workspaceId, (current) => {
            let title = current.title;
            if (!title || (input.promptTitle && title === input.promptTitle)) {
                title = input.title;
            }
            return {
                ...current,
                title,
                ...(input.branch ? { branch: input.branch } : {}),
                updatedAt: new Date().toISOString(),
            };
        });
    }
    generateFromContext(input) {
        return this.generateWorkspaceName({
            agentManager: this.agentManager,
            cwd: input.cwd,
            workspaceGitService: this.workspaceGitService,
            providerSnapshotManager: this.providerSnapshotManager,
            daemonConfig: this.readDaemonConfig(),
            currentSelection: input.currentSelection ?? undefined,
            firstAgentContext: input.firstAgentContext,
            logger: this.logger,
        });
    }
    schedule(run, context) {
        setTimeout(() => {
            void run().catch((error) => {
                this.logger.warn({ err: error, cwd: context.cwd }, context.message);
            });
        }, 0);
    }
}
//# sourceMappingURL=workspace-auto-name.js.map