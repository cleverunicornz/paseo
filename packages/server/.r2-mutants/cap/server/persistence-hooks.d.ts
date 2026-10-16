import type { AgentManager } from "./agent/agent-manager.js";
import type { AgentPersistenceHandle, AgentProvider, AgentSessionConfig } from "./agent/agent-sdk-types.js";
import type { AgentStorage, StoredAgentRecord } from "./agent/agent-storage.js";
import type { AttentionState } from "./agent/agent-manager.js";
interface LoggerLike {
    child(bindings: Record<string, unknown>): LoggerLike;
    error(...args: unknown[]): void;
    warn(...args: unknown[]): void;
}
type AgentStoragePersistence = Pick<AgentStorage, "applySnapshot" | "list">;
type AgentManagerStateSource = Pick<AgentManager, "subscribe">;
interface BuildSessionConfigOptions {
    validProviders?: Iterable<AgentProvider>;
}
/**
 * Attach AgentStorage persistence to an AgentManager instance so every
 * agent_state snapshot is flushed to disk.
 */
export declare function attachAgentStoragePersistence(logger: LoggerLike, agentManager: AgentManagerStateSource, storage: AgentStoragePersistence): () => void;
export declare function buildConfigOverrides(record: StoredAgentRecord): Partial<AgentSessionConfig>;
export declare function buildSessionConfig(record: StoredAgentRecord, options?: BuildSessionConfigOptions): AgentSessionConfig | null;
export declare function isStoredAgentProviderAvailable(record: StoredAgentRecord, validProviders?: Iterable<AgentProvider>): boolean;
/**
 * When the record last changed, from either of the two timestamps it carries. They diverge
 * because renaming, labelling, restoring from archive, marking unread, and clearing attention
 * all move `updatedAt` on an unloaded agent without touching `lastActivityAt`. Reading one
 * field alone hands consumers a time older than one they have already seen, and
 * `acceptAgentDirectoryUpdate` drops every state update that goes backwards.
 */
export declare function resolveStoredAgentUpdatedAt(record: StoredAgentRecord): string;
export declare function extractTimestamps(record: StoredAgentRecord): {
    createdAt: Date;
    updatedAt: Date;
    lastUserMessageAt: Date | null;
    labels?: Record<string, string>;
    workspaceId?: string;
    owner?: StoredAgentRecord["owner"];
};
/**
 * Unread state survives a resume. Attention is set by the agent finishing or failing and
 * cleared by the user reading the chat (`workspace.clear_attention`); reloading the runtime
 * is neither, so a resumed agent that drops it silently marks the chat read.
 */
export declare function extractAttention(record: StoredAgentRecord): AttentionState;
export declare function toAgentPersistenceHandle(registeredProviders: Iterable<AgentProvider>, handle: StoredAgentRecord["persistence"]): AgentPersistenceHandle | null;
export {};
//# sourceMappingURL=persistence-hooks.d.ts.map