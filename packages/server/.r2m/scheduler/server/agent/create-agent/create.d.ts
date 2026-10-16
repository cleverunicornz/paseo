import type { Logger } from "pino";
import type { TerminalManager } from "../../../terminal/terminal-manager.js";
import type { AgentWorktreeSetupContinuation, CreatePaseoWorktreeWorkflowFn, CreatePaseoWorktreeWorkflowResult } from "../../worktree-session.js";
import type { AgentAttachment, FirstAgentContext, GitSetupOptions } from "../../messages.js";
import type { AgentManager, ManagedAgent } from "../agent-manager.js";
import type { AgentSessionConfig } from "../agent-sdk-types.js";
import type { AgentStorage } from "../agent-storage.js";
import type { AgentOwner } from "../agent-owner.js";
import type { ProviderSnapshotManager } from "../provider-snapshot-manager.js";
export interface CreateAgentSessionWorktreeResult {
    sessionConfig: AgentSessionConfig;
    setupContinuation?: AgentWorktreeSetupContinuation;
    createdWorkspaceId?: string;
}
export interface CreateAgentCommandDependencies {
    agentManager: AgentManager;
    agentStorage: AgentStorage;
    logger: Logger;
    paseoHome?: string;
    worktreesRoot?: string;
    terminalManager?: TerminalManager | null;
    providerSnapshotManager: Pick<ProviderSnapshotManager, "resolveCreateConfig">;
    createPaseoWorktree?: CreatePaseoWorktreeWorkflowFn;
    ensureWorkspaceForCreate?: EnsureWorkspaceForCreate;
}
export type EnsureWorkspaceForCreate = (cwd: string, firstAgentContext?: FirstAgentContext) => Promise<string>;
export interface CreateAgentFromSessionInput {
    kind: "session";
    onAgentReady?: (agent: ManagedAgent) => Promise<void>;
    agentId?: string;
    config: AgentSessionConfig;
    workspaceId: string;
    worktreeName?: string;
    initialPrompt?: string;
    clientMessageId?: string;
    outputSchema?: Record<string, unknown>;
    images?: Array<{
        data: string;
        mimeType: string;
    }>;
    attachments?: AgentAttachment[];
    git?: GitSetupOptions;
    labels: Record<string, string>;
    env?: Record<string, string>;
    provisionalTitle: string | null;
    firstAgentContext: FirstAgentContext;
    buildSessionConfig: (config: AgentSessionConfig, gitOptions?: GitSetupOptions, legacyWorktreeName?: string, firstAgentContext?: FirstAgentContext) => Promise<CreateAgentSessionWorktreeResult>;
}
export interface CreateAgentFromMcpInput {
    kind: "mcp";
    provider: string;
    title: string;
    initialPrompt?: string;
    config?: Partial<AgentSessionConfig>;
    cwd?: string;
    workspaceId?: string;
    thinking?: string;
    features?: Record<string, unknown>;
    labels?: Record<string, string>;
    mode?: string;
    unattended?: boolean;
    promptFailure?: CreateAgentPromptFailureMode;
    background: boolean;
    notifyOnFinish: boolean;
    internal?: boolean;
    detached?: boolean;
    owner?: AgentOwner;
    env?: Record<string, string>;
    onCreated?: (created: {
        agentId: string;
        createdWorktree: CreatePaseoWorktreeWorkflowResult | null;
    }) => void;
    onWorktreeCreated?: (createdWorktree: CreatePaseoWorktreeWorkflowResult) => void;
    callerAgentId?: string;
    callerContext?: {
        lockedCwd?: string;
        allowCustomCwd?: boolean;
        childAgentDefaultLabels?: Record<string, string>;
    } | null;
    worktree?: {
        worktreeName?: string;
        branchName?: string;
        baseBranch?: string;
        refName?: string;
        action?: "branch-off" | "checkout";
        githubPrNumber?: number;
    };
}
export type CreateAgentCommandInput = CreateAgentFromSessionInput | CreateAgentFromMcpInput;
export type CreateAgentPromptFailureMode = "throw" | "log" | "return-error";
export interface CreateAgentCommandResult {
    snapshot: ManagedAgent;
    liveSnapshot: ManagedAgent;
    background: boolean;
    initialPromptStarted: boolean;
    initialPromptError: unknown | null;
    createdWorktree?: CreatePaseoWorktreeWorkflowResult;
}
export type BoundCreateAgentCommand = (input: CreateAgentCommandInput) => Promise<CreateAgentCommandResult>;
export declare function formatProviderModel(provider: string, model: string | null | undefined): string;
export declare function createAgentCommand(dependencies: CreateAgentCommandDependencies, input: CreateAgentCommandInput): Promise<CreateAgentCommandResult>;
//# sourceMappingURL=create.d.ts.map