import { createHash } from "node:crypto";
import { z } from "zod";
import { UsageReportSchema, } from "@getpaseo/protocol/messages";
/** Owns account identity, ordered logins for each account, and the five-minute fetch cache. */
export class UsageSourceRegistry {
    constructor(now = Date.now, ttlMs = 300000, logger = { warn: console.warn }, agents = { hasAgent: () => false, usageSession: () => null }, deadlineMs = 20000) {
        this.now = now;
        this.ttlMs = ttlMs;
        this.logger = logger;
        this.agents = agents;
        this.deadlineMs = deadlineMs;
        this.sources = new Map();
        this.known = new Map();
        this.defaults = new Map();
        this.byAgent = new Map();
        this.cache = new Map();
        this.pending = new Map();
    }
    register(source) {
        if (this.sources.has(source.id))
            throw new Error(`Duplicate usage source: ${source.id}`);
        this.sources.set(source.id, source);
    }
    unregister(id) {
        this.sources.delete(id);
        for (const key of this.defaults.keys())
            if (key.startsWith(`${id}:`))
                this.defaults.delete(key);
        // Re-discover on the next session query when a source is replaced.
        for (const [agentId, mapping] of this.byAgent) {
            if ([...mapping.reports.values()].some((report) => report.source.id === id))
                this.byAgent.delete(agentId);
        }
        for (const key of this.known.keys())
            if (key.startsWith(`${id}:`))
                this.known.delete(key);
        for (const key of this.cache.keys())
            if (key.startsWith(`${id}:`))
                this.cache.delete(key);
        for (const key of this.pending.keys())
            if (key.startsWith(`${id}:`))
                this.pending.delete(key);
    }
    async listReports(options = {}) {
        if (options.agentId !== undefined && options.reportIds !== undefined)
            throw new Error("agentId and reportIds cannot be combined");
        this.pruneAgents();
        let ids;
        let reports = this.known;
        if (options.agentId !== undefined) {
            ids = await this.discoverAgent(options.agentId);
            reports = this.byAgent.get(options.agentId)?.reports ?? new Map();
        }
        else if (options.reportIds !== undefined) {
            ids = options.reportIds;
        }
        else {
            this.defaults = await this.discover({ kind: "global" });
            this.mergeKnown();
            ids = [...this.known.keys()];
        }
        return Promise.all([...new Set(ids)].flatMap((id) => {
            const known = reports.get(id);
            if (!known)
                return [];
            return [
                this.fetchId(id, known, options.forceRefresh).then((entry) => {
                    options.onReport?.(entry);
                    return entry;
                }),
            ];
        }));
    }
    pruneAgents() {
        for (const id of this.byAgent.keys()) {
            if (!this.agents.hasAgent(id))
                this.byAgent.delete(id);
        }
        this.mergeKnown();
    }
    async discoverAgent(agentId) {
        if (!this.agents.hasAgent(agentId))
            throw new Error(`Unknown agent: ${agentId}`);
        const session = this.agents.usageSession(agentId);
        if (!session)
            return [];
        const previous = this.byAgent.get(agentId);
        const sameScope = previous?.sessionKey === session.sessionKey &&
            previous.provider === session.provider &&
            previous.model === session.model;
        if (sameScope)
            return [...previous.reports.keys()];
        const reports = await this.discover({
            kind: "session",
            provider: session.provider,
            model: session.model,
            env: session.env,
        });
        // A query that finishes after a resume must not publish the previous launch's mapping.
        if (this.agents.usageSession(agentId)?.sessionKey !== session.sessionKey)
            return [];
        this.byAgent.set(agentId, {
            sessionKey: session.sessionKey,
            provider: session.provider,
            model: session.model,
            reports,
        });
        this.mergeKnown();
        return [...reports.keys()];
    }
    mergeKnown() {
        this.known.clear();
        for (const reports of [
            this.defaults,
            ...[...this.byAgent.values()].map((agent) => agent.reports),
        ]) {
            for (const [id, report] of reports) {
                if (this.sources.get(report.source.id) !== report.source)
                    continue;
                const known = this.known.get(id);
                if (!known) {
                    this.known.set(id, { ...report, logins: [...report.logins] });
                    continue;
                }
                for (const login of report.logins) {
                    if (!known.logins.some((existing) => loginKey(existing) === loginKey(login)))
                        known.logins.push(login);
                }
            }
        }
    }
    async discover(scope) {
        const discovered = await Promise.all([...this.sources.values()].map(async (source) => {
            const reports = new Map();
            try {
                const accounts = z
                    .array(z.object({
                    key: z.string().regex(/^[A-Za-z0-9._-]{1,128}$/),
                    label: z.string().optional(),
                    harness: z.string().min(1).optional(),
                    input: z.json(),
                }))
                    .parse(await source.discover(scope));
                for (const account of accounts) {
                    const id = `${source.id}:${account.key}`;
                    const known = reports.get(id);
                    // COMPAT(usageLoginHarness): added in v0.11.0, remove after 2027-04-05 once plugin floor >= v0.11.0.
                    const login = { input: account.input, harness: account.harness ?? source.label };
                    if (known) {
                        if (!known.logins.some((existing) => loginKey(existing) === loginKey(login)))
                            known.logins.push(login);
                    }
                    else
                        reports.set(id, { source, logins: [login], label: account.label });
                }
            }
            catch (error) {
                this.logger.warn({ sourceId: source.id, err: error }, "Usage source discovery failed");
            }
            return reports;
        }));
        const merged = new Map();
        for (const reports of discovered) {
            for (const [id, report] of reports)
                merged.set(id, report);
        }
        return merged;
    }
    // COMPAT(providerUsageList): added in v0.1.98, remove after 2027-03-26.
    async listLegacyUsage() {
        const reports = await this.listReports();
        return {
            fetchedAt: reports.length
                ? reports.reduce((oldest, entry) => (entry.fetchedAt < oldest ? entry.fetchedAt : oldest), reports[0].fetchedAt)
                : new Date(this.now()).toISOString(),
            providers: reports.map((entry) => ({
                providerId: entry.sourceId,
                displayName: entry.account.label
                    ? `${entry.sourceLabel} (${entry.account.label})`
                    : entry.sourceLabel,
                status: entry.report.status,
                planLabel: entry.report.status === "available" ? (entry.report.planLabel ?? null) : null,
                windows: entry.report.status === "available" ? entry.report.windows : [],
                balances: entry.report.status === "available" ? (entry.report.balances ?? []) : [],
                details: entry.report.status === "available" ? (entry.report.details ?? []) : [],
                error: legacyError(entry.report, this.now()),
            })),
        };
    }
    fetchId(id, known, forceRefresh = false) {
        // Account identity groups cards; the ordered login set identifies a fetch result.
        const cacheKey = `${id}:${createHash("sha256")
            .update(JSON.stringify([known.label, known.logins.map(loginKey)]))
            .digest("hex")}`;
        const cached = this.cache.get(cacheKey);
        if (!forceRefresh && cached && this.now() - cached.at < this.ttlMs)
            return Promise.resolve(cached.entry);
        const pending = this.pending.get(cacheKey);
        if (pending)
            return pending;
        const request = (async () => {
            const entry = {
                id,
                sourceId: known.source.id,
                sourceLabel: known.source.label,
                icon: known.source.icon,
                account: { label: known.label },
                fetchedAt: new Date(this.now()).toISOString(),
                ...(await this.fetchWithFallback(known)),
            };
            if (this.sources.get(known.source.id) === known.source)
                this.writeCache(cacheKey, entry);
            return entry;
        })();
        this.pending.set(cacheKey, request);
        void request.finally(() => {
            if (this.pending.get(cacheKey) === request)
                this.pending.delete(cacheKey);
        });
        return request;
    }
    writeCache(id, entry) {
        const at = this.now();
        for (const [cachedId, cached] of this.cache) {
            if (at - cached.at >= this.ttlMs)
                this.cache.delete(cachedId);
        }
        this.cache.set(id, { at, entry });
    }
    async fetchBeforeDeadline(source, input) {
        let timer;
        const deadline = new Promise((resolve) => {
            timer = setTimeout(() => resolve({ status: "error", error: "Usage fetch timed out" }), this.deadlineMs);
        });
        try {
            return await Promise.race([this.fetchLogin(source, input), deadline]);
        }
        finally {
            clearTimeout(timer);
        }
    }
    async fetchWithFallback(known) {
        // Start each login within the same deadline window, then prefer discovery order.
        // Sequential deadlines can exceed the client's RPC timeout before all errors arrive.
        const attempts = known.logins.map((login) => this.fetchBeforeDeadline(known.source, login.input));
        const loginErrors = [];
        for (const [index, login] of known.logins.entries()) {
            const report = await attempts[index];
            if (report.status === "available")
                return { report };
            loginErrors.push({ harness: login.harness, report });
        }
        // COMPAT(usageLoginErrors): added in v0.11.0, remove after 2027-04-05 once app floor >= v0.11.0.
        // Keep the final single report so older apps still parse and display failed accounts.
        return { report: loginErrors[loginErrors.length - 1].report, loginErrors };
    }
    async fetchLogin(source, input) {
        try {
            return UsageReportSchema.parse(await source.fetch(input));
        }
        catch (error) {
            this.logger.warn({ sourceId: source.id, err: error }, "Usage fetch failed");
            return { status: "error", error: error instanceof Error ? error.message : String(error) };
        }
    }
}
// The legacy RPC has only an error string; the current app owns its own presentation.
// COMPAT(providerUsageList): added in v0.1.98, remove after 2027-03-26.
function legacyProblem(problem, now) {
    if (problem.kind === "no_quota")
        return problem.detail;
    const remedy = problem.refreshedBy
        ? `Run ${problem.refreshedBy} to refresh it.`
        : "Sign in again.";
    if (problem.kind === "rejected")
        return `Login rejected (HTTP ${problem.status}). ${remedy}`;
    const elapsed = Math.max(0, now - Date.parse(problem.expiresAt));
    let ago = "just now";
    if (elapsed >= 86400000)
        ago = `${Math.floor(elapsed / 86400000)}d ago`;
    else if (elapsed >= 3600000)
        ago = `${Math.floor(elapsed / 3600000)}h ago`;
    else if (elapsed >= 60000)
        ago = `${Math.floor(elapsed / 60000)}m ago`;
    return `Login expired ${ago}. ${remedy}`;
}
// COMPAT(providerUsageList): added in v0.1.98, remove after 2027-03-26.
function legacyError(report, now) {
    if (report.status === "error")
        return report.error;
    if (report.status === "unavailable")
        return legacyProblem(report.problem, now);
    return null;
}
// Inputs are opaque JSON locators. Canonical equality deduplicates discovery across scopes.
function loginKey(login) {
    return JSON.stringify(login, (_key, value) => value !== null && typeof value === "object" && !Array.isArray(value)
        ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)))
        : value);
}
//# sourceMappingURL=index.js.map