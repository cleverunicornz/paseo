import type { Logger } from "pino";
import { type AgentSnapshotPayload, type CreationSnapshot, type WorkspaceDescriptorPayload } from "@getpaseo/protocol/messages";
type Observer = (snapshot: CreationSnapshot) => void;
interface CreationRequest {
    key: string;
    request: {
        [key: string]: unknown;
    };
    workspaceId?: string;
    agentId?: string;
    hasAgent: boolean;
    hasPrompt: boolean;
    exists: (kind: "workspace" | "agent", id: string) => Promise<boolean>;
    provision?: (workspaceId: string) => Promise<{
        workspace: WorkspaceDescriptorPayload;
        setupSkippedReason?: string;
    }>;
    createAgent?: (agentId: string, workspace: WorkspaceDescriptorPayload | undefined, onReady: (agent: AgentSnapshotPayload) => Promise<void>) => Promise<AgentSnapshotPayload>;
}
export type CreationInput = CreationRequest & ({
    kind: "workspace";
} | {
    kind: "agent";
    readAgent: (id: string) => Promise<AgentSnapshotPayload | null>;
});
/** Owns creation across socket lifetimes. Resource owners perform work; this module commits its milestones. */
export declare class CreationService {
    private readonly directory;
    private readonly logger;
    private readonly validateCompleted;
    private readonly legacyDirectory?;
    private admission;
    private readonly active;
    private readonly receiptOperations;
    private readonly observers;
    constructor(directory: string, logger: Logger, validateCompleted?: (snapshot: CreationSnapshot) => Promise<void>, legacyDirectory?: string | undefined);
    create(input: CreationInput, observer?: Observer): Promise<CreationSnapshot>;
    subscribe(kind: CreationSnapshot["kind"], key: string, observer: Observer): Promise<{
        snapshot: CreationSnapshot | null;
        unsubscribe: () => void;
    }>;
    private run;
    private readLegacyAgent;
    private claimResources;
    private claim;
    private observe;
    private notify;
    private publish;
    private write;
    private read;
    private accessReceipt;
}
export {};
//# sourceMappingURL=index.d.ts.map