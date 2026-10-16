import type { AgentUsageSession } from "../../agent/agent-sdk-types.js";
import type { UsageScope } from "@getpaseo/plugin/server/usage";
import type { Logger } from "pino";
import { type ProviderUsage, type UsageReportEntry } from "@getpaseo/protocol/messages";
export interface UsageSource {
    id: string;
    label: string;
    icon?: string;
    discover(scope: UsageScope): Promise<unknown>;
    fetch(input: unknown): Promise<unknown>;
}
export interface AgentUsageLookup {
    hasAgent(id: string): boolean;
    usageSession(id: string): AgentUsageSession | null;
}
export interface ListUsageReportsOptions {
    forceRefresh?: boolean;
    reportIds?: string[];
    agentId?: string;
    onReport?: (report: UsageReportEntry) => void;
}
/** Owns account identity, ordered logins for each account, and the five-minute fetch cache. */
export declare class UsageSourceRegistry {
    private readonly now;
    private readonly ttlMs;
    private readonly logger;
    private readonly agents;
    private readonly deadlineMs;
    private readonly sources;
    private readonly known;
    private defaults;
    private readonly byAgent;
    private readonly cache;
    private readonly pending;
    constructor(now?: () => number, ttlMs?: number, logger?: Pick<Logger, "warn">, agents?: AgentUsageLookup, deadlineMs?: number);
    register(source: UsageSource): void;
    unregister(id: string): void;
    listReports(options?: ListUsageReportsOptions): Promise<UsageReportEntry[]>;
    private pruneAgents;
    private discoverAgent;
    private mergeKnown;
    private discover;
    listLegacyUsage(): Promise<{
        fetchedAt: string;
        providers: ProviderUsage[];
    }>;
    private fetchId;
    private writeCache;
    private fetchBeforeDeadline;
    private fetchWithFallback;
    private fetchLogin;
}
//# sourceMappingURL=index.d.ts.map