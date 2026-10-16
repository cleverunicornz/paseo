import type { AgentSnapshotPayload, ProjectPlacementPayload } from "@getpaseo/protocol/messages";
export interface AgentHistorySearchCandidate {
    agent: AgentSnapshotPayload;
    project: ProjectPlacementPayload;
}
/** Search the names people recall, never an incomplete subset of transcripts. */
export declare function matchesAgentHistoryQuery(query: string, { agent, project }: AgentHistorySearchCandidate): boolean;
//# sourceMappingURL=agent-history-search.d.ts.map