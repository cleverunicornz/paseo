import type { AgentSnapshotPayload, AgentStreamEventPayload, CreateAgentWorktreeTarget, HubExecutionControlAction } from "@getpaseo/protocol/messages";
import type { ProviderOptions, ToolPolicy } from "@getpaseo/protocol/agent-types";
import type { AgentManager } from "../agent/agent-manager.js";
import type { McpServerConfig } from "../agent/agent-sdk-types.js";
import type { AgentStorage } from "../agent/agent-storage.js";
import type { BoundCreateAgentCommand } from "../agent/create-agent/create.js";
import type { CreatePaseoWorktreeWorkflowResult } from "../worktree-session.js";
export interface HubExecutionAgentCreateInput {
    executionId: string;
    provider: string;
    cwd: string;
    prompt: string;
    model?: string;
    modeId?: string;
    thinkingOptionId?: string;
    featureValues?: Record<string, unknown>;
    providerOptions?: ProviderOptions;
    toolPolicy?: ToolPolicy;
    env?: Record<string, string>;
    mcpServers?: Record<string, McpServerConfig>;
    worktree?: CreateAgentWorktreeTarget;
}
export interface HubExecutionControlInput {
    requestId: string;
    executionId: string;
    action: HubExecutionControlAction;
}
export interface OwnedAgentSnapshot {
    executionId: string;
    agent: AgentSnapshotPayload;
}
export type OwnedAgentEvent = {
    type: "update";
    executionId: string;
    agent: AgentSnapshotPayload;
} | {
    type: "stream";
    executionId: string;
    agentId: string;
    event: AgentStreamEventPayload;
};
interface DaemonExecutionsOptions {
    daemonId: string;
    agentManager: AgentManager;
    agentStorage: AgentStorage;
    createAgent: BoundCreateAgentCommand;
    interruptAgent: (agentId: string) => Promise<unknown>;
    archiveWorkspace: (workspaceId: string, requestId: string) => Promise<unknown>;
    cleanupFailedCreate?: (input: {
        createdWorktree: CreatePaseoWorktreeWorkflowResult | null;
        createdAgentId: string | null;
    }) => Promise<void>;
}
export interface HubExecutionAgents {
    create(input: HubExecutionAgentCreateInput): Promise<OwnedAgentSnapshot>;
    control(input: HubExecutionControlInput): Promise<void>;
    subscribe(listener: (event: OwnedAgentEvent) => void): () => void;
    invalidateAuthority(): Promise<void>;
}
export declare class DaemonExecutions implements HubExecutionAgents {
    private readonly options;
    private readonly daemonId;
    private readonly agentManager;
    private readonly agentStorage;
    private readonly createAgentCommand;
    private readonly pendingCreates;
    private readonly pendingControlActions;
    private readonly controlTails;
    private authorityGeneration;
    private authorityActive;
    private readonly cleanupFailedCreate;
    constructor(options: DaemonExecutionsOptions);
    create(input: HubExecutionAgentCreateInput): Promise<OwnedAgentSnapshot>;
    control(input: HubExecutionControlInput): Promise<void>;
    invalidateAuthority(): Promise<void>;
    subscribe(listener: (event: OwnedAgentEvent) => void): () => void;
    private createOrResolve;
    private controlOwnedExecution;
    private resolveRecord;
    private requireAuthority;
    private projectRecord;
    private projectEvent;
    private projectAgentState;
    private isOwned;
    private owner;
    private requireOwner;
}
export {};
//# sourceMappingURL=daemon-executions.d.ts.map