import type pino from "pino";
import type { ForgeService } from "../../services/forge-service.js";
import { type ActiveWorkspaceRef } from "../workspace-archive-service.js";
import type { CreatePaseoWorktreeWorkflowFn, CreatePaseoWorktreeWorkflowResult } from "../worktree-session.js";
import type { WorkspaceGitService } from "../workspace-git-service.js";
import type { CreateAgentWorktreeTarget, FirstAgentContext, SessionOutboundMessage } from "../messages.js";
import type { AgentManager, AgentSubscriber, SubscribeOptions } from "./agent-manager.js";
import type { AgentStorage } from "./agent-storage.js";
interface CreateAgentLifecycleDispatchDependencies {
    paseoHome: string;
    worktreesRoot?: string;
    agentManager: AgentManager;
    agentStorage: AgentStorage;
    github: ForgeService;
    workspaceGitService: WorkspaceGitService;
    createPaseoWorktreeWorkflow: CreatePaseoWorktreeWorkflowFn;
    archiveAgentForClose: (agentId: string) => Promise<unknown>;
    findWorkspaceIdForCwd: (cwd: string) => Promise<string | null>;
    listActiveWorkspaces: () => Promise<ActiveWorkspaceRef[]>;
    archiveWorkspaceRecord: (workspaceId: string) => Promise<void>;
    emit: (message: SessionOutboundMessage) => void;
    emitAgentRemove: (agentId: string) => Promise<void>;
    emitWorkspaceUpdatesForWorkspaceIds: (workspaceIds: Iterable<string>) => Promise<void>;
    markWorkspaceArchiving: (workspaceIds: Iterable<string>, archivingAt: string) => void;
    clearWorkspaceArchiving: (workspaceIds: Iterable<string>) => void;
    killTerminalsForWorkspace: (workspaceId: string) => Promise<void>;
    logger: pino.Logger;
}
export interface LifecycleRegistration {
    cancel(): Promise<void>;
}
interface AgentLifecycleEvents {
    subscribe(callback: AgentSubscriber, options?: SubscribeOptions): () => void;
}
export declare class CreateAgentLifecycleDispatch {
    private readonly dependencies;
    private readonly autoArchiveAgentIds;
    constructor(dependencies: CreateAgentLifecycleDispatchDependencies);
    createWorktreeForRequest(input: {
        cwd: string;
        target: CreateAgentWorktreeTarget | undefined;
        firstAgentContext: FirstAgentContext;
        hasLegacyGitOptions: boolean;
    }): Promise<CreatePaseoWorktreeWorkflowResult | null>;
    registerAutoArchiveIfRequested(input: {
        autoArchive: boolean | undefined;
        agentId: string;
        createdWorktree: CreatePaseoWorktreeWorkflowResult | null;
    }): LifecycleRegistration;
    cleanupCreatedWorktreeAfterFailedAgentCreate(input: {
        createdWorktree: CreatePaseoWorktreeWorkflowResult | null;
        createdAgentId: string | null;
    }): Promise<void>;
    private createWorktreeForTarget;
    private registerAutoArchiveOnTerminalState;
    private autoArchiveAgentOnce;
    private archiveAutoCreatedWorktree;
}
export declare function registerAgentAutoArchive(input: {
    agentManager: AgentLifecycleEvents;
    agentId: string;
    archive: () => Promise<unknown>;
}): LifecycleRegistration;
export {};
//# sourceMappingURL=create-agent-lifecycle-dispatch.d.ts.map