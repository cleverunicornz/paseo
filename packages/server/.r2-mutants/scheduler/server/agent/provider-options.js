export class ProviderOptionsValidationError extends Error {
    constructor(provider, issues) {
        const details = issues
            .map((issue) => `${formatProviderOptionPath(issue.path)}: ${issue.message}`)
            .join("; ");
        super(`Invalid providerOptions for '${provider}': ${details}`);
        this.provider = provider;
        this.issues = issues;
        this.code = "provider_options_invalid";
        this.name = "ProviderOptionsValidationError";
    }
}
export class ToolPolicyUnsupportedError extends Error {
    constructor(provider, reason) {
        super(reason ??
            `Provider '${provider}' cannot preapprove exact MCP tools for unattended execution; select Claude, Codex, or OpenCode`);
        this.provider = provider;
        this.code = "tool_policy_unsupported";
        this.name = "ToolPolicyUnsupportedError";
    }
}
export function validateProviderOptions(provider, schema, options) {
    if (options === undefined)
        return undefined;
    const parsed = schema.safeParse(options);
    if (parsed.success)
        return parsed.data;
    throw new ProviderOptionsValidationError(provider, flattenZodIssues(parsed.error.issues));
}
function flattenZodIssues(issues, prefix = []) {
    return issues.flatMap((issue) => {
        const path = [...prefix, ...issue.path];
        if (issue.code === "invalid_union") {
            return flattenZodIssues(issue.errors.flat(), path);
        }
        return [
            {
                path: path.map((segment) => typeof segment === "symbol" ? (segment.description ?? String(segment)) : segment),
                message: issue.message,
            },
        ];
    });
}
function formatProviderOptionPath(path) {
    return path.reduce((formatted, segment) => {
        if (typeof segment === "number")
            return `${formatted}[${segment}]`;
        return /^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(segment)
            ? `${formatted}.${segment}`
            : `${formatted}[${JSON.stringify(segment)}]`;
    }, "providerOptions");
}
/** Plain objects merge recursively; all other values replace the base value. */
export function mergeProviderOptions(base, override) {
    if (base === undefined && override === undefined)
        return undefined;
    const merged = { ...base };
    for (const [key, value] of Object.entries(override ?? {})) {
        const previous = merged[key];
        Object.defineProperty(merged, key, {
            value: isPlainObject(previous) && isPlainObject(value)
                ? mergeProviderOptions(previous, value)
                : value,
            enumerable: true,
            configurable: true,
            writable: true,
        });
    }
    return merged;
}
function isPlainObject(value) {
    if (value === null || typeof value !== "object")
        return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}
//# sourceMappingURL=provider-options.js.map