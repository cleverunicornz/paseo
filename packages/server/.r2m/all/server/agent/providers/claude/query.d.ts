import { type ChildProcess } from "node:child_process";
import { query, type Options, type Query } from "@anthropic-ai/claude-agent-sdk";
import { type ProviderRuntimeSettings } from "../../provider-launch-config.js";
export type ClaudeOptions = Options;
export type ClaudeQueryInput = Parameters<typeof query>[0] & {
    options: ClaudeOptions;
};
export type ClaudeQueryFactory = (input: ClaudeQueryInput) => Query;
export interface ClaudeQueryContext {
    runtimeSettings?: ProviderRuntimeSettings;
    launchEnv?: Record<string, string>;
    queryFactory?: ClaudeQueryFactory;
    /** Called with the spawned child process so the caller can tree-kill it on close. */
    onChildProcess?: (child: ChildProcess) => void;
}
export declare function claudeQuery(input: ClaudeQueryInput, context?: ClaudeQueryContext): Query;
//# sourceMappingURL=query.d.ts.map