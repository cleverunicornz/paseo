import { z } from "zod";
import type { Logger } from "pino";
import type { AgentPermissionRequest } from "./agent-sdk-types.js";
import type { AgentManager, ManagedAgent, WaitForAgentResult } from "./agent-manager.js";
import type { AgentStorage } from "./agent-storage.js";
import { StoredScheduleSchema } from "@getpaseo/protocol/schedule/types";
import type { AgentProvider } from "./agent-sdk-types.js";
export declare const AgentProviderEnum: z.ZodString;
export declare const AgentStatusEnum: z.ZodEnum<{
    error: "error";
    initializing: "initializing";
    idle: "idle";
    running: "running";
    closed: "closed";
}>;
export declare const ProviderModeSchema: z.ZodObject<{
    id: z.ZodString;
    label: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    description: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    icon: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    colorTier: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, z.core.$loose>;
export declare const ProviderSummarySchema: z.ZodObject<{
    id: z.ZodString;
    label: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    description: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    enabled: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
    modes: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        label: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        description: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        icon: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        colorTier: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    }, z.core.$loose>>>>;
}, z.core.$loose>;
export declare const AgentSelectOptionSchema: z.ZodObject<{
    id: z.ZodString;
    label: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    description: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    isDefault: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
    metadata: z.ZodOptional<z.ZodNullable<z.ZodRecord<z.ZodString, z.ZodUnknown>>>;
}, z.core.$loose>;
export declare const AgentModelSchema: z.ZodObject<{
    provider: z.ZodString;
    id: z.ZodString;
    label: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    description: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    isDefault: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
    metadata: z.ZodOptional<z.ZodNullable<z.ZodRecord<z.ZodString, z.ZodUnknown>>>;
    thinkingOptions: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        label: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        description: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        isDefault: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
        metadata: z.ZodOptional<z.ZodNullable<z.ZodRecord<z.ZodString, z.ZodUnknown>>>;
    }, z.core.$loose>>>>;
    defaultThinkingOptionId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, z.core.$loose>;
export declare const AGENT_WAIT_TIMEOUT_MS = 30000;
export interface ResolvedProviderModel {
    provider: AgentProvider;
    model: string | undefined;
}
export declare function resolveRequiredProviderModel(providerValue: string): Required<ResolvedProviderModel>;
export interface AgentWaitWithTimeoutResult extends WaitForAgentResult {
    /** The wait gave up while the agent was still working. */
    timedOut: boolean;
}
/**
 * Wraps agentManager.waitForAgentEvent with a self-imposed timeout.
 * Returns a friendly message when timeout occurs, rather than letting
 * the SDK tool timeout trigger a generic "tool failed" error.
 */
export declare function waitForAgentWithTimeout(agentManager: AgentManager, agentId: string, options?: {
    signal?: AbortSignal;
    waitForActive?: boolean;
}): Promise<AgentWaitWithTimeoutResult>;
export declare function sanitizePermissionRequest(permission: AgentPermissionRequest): AgentPermissionRequest;
export declare function sanitizePermissionRequest(permission: null | undefined): null;
export declare function sanitizePermissionRequest(permission: AgentPermissionRequest | null | undefined): AgentPermissionRequest | null;
export declare function resolveAgentTitle(agentStorage: AgentStorage, agentId: string, logger: Logger): Promise<string | null>;
export declare function serializeSnapshotWithMetadata(agentStorage: AgentStorage, snapshot: ManagedAgent, logger: Logger): Promise<{
    id: string;
    provider: string;
    cwd: string;
    model: string | null;
    createdAt: string;
    updatedAt: string;
    lastUserMessageAt: string | null;
    status: "error" | "initializing" | "idle" | "running" | "closed";
    capabilities: import("@getpaseo/protocol/agent-types").AgentCapabilityFlags;
    currentModeId: string | null;
    availableModes: import("@getpaseo/protocol/agent-types").AgentMode[];
    pendingPermissions: import("@getpaseo/protocol/agent-types").AgentPermissionRequest[];
    persistence: import("@getpaseo/protocol/agent-types").AgentPersistenceHandle | null;
    title: string | null;
    labels: Record<string, string>;
    workspaceId?: string | undefined;
    features?: ({
        type: "toggle";
        id: string;
        label: string;
        value: boolean;
        description?: string | undefined;
        tooltip?: string | undefined;
        icon?: string | undefined;
    } | {
        type: "select";
        id: string;
        label: string;
        value: string | null;
        options: {
            id: string;
            label: string;
            description?: string | undefined;
            isDefault?: boolean | undefined;
            metadata?: Record<string, unknown> | undefined;
        }[];
        description?: string | undefined;
        tooltip?: string | undefined;
        icon?: string | undefined;
        desktopTrigger?: "label" | "icon" | undefined;
    })[] | undefined;
    thinkingOptionId?: string | null | undefined;
    effectiveThinkingOptionId?: string | null | undefined;
    activeTurn?: {
        turnId: string;
        startedAt: string | null;
    } | null | undefined;
    runtimeInfo?: import("@getpaseo/protocol/agent-types").AgentRuntimeInfo | undefined;
    lastUsage?: import("@getpaseo/protocol/agent-types").AgentUsage | undefined;
    lastError?: string | undefined;
    requiresAttention?: boolean | undefined;
    attentionReason?: "finished" | "error" | "permission" | null | undefined;
    attentionTimestamp?: string | null | undefined;
    archivedAt?: string | null | undefined;
    providerUnavailable?: boolean | undefined;
}>;
export declare function parseDurationString(input: string): number;
export declare function toScheduleSummary(schedule: z.infer<typeof StoredScheduleSchema>): {
    id: string;
    name: string | null;
    prompt: string;
    cadence: {
        type: "every";
        everyMs: number;
    } | {
        type: "cron";
        expression: string;
        timezone?: string | undefined;
    };
    target: {
        type: "agent";
        agentId: string;
    } | {
        type: "new-agent";
        config: {
            provider: string;
            cwd: string;
            modeId?: string | undefined;
            model?: string | undefined;
            thinkingOptionId?: string | undefined;
            archiveOnFinish?: boolean | undefined;
            isolation?: "worktree" | "local" | undefined;
            title?: string | null | undefined;
            providerOptions?: Record<string, unknown> | undefined;
            featureValues?: Record<string, unknown> | undefined;
            systemPrompt?: string | undefined;
            mcpServers?: Record<string, unknown> | undefined;
        };
    };
    status: "completed" | "active" | "paused";
    createdAt: string;
    updatedAt: string;
    nextRunAt: string | null;
    lastRunAt: string | null;
    pausedAt: string | null;
    expiresAt: string | null;
    maxRuns: number | null;
};
//# sourceMappingURL=mcp-shared.d.ts.map