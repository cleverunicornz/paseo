import { type AgentDefinition, type McpServerConfig as ClaudeSdkMcpServerConfig, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { Logger } from "pino";
import { type ClaudeQueryFactory } from "./query.js";
import { type ClaudeRewindSdk } from "./rewind.js";
import { type AgentCapabilityFlags, type AgentClient, type AgentCreateSessionOptions, type AgentFeature, type AgentLaunchContext, type AgentMetadata, type AgentModelDefinition, type AgentPersistenceHandle, type AgentSession, type AgentSessionConfig, type AgentTimelineItem, type FetchCatalogOptions, type ImportableProviderSession, type ImportProviderSessionContext, type ImportProviderSessionInput, type ListImportableSessionsOptions, type McpServerConfig, type ProviderCatalog, type ProviderRefreshContext, type ResolveAgentDefaultModeInput } from "../../agent-sdk-types.js";
import { type ProviderRuntimeSettings } from "../../provider-launch-config.js";
export declare function normalizeClaudeAskUserQuestionRequestInput(toolName: string, input: AgentMetadata): AgentMetadata;
export declare function normalizeClaudeAskUserQuestionUpdatedInput(updatedInput: AgentMetadata | undefined, fallbackInput: AgentMetadata | undefined): AgentMetadata;
interface EventIdentifiers {
    taskId: string | null;
    parentMessageId: string | null;
    messageId: string | null;
}
export interface ClaudeContentChunk {
    type: string;
    [key: string]: unknown;
}
interface ClaudeAgentClientOptions {
    defaults?: {
        agents?: Record<string, AgentDefinition>;
    };
    logger: Logger;
    runtimeSettings?: ProviderRuntimeSettings;
    queryFactory?: ClaudeQueryFactory;
    resolveBinary?: () => Promise<string>;
    resolveVersion?: (signal?: AbortSignal) => Promise<string>;
    rewindSdk?: ClaudeRewindSdk;
}
export declare function extractUserMessageText(content: unknown): string | null;
export declare function toClaudeSdkMcpConfig(config: McpServerConfig): ClaudeSdkMcpServerConfig;
export declare function readEventIdentifiers(message: SDKMessage): EventIdentifiers;
export declare class ClaudeAgentClient implements AgentClient {
    readonly provider: "claude";
    readonly capabilities: AgentCapabilityFlags;
    private readonly defaults?;
    private readonly logger;
    private readonly runtimeSettings?;
    private readonly queryFactory?;
    private readonly resolveBinary;
    private readonly resolveVersion;
    private readonly rewindSdk;
    constructor(options: ClaudeAgentClientOptions);
    resolveConfiguredModel(model: AgentModelDefinition): AgentModelDefinition;
    createSession(config: AgentSessionConfig, launchContext?: AgentLaunchContext, options?: AgentCreateSessionOptions): Promise<AgentSession>;
    resumeSession(handle: AgentPersistenceHandle, overrides?: Partial<AgentSessionConfig>, launchContext?: AgentLaunchContext): Promise<AgentSession>;
    getCatalogCacheKey(_options: FetchCatalogOptions): Promise<string>;
    fetchCatalog(_options: FetchCatalogOptions, context?: ProviderRefreshContext): Promise<ProviderCatalog>;
    resolveDefaultModeId({ env: launchEnv }: ResolveAgentDefaultModeInput): Promise<string>;
    private buildProviderEnv;
    listFeatures(config: AgentSessionConfig): Promise<AgentFeature[]>;
    listImportableSessions(options?: ListImportableSessionsOptions): Promise<ImportableProviderSession[]>;
    importSession(input: ImportProviderSessionInput, context: ImportProviderSessionContext): Promise<import("../../agent-sdk-types.js").ImportedProviderSession>;
    isAvailable(): Promise<boolean>;
    getDiagnostic(): Promise<{
        diagnostic: string;
    }>;
    private assertConfig;
}
export declare function resolveClaudeCodeVersion(runtimeSettings?: ProviderRuntimeSettings, signal?: AbortSignal): Promise<string>;
interface ClaudeHistoryEntry {
    type?: unknown;
    subtype?: unknown;
    isCompactSummary?: unknown;
    isSidechain?: unknown;
    agentId?: unknown;
    timestamp?: unknown;
    uuid?: unknown;
    message?: {
        content?: unknown;
        [key: string]: unknown;
    };
    [key: string]: unknown;
}
export declare function convertClaudeHistoryEntry(entry: ClaudeHistoryEntry, mapBlocks: (content: string | ClaudeContentChunk[]) => AgentTimelineItem[]): AgentTimelineItem[];
export {};
//# sourceMappingURL=agent.d.ts.map