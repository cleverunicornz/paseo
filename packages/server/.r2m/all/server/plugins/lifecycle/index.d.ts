import type { AgentStreamEvent, AgentTimelineItem } from "../../agent/agent-sdk-types.js";
import type { PluginHookAgent, PluginHookContext, PluginLifecycleRegistration } from "@getpaseo/plugin/server";
import type { PluginBeforeRequests, PluginHookWorkspace, PluginLifecycleEvents } from "@getpaseo/plugin/server";
import type { PersistedWorkspaceRecord } from "../../workspace-registry.js";
export declare const lifecycleEventNames: readonly ["agent.created", "agent.closed", "agent.turn_started", "agent.turn_ended", "agent.permission_requested", "agent.permission_resolved", "agent.archived", "workspace.created", "workspace.archived"];
export declare const beforeHookNames: readonly ["agent.create", "agent.session_open", "workspace.create"];
export interface PluginLifecycle {
    emit<Name extends keyof PluginLifecycleEvents>(name: Name, event: PluginLifecycleEvents[Name]): void;
    before<Name extends keyof PluginBeforeRequests>(name: Name, request: PluginBeforeRequests[Name]): Promise<PluginBeforeRequests[Name]>;
}
export declare function validateBeforeRequest<Name extends keyof PluginBeforeRequests>(name: Name, value: unknown): PluginBeforeRequests[Name];
export declare function describeHookWorkspace(workspace: PersistedWorkspaceRecord): PluginHookWorkspace;
export declare function describeHookAgent(agent: {
    id: string;
    workspaceId?: string;
    provider: string;
    cwd: string;
    title?: string | null;
    labels: Record<string, string>;
}): PluginHookAgent;
export declare function publishAgentStream(lifecycle: PluginLifecycle, agent: PluginHookAgent, event: AgentStreamEvent, timeline: readonly AgentTimelineItem[]): void;
export declare function validateBeforeResult<Name extends keyof PluginBeforeRequests>(name: Name, input: PluginBeforeRequests[Name], output: unknown): PluginBeforeRequests[Name];
export declare class PluginHookHandlers implements PluginLifecycleRegistration {
    private readonly events;
    private readonly transforms;
    private readonly active;
    private readonly changed;
    constructor(changed: () => void);
    readonly on: PluginLifecycleRegistration["on"];
    readonly before: PluginLifecycleRegistration["before"];
    catalog(): {
        events: string[];
        before: string[];
    };
    invoke(id: string, kind: "event" | "before", name: string, input: unknown, paseo: PluginHookContext["paseo"]): Promise<unknown>;
    cancel(id: string): void;
    close(): void;
    private register;
}
//# sourceMappingURL=index.d.ts.map