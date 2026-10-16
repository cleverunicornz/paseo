function createScheduler() {
    return {
        schedulePoll: (callback) => {
            const timer = setTimeout(callback, 3000);
            return () => clearTimeout(timer);
        },
    };
}
function toAgentUsage(stats) {
    const inputTokens = stats.tokens?.input ?? 0;
    const cachedInputTokens = stats.tokens?.cacheRead ?? 0;
    const outputTokens = stats.tokens?.output ?? 0;
    const totalCostUsd = stats.cost ?? 0;
    const contextWindowMaxTokens = stats.contextUsage?.contextWindow ?? undefined;
    const contextWindowUsedTokens = stats.contextUsage?.tokens ?? undefined;
    if (inputTokens === 0 &&
        cachedInputTokens === 0 &&
        outputTokens === 0 &&
        totalCostUsd === 0 &&
        contextWindowMaxTokens === undefined &&
        contextWindowUsedTokens === undefined) {
        return undefined;
    }
    return {
        inputTokens,
        cachedInputTokens,
        outputTokens,
        totalCostUsd,
        ...(typeof contextWindowMaxTokens === "number" ? { contextWindowMaxTokens } : {}),
        ...(typeof contextWindowUsedTokens === "number" ? { contextWindowUsedTokens } : {}),
    };
}
function isSameUsage(left, right) {
    return (left.inputTokens === right.inputTokens &&
        left.cachedInputTokens === right.cachedInputTokens &&
        left.outputTokens === right.outputTokens &&
        left.totalCostUsd === right.totalCostUsd &&
        left.contextWindowMaxTokens === right.contextWindowMaxTokens &&
        left.contextWindowUsedTokens === right.contextWindowUsedTokens);
}
export class PiUsagePoller {
    constructor(options) {
        this.options = options;
        this.active = false;
        this.closed = false;
        this.generation = 0;
        this.cancelScheduledPoll = null;
        this.lastUsage = null;
        this.scheduler = options.scheduler ?? createScheduler();
    }
    startTurn() {
        if (this.closed || this.active) {
            return;
        }
        this.active = true;
        this.generation += 1;
        this.schedule(this.generation);
    }
    stopTurn() {
        this.active = false;
        this.invalidatePendingWork();
    }
    async completeTurn(turnId) {
        if (this.closed) {
            return;
        }
        this.active = false;
        const completionGeneration = this.invalidatePendingWork();
        let usage;
        try {
            usage = toAgentUsage(await this.options.readStats());
        }
        catch {
            return;
        }
        if (this.closed || this.generation !== completionGeneration) {
            return;
        }
        this.publishUsage(usage, turnId);
    }
    close() {
        this.closed = true;
        this.active = false;
        this.invalidatePendingWork();
    }
    invalidatePendingWork() {
        this.generation += 1;
        this.cancelScheduledPoll?.();
        this.cancelScheduledPoll = null;
        return this.generation;
    }
    schedule(generation) {
        this.cancelScheduledPoll = this.scheduler.schedulePoll(() => {
            this.cancelScheduledPoll = null;
            void this.poll(generation);
        });
    }
    async poll(generation) {
        let usage;
        try {
            usage = toAgentUsage(await this.options.readStats());
        }
        catch (error) {
            try {
                if (this.active && !this.closed && this.generation === generation) {
                    this.options.onPollError(error);
                }
            }
            finally {
                if (this.active && !this.closed && this.generation === generation) {
                    this.schedule(generation);
                }
            }
            return;
        }
        try {
            if (this.active && !this.closed && this.generation === generation) {
                this.publishUsage(usage);
            }
        }
        finally {
            if (this.active && !this.closed && this.generation === generation) {
                this.schedule(generation);
            }
        }
    }
    takeChangedUsage(usage) {
        if (!usage || (this.lastUsage && isSameUsage(this.lastUsage, usage))) {
            return undefined;
        }
        this.lastUsage = usage;
        return usage;
    }
    publishUsage(usage, turnId) {
        const changedUsage = this.takeChangedUsage(usage);
        if (changedUsage) {
            this.options.onUsage(changedUsage, turnId);
        }
    }
}
//# sourceMappingURL=usage-poller.js.map