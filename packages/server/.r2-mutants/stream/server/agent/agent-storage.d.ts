import { z } from "zod";
import type { Logger } from "pino";
import type { ManagedAgent } from "./agent-manager.js";
import type { AgentSessionConfig } from "./agent-sdk-types.js";
import { type DaemonAgentOwner } from "./agent-owner.js";
declare const STORED_AGENT_SCHEMA: z.ZodObject<{
    id: z.ZodString;
    provider: z.ZodString;
    cwd: z.ZodString;
    workspaceId: z.ZodOptional<z.ZodString>;
    createdAt: z.ZodString;
    updatedAt: z.ZodString;
    lastActivityAt: z.ZodOptional<z.ZodString>;
    lastUserMessageAt: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    title: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    labels: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodString>>;
    lastStatus: z.ZodDefault<z.ZodEnum<{
        error: "error";
        initializing: "initializing";
        idle: "idle";
        running: "running";
        closed: "closed";
    }>>;
    lastModeId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    config: z.ZodOptional<z.ZodNullable<z.ZodObject<{
        modeId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        model: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        thinkingOptionId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        featureValues: z.ZodOptional<z.ZodNullable<z.ZodRecord<z.ZodString, z.ZodUnknown>>>;
        providerOptions: z.ZodOptional<z.ZodNullable<z.ZodRecord<z.ZodString, z.ZodUnknown>>>;
        toolPolicy: z.ZodOptional<z.ZodNullable<z.ZodObject<{
            preapproved: z.ZodArray<z.ZodObject<{
                kind: z.ZodLiteral<"mcp">;
                server: z.ZodString;
                tool: z.ZodString;
            }, z.core.$strict>>;
        }, z.core.$strict>>>;
        systemPrompt: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        mcpServers: z.ZodOptional<z.ZodNullable<z.ZodRecord<z.ZodString, z.ZodAny>>>;
    }, z.core.$strip>>>;
    runtimeInfo: z.ZodOptional<z.ZodObject<{
        provider: z.ZodString;
        sessionId: z.ZodNullable<z.ZodString>;
        model: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        thinkingOptionId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        modeId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        extra: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    }, z.core.$strip>>;
    features: z.ZodOptional<z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
        type: z.ZodLiteral<"toggle">;
        id: z.ZodString;
        label: z.ZodString;
        description: z.ZodOptional<z.ZodString>;
        tooltip: z.ZodOptional<z.ZodString>;
        icon: z.ZodOptional<z.ZodString>;
        value: z.ZodBoolean;
    }, z.core.$strip>, z.ZodObject<{
        type: z.ZodLiteral<"select">;
        id: z.ZodString;
        label: z.ZodString;
        description: z.ZodOptional<z.ZodString>;
        tooltip: z.ZodOptional<z.ZodString>;
        icon: z.ZodOptional<z.ZodString>;
        desktopTrigger: z.ZodOptional<z.ZodEnum<{
            label: "label";
            icon: "icon";
        }>>;
        value: z.ZodNullable<z.ZodString>;
        options: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            label: z.ZodString;
            description: z.ZodOptional<z.ZodString>;
            isDefault: z.ZodOptional<z.ZodBoolean>;
            metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
        }, z.core.$strip>>;
    }, z.core.$strip>], "type">>>;
    persistence: z.ZodOptional<z.ZodNullable<z.ZodObject<{
        provider: z.ZodString;
        sessionId: z.ZodString;
        nativeHandle: z.ZodOptional<z.ZodAny>;
        metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
    }, z.core.$strip>>>;
    lastError: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    requiresAttention: z.ZodOptional<z.ZodBoolean>;
    attentionReason: z.ZodOptional<z.ZodNullable<z.ZodEnum<{
        finished: "finished";
        error: "error";
        permission: "permission";
    }>>>;
    attentionTimestamp: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    internal: z.ZodOptional<z.ZodBoolean>;
    archivedAt: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    owner: z.ZodOptional<z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"daemon">;
        daemonId: z.ZodString;
        executionId: z.ZodString;
    }, z.core.$strip>], "kind">>;
}, z.core.$strip>;
export type SerializableAgentConfig = Pick<AgentSessionConfig, "modeId" | "model" | "thinkingOptionId" | "featureValues" | "providerOptions" | "toolPolicy" | "systemPrompt" | "mcpServers">;
export type StoredAgentRecord = z.infer<typeof STORED_AGENT_SCHEMA>;
export declare function parseStoredAgentRecord(value: unknown): StoredAgentRecord;
export declare class AgentStorage {
    private cache;
    private pathById;
    private pathsById;
    private pendingWrites;
    private deleting;
    private daemonAgentIdsByExecution;
    private daemonExecutionKeysByAgentId;
    private loaded;
    private baseDir;
    private loadPromise;
    private logger;
    constructor(baseDir: string, logger: Logger);
    initialize(): Promise<void>;
    list(): Promise<StoredAgentRecord[]>;
    get(agentId: string): Promise<StoredAgentRecord | null>;
    listByProviderSession(provider: string, providerHandleId: string): Promise<StoredAgentRecord[]>;
    listByWorkspace(workspaceId: string): Promise<StoredAgentRecord[]>;
    findByDaemonExecution(owner: DaemonAgentOwner): Promise<StoredAgentRecord | null>;
    upsert(record: StoredAgentRecord): Promise<void>;
    private queueRecordWrite;
    private queueRecordMutation;
    private writeRecord;
    beginDelete(agentId: string): void;
    remove(agentId: string): Promise<void>;
    applySnapshot(agent: ManagedAgent, options?: {
        title?: string | null;
        internal?: boolean;
    }): Promise<void>;
    setTitle(agentId: string, title: string): Promise<void>;
    flush(): Promise<void>;
    private load;
    private doLoad;
    private scanDisk;
    private readRecordFile;
    private buildRecordPath;
    private addIndexedPath;
    private removeIndexedPath;
    private indexOwner;
    private removeOwnerIndex;
    private waitForPendingWrite;
}
export {};
//# sourceMappingURL=agent-storage.d.ts.map