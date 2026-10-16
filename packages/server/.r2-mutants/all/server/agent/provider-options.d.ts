import type { ProviderOptions } from "@getpaseo/protocol/agent-types";
import type { z } from "zod";
export interface ProviderOptionIssue {
    path: Array<string | number>;
    message: string;
}
export declare class ProviderOptionsValidationError extends Error {
    readonly provider: string;
    readonly issues: ProviderOptionIssue[];
    readonly code: "provider_options_invalid";
    constructor(provider: string, issues: ProviderOptionIssue[]);
}
export declare class ToolPolicyUnsupportedError extends Error {
    readonly provider: string;
    readonly code: "tool_policy_unsupported";
    constructor(provider: string, reason?: string);
}
export declare function validateProviderOptions<T extends ProviderOptions>(provider: string, schema: z.ZodType<T>, options: ProviderOptions | undefined): T | undefined;
/** Plain objects merge recursively; all other values replace the base value. */
export declare function mergeProviderOptions(base: ProviderOptions | undefined, override: ProviderOptions | undefined): ProviderOptions | undefined;
//# sourceMappingURL=provider-options.d.ts.map