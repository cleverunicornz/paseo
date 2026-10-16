import { usageFromV2 } from "./mapping.js";
// A step is one model call, so its tokens are the context that call used.
function contextWindowUsedTokens(tokens) {
    return tokens.input + tokens.output + tokens.reasoning + tokens.cache.read + tokens.cache.write;
}
export class SessionUsage {
    constructor(options) {
        this.options = options;
        this.limits = new Map();
        this.reports = Promise.resolve();
    }
    observe(event) {
        if (event.type !== "session.step.ended")
            return;
        const { tokens } = event.data;
        // Reports stay in step order while a model's context limit is still being looked up.
        this.reports = this.reports
            .then(() => this.report(tokens))
            .catch((error) => this.options.reportError(error));
    }
    async report(tokens) {
        const model = this.options.info().model;
        const contextWindowMaxTokens = model ? await this.contextLimit(model) : undefined;
        this.options.emit({
            type: "usage_updated",
            provider: "opencode",
            usage: {
                ...usageFromV2(this.options.info()),
                contextWindowUsedTokens: contextWindowUsedTokens(tokens),
                ...(contextWindowMaxTokens === undefined ? {} : { contextWindowMaxTokens }),
            },
        });
    }
    contextLimit(model) {
        const key = `${model.providerID}/${model.id}`;
        const cached = this.limits.get(key);
        if (cached)
            return cached;
        const limit = this.options
            .client()
            .model.list({ location: { directory: this.options.cwd } })
            .then((catalog) => catalog.data.find((entry) => entry.providerID === model.providerID && entry.id === model.id)?.limit.context);
        this.limits.set(key, limit);
        limit.catch(() => this.limits.delete(key));
        return limit;
    }
}
//# sourceMappingURL=usage.js.map