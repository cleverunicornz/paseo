import { scoreTextFields } from "@getpaseo/protocol/search/text-match";
/** Search the names people recall, never an incomplete subset of transcripts. */
export function matchesAgentHistoryQuery(query, { agent, project }) {
    return (scoreTextFields(query, [
        project.workspaceName ?? "",
        agent.title ?? "",
        project.checkout.currentBranch ?? "",
        project.projectName,
    ], { typoTolerant: true }) !== null);
}
//# sourceMappingURL=agent-history-search.js.map