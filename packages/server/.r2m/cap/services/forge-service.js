export function normalizeForgeSearchKinds(kinds) {
    if (!kinds)
        return ["issue", "change_request"];
    return kinds.map((kind) => {
        // COMPAT(githubSearchKind): legacy GitHub kind aliases retained when
        // neutral forge search shipped in v0.2.0-beta.1. Remove after 2027-01-17
        // together with the legacy github_search_request RPC.
        if (kind === "github-issue")
            return "issue";
        if (kind === "github-pr" || kind === "pr")
            return "change_request";
        return kind;
    });
}
export function computeChecksStatus(checks) {
    if (checks.length === 0) {
        return "none";
    }
    if (checks.some((check) => check.status === "failure")) {
        return "failure";
    }
    if (checks.some((check) => check.status === "pending")) {
        return "pending";
    }
    return "success";
}
export function createUnavailableSearchResult(authState) {
    return {
        items: [],
        featuresEnabled: false,
        authState,
        githubFeaturesEnabled: false,
    };
}
/** Parse an optional ISO timestamp to epoch ms, 0 when absent or unparseable. */
export function parseOptionalTime(value) {
    if (!value) {
        return 0;
    }
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
}
/** Stable timeline ordering shared by every adapter: by createdAt, then id. */
export function compareTimelineItems(left, right) {
    if (left.createdAt !== right.createdAt) {
        return left.createdAt - right.createdAt;
    }
    return left.id.localeCompare(right.id);
}
//# sourceMappingURL=forge-service.js.map