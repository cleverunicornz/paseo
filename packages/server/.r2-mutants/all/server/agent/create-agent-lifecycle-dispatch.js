import { randomUUID } from "node:crypto";
import { isPaseoOwnedWorktreeCwd } from "../../utils/worktree.js";
import { archiveByScope } from "../workspace-archive-service.js";
const inactiveRegistration = { cancel: async () => undefined };
export class CreateAgentLifecycleDispatch {
    constructor(dependencies) {
        this.dependencies = dependencies;
        this.autoArchiveAgentIds = new Set();
    }
    async createWorktreeForRequest(input) {
        if (input.target && input.hasLegacyGitOptions) {
            throw new Error("create_agent_request worktree cannot be combined with git options");
        }
        if (!input.target) {
            return null;
        }
        return this.createWorktreeForTarget(input.cwd, input.target, input.firstAgentContext);
    }
    registerAutoArchiveIfRequested(input) {
        if (input.autoArchive !== true) {
            return inactiveRegistration;
        }
        return this.registerAutoArchiveOnTerminalState(input.agentId, toAutoArchiveTarget(input.createdWorktree));
    }
    async cleanupCreatedWorktreeAfterFailedAgentCreate(input) {
        const { createdWorktree, createdAgentId } = input;
        if (!createdWorktree || createdAgentId) {
            return;
        }
        await this.archiveAutoCreatedWorktree({
            agentId: null,
            createdWorktree,
        }).catch((archiveError) => {
            this.dependencies.logger.warn({
                err: archiveError,
                worktreePath: createdWorktree.worktree.worktreePath,
            }, "Failed to clean up worktree after create_agent_request failed");
        });
    }
    async createWorktreeForTarget(cwd, target, firstAgentContext) {
        const baseInput = {
            cwd,
            firstAgentContext,
            runSetup: false,
            paseoHome: this.dependencies.paseoHome,
            worktreesRoot: this.dependencies.worktreesRoot,
        };
        switch (target.mode) {
            case "branch-off":
                return this.dependencies.createPaseoWorktreeWorkflow({
                    ...baseInput,
                    worktreeSlug: target.newBranch,
                    action: "branch-off",
                    ...(target.base ? { refName: target.base } : {}),
                }, target.base ? { resolveDefaultBranch: async () => target.base } : undefined);
            case "checkout-branch":
                return this.dependencies.createPaseoWorktreeWorkflow({
                    ...baseInput,
                    action: "checkout",
                    refName: target.branch,
                });
            case "checkout-pr":
                return this.dependencies.createPaseoWorktreeWorkflow({
                    ...baseInput,
                    action: "checkout",
                    githubPrNumber: target.prNumber,
                });
            default:
                throw new Error("Unsupported create_agent_request worktree target");
        }
    }
    registerAutoArchiveOnTerminalState(agentId, target) {
        return registerAgentAutoArchive({
            agentManager: this.dependencies.agentManager,
            agentId,
            archive: () => this.autoArchiveAgentOnce(agentId, target),
        });
    }
    async autoArchiveAgentOnce(agentId, target) {
        if (this.autoArchiveAgentIds.has(agentId)) {
            return;
        }
        this.autoArchiveAgentIds.add(agentId);
        try {
            if (target.kind === "created-worktree") {
                await this.archiveAutoCreatedWorktree({
                    agentId,
                    createdWorktree: target.result,
                });
                return;
            }
            await this.dependencies.archiveAgentForClose(agentId);
        }
        catch (error) {
            this.dependencies.logger.warn({ err: error, agentId }, "Failed to auto-archive agent");
        }
    }
    async archiveAutoCreatedWorktree(options) {
        const { createdWorktree } = options;
        const worktreePath = createdWorktree.worktree.worktreePath;
        const ownership = await isPaseoOwnedWorktreeCwd(worktreePath, {
            paseoHome: this.dependencies.paseoHome,
            worktreesRoot: this.dependencies.worktreesRoot,
        });
        if (!ownership.allowed) {
            throw new Error("Auto-created worktree is not a Paseo-owned worktree");
        }
        await archiveByScope({
            paseoHome: this.dependencies.paseoHome,
            paseoWorktreesBaseRoot: this.dependencies.worktreesRoot,
            github: this.dependencies.github,
            workspaceGitService: this.dependencies.workspaceGitService,
            agentManager: this.dependencies.agentManager,
            agentStorage: this.dependencies.agentStorage,
            findWorkspaceIdForCwd: this.dependencies.findWorkspaceIdForCwd,
            listActiveWorkspaces: this.dependencies.listActiveWorkspaces,
            archiveWorkspaceRecord: this.dependencies.archiveWorkspaceRecord,
            emitWorkspaceUpdatesForWorkspaceIds: this.dependencies.emitWorkspaceUpdatesForWorkspaceIds,
            markWorkspaceArchiving: this.dependencies.markWorkspaceArchiving,
            clearWorkspaceArchiving: this.dependencies.clearWorkspaceArchiving,
            killTerminalsForWorkspace: this.dependencies.killTerminalsForWorkspace,
            sessionLogger: this.dependencies.logger,
        }, {
            scope: { kind: "workspace", workspaceId: createdWorktree.workspace.workspaceId },
            requestId: randomUUID(),
        });
        if (options.agentId) {
            await this.dependencies.emitAgentRemove(options.agentId);
        }
    }
}
export function registerAgentAutoArchive(input) {
    let unsubscribe = null;
    let archiveTask = null;
    const release = () => {
        if (!unsubscribe)
            return;
        const subscribed = unsubscribe;
        unsubscribe = null;
        subscribed();
    };
    const registration = {
        async cancel() {
            release();
            await archiveTask;
        },
    };
    unsubscribe = input.agentManager.subscribe((event) => {
        if (event.type !== "agent_stream")
            return;
        if (event.event.type !== "turn_completed" &&
            event.event.type !== "turn_failed" &&
            event.event.type !== "turn_canceled") {
            return;
        }
        release();
        archiveTask = input.archive();
    }, { agentId: input.agentId, replayState: false });
    return registration;
}
function toAutoArchiveTarget(createdWorktree) {
    return createdWorktree
        ? { kind: "created-worktree", result: createdWorktree }
        : { kind: "agent-only" };
}
//# sourceMappingURL=create-agent-lifecycle-dispatch.js.map